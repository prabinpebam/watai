import { createHash } from 'node:crypto';

const apiOrigin = 'https://func-watai-cbroocyg3omrk.azurewebsites.net';
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,128}$/.test(value);
const statuses = new Set(['queued', 'running', 'cancel_requested', 'complete', 'error', 'canceled']);
export const terminalRunStatus = status => ['complete', 'error', 'canceled'].includes(status);

export function observeChatHttp({ cdp, emit, stop, phase, pending, maxSubmissions = 1 }) {
  if (![1, 2].includes(maxSubmissions)) throw new Error('INVALID_SUBMISSION_LIMIT');
  const requests = new Map();
  const runs = new Map();
  const clientIds = new Set();
  const runStates = new Map();
  const terminals = new Map();
  let submissions = 0;
  let accepted;
  let waiter;
  let timeout;
  let stopped = false;
  const fail = code => {
    if (stopped) return;
    stopped = true;
    emit({ kind: 'capture-gap', payload: { code } }); stop(code);
    clearTimeout(timeout); waiter?.reject(new Error(code));
  };
  const runStatus = (record, payload) => {
    const run = runs.get(payload.id);
    if (!run || record.threadId !== run.threadId || payload.threadId !== run.threadId ||
        payload.assistantMessageId !== run.assistantMessageId || !statuses.has(payload.status)) throw new Error('RUN_STATUS_IDENTITY_MISMATCH');
    const previous = runStates.get(run.runId);
    if (terminalRunStatus(previous) && previous !== payload.status) throw new Error('TERMINAL_RUN_REGRESSION');
    runStates.set(run.runId, payload.status);
    emit({ kind: 'run-status', payload: { ...run, status: payload.status, requestPhase: record.phase } });
    if (terminalRunStatus(payload.status)) {
      const terminal = { ...run, status: payload.status };
      terminals.set(run.runId, terminal);
      if (waiter && (!waiter.runId || waiter.runId === run.runId)) {
        clearTimeout(timeout); const current = waiter; waiter = null; current.resolve(terminal);
      }
    }
  };
  cdp.on('Network.requestWillBeSent', event => {
    if (stopped) return;
    const url = new URL(event.request.url);
    if (url.origin !== apiOrigin) return;
    const match = /^\/api\/threads\/([a-zA-Z0-9-]{1,128})\/(runs|messages)(?:\/([a-zA-Z0-9-]{1,128}))?$/.exec(url.pathname);
    if (!match || !['GET', 'POST', 'DELETE'].includes(event.request.method)) return;
    if (requests.size >= 120) { fail('HTTP_OBSERVATION_LIMIT'); return; }
    const record = { threadId: match[1], collection: match[2], runId: match[3], phase: phase(), method: event.request.method,
      bytes: 0, bodyObserved: false, eligible: false, since: url.searchParams.has('since') };
    if (record.collection === 'runs' && record.method === 'POST' && !record.runId) {
      try {
        if (typeof event.request.postData !== 'string' || Buffer.byteLength(event.request.postData) > 16384) throw new Error('SUBMISSION_BODY_UNAVAILABLE');
        const body = JSON.parse(event.request.postData);
        if (!validId(body.clientMessageId) || typeof body.text !== 'string' || body.text.length > 4096) throw new Error('SUBMISSION_BODY_UNAVAILABLE');
        if (++submissions > maxSubmissions || clientIds.has(body.clientMessageId) ||
          (submissions > 1 && (!accepted || !terminals.has(accepted.runId) || accepted.threadId !== record.threadId))) throw new Error('SUBMISSION_SEQUENCE_INVALID');
        clientIds.add(body.clientMessageId);
        record.clientMessageId = body.clientMessageId;
        emit({ kind: 'submitted-run', payload: { threadId: record.threadId, clientMessageId: body.clientMessageId,
          promptSha256: createHash('sha256').update(body.text).digest('hex') } });
      } catch (error) { fail(error.message === 'SUBMISSION_SEQUENCE_INVALID' ? error.message : 'SUBMISSION_BODY_UNAVAILABLE'); return; }
    }
    if (record.method === 'DELETE') {
      const run = runs.get(record.runId);
      if (record.collection !== 'runs' || !run || run.threadId !== record.threadId || terminalRunStatus(runStates.get(run.runId))) { fail('CANCEL_REQUEST_UNCORRELATED'); return; }
      emit({ kind: 'cancel-request', payload: { ...run, method: 'DELETE', requestPhase: record.phase } });
    }
    requests.set(event.requestId, record);
  });
  cdp.on('Network.responseReceived', event => {
    const record = requests.get(event.requestId);
    if (!record) return;
    record.eligible = event.response.status >= 200 && event.response.status < 300 &&
      !event.response.fromDiskCache && !event.response.fromServiceWorker && !event.response.fromPrefetchCache;
  });
  cdp.on('Network.dataReceived', event => {
    const record = requests.get(event.requestId);
    if (!record || stopped) return;
    if (!Number.isSafeInteger(event.dataLength) || event.dataLength < 0) { fail('HTTP_BYTE_OBSERVATION_INVALID'); return; }
    record.bodyObserved = true; record.bytes += event.dataLength;
    if (record.bytes > 1048576) fail('HTTP_RESPONSE_BYTE_LIMIT');
  });
  cdp.on('Network.loadingFinished', event => {
    const record = requests.get(event.requestId);
    if (!record) return;
    requests.delete(event.requestId);
    if (stopped) return;
    if (!record.eligible || !record.bodyObserved || record.bytes <= 0 || record.bytes > 1048576) { fail('BOUNDED_HTTP_BODY_UNAVAILABLE'); return; }
    const job = (async () => {
      const response = await cdp.send('Network.getResponseBody', { requestId: event.requestId });
      if (stopped) return;
      const body = Buffer.from(response.body, response.base64Encoded ? 'base64' : 'utf8');
      if (body.length !== record.bytes || body.length > 1048576) throw new Error('HTTP_BODY_ACCOUNTING_MISMATCH');
      const payload = JSON.parse(body.toString('utf8'));
      if (record.collection === 'runs' && record.method === 'POST' && !record.runId) {
        if (!validId(payload.runId) || !validId(payload.assistantMessageId) || !statuses.has(payload.status) || runs.has(payload.runId) ||
          [...runs.values()].some(run => run.assistantMessageId === payload.assistantMessageId || run.clientMessageId === record.clientMessageId)) throw new Error('ACCEPTANCE_IDENTITY_MISMATCH');
        accepted = { threadId: record.threadId, clientMessageId: record.clientMessageId, runId: payload.runId, assistantMessageId: payload.assistantMessageId };
        runs.set(accepted.runId, accepted);
        emit({ kind: 'run-accepted', payload: { ...accepted, status: payload.status } });
        runStatus(record, { ...payload, id: payload.runId, threadId: record.threadId });
      } else if (record.collection === 'runs' && record.runId && ['GET', 'DELETE'].includes(record.method)) {
        if (record.runId !== payload.id) throw new Error('RUN_STATUS_IDENTITY_MISMATCH');
        runStatus(record, payload);
      } else if (record.collection === 'messages' && record.method === 'GET' && record.phase === 'reload') {
        if (!accepted || accepted.threadId !== record.threadId || !Array.isArray(payload.messages) || payload.messages.length > 100) throw new Error('PERSISTENCE_BODY_UNAVAILABLE');
        const messages = payload.messages.map(message => {
          if (!validId(message.id) || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 4096) throw new Error('PERSISTENCE_BODY_UNAVAILABLE');
          return { id: message.id, role: message.role, content: message.content };
        });
        emit({ kind: 'persisted-messages', payload: { source: 'http-response', requestPhase: record.phase,
          threadId: record.threadId, pageComplete: false, completeness: 'endpoint-does-not-attest-completeness', messages } });
      }
    })().catch(error => fail(/^[A-Z_]+$/.test(error.message) ? error.message : 'HTTP_OBSERVATION_FAILED'));
    pending.add(job); void job.finally(() => pending.delete(job));
  });
  cdp.on('Network.loadingFailed', event => { if (requests.delete(event.requestId)) fail('HTTP_OBSERVATION_INTERRUPTED'); });
  return {
    latestAccepted() { return accepted ? { ...accepted } : null; },
    status(runId) { return runStates.get(runId) ?? null; },
    waitForTerminal(milliseconds, runId = accepted?.runId) {
      if (stopped) return Promise.reject(new Error('HTTP_OBSERVATION_STOPPED'));
      if (terminals.has(runId)) return Promise.resolve({ ...terminals.get(runId) });
      if (waiter) return Promise.reject(new Error('TERMINAL_WAIT_ALREADY_ACTIVE'));
      return new Promise((resolve, reject) => {
        waiter = { resolve, reject, runId };
        timeout = setTimeout(() => { stopped = true; waiter = null; reject(new Error('TERMINAL_HTTP_EVIDENCE_MISSING')); }, milliseconds);
      });
    },
    stop() { stopped = true; clearTimeout(timeout); waiter?.reject(new Error('HTTP_OBSERVATION_STOPPED')); },
  };
}