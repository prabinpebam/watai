import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateAuthHeuristics } from './auth-heuristics.mjs';
import { evaluateChatHeuristics } from './chat-heuristics.mjs';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { observeChatHttp, terminalRunStatus } from './chat-http.mjs';
import { pilotChatPlans } from './pilot-chat-plans.mjs';
import { evaluatePilotChat } from './pilot-chat-heuristics.mjs';
import { createPilotMonitor, drivePilotChat } from './pilot-chat-driver.mjs';
import { JSDOM } from 'jsdom';
import { buildCaptureRuntime } from './capture-bootstrap.mjs';
import { createCapturePolicy, createPhaseBudget, budgetViolation, validateFlow, preflight, evaluate, evaluatePreparedHeuristics, replay, safeLocation, targetUrl,
  attachExistingBrowser, closeOwnedBrowserResources, validateExistingBrowserReceipt, pilotWorkCommand, runPilotOnce } from './core.mjs';

const { flows } = JSON.parse(readFileSync(new URL('./flows.json', import.meta.url)));
const chat = flows.find(flow => flow.id === 'CHAT-01');
const row = (role, y) => ({ role, visible: true, initialEntrance: false, bounds: { y, height: 20 } });
test('five-flow POC consumes one permit and executes each fixed flow once', async () => {
  const selected = [...flows, ...pilotChatPlans(chat).map(plan => plan.flow)];
  const calls = [];
  const result = await runPilotOnce({ flows: selected, inspect: async flow => { calls.push(`inspect:${flow.id}`); return { ready: true }; },
    consumePermit: async () => calls.push('consume'), run: async flow => { calls.push(`run:${flow.id}`); return { status: 'DIAGNOSTIC_PASS' }; } });
  assert.equal(result.status, 'OBSERVATIONS_COLLECTED');
  assert.equal(calls.filter(call => call === 'consume').length, 1);
  assert.deepEqual(calls.slice(6), selected.map(flow => `run:${flow.id}`));
  assert.notEqual(pilotWorkCommand({}, selected, {}), pilotWorkCommand({}, selected, { liveEnabled: true }));
});

test('POC keeps readiness before permit consumption and stops at its first unsuccessful flow', async () => {
  const selected = [...flows, ...pilotChatPlans(chat).map(plan => plan.flow)];
  let consumed = 0;
  const attempted = [];
  const run = async flow => { attempted.push(flow.id); return { status: flow.id === 'CHAT-01' ? 'FAIL' : 'DIAGNOSTIC_PASS' }; };
  const denied = await runPilotOnce({ flows: selected, inspect: async () => ({ ready: false }), consumePermit: async () => { consumed++; }, run });
  assert.equal(denied.status, 'BLOCKED'); assert.equal(consumed, 0); assert.deepEqual(attempted, []);
  const stopped = await runPilotOnce({ flows: selected, inspect: async () => ({ ready: true }), consumePermit: async () => { consumed++; }, run });
  assert.equal(stopped.status, 'STOPPED'); assert.equal(consumed, 1); assert.deepEqual(attempted, ['AUTH-01', 'CHAT-01']);
  await assert.rejects(runPilotOnce({ flows: selected.slice(1) }), /EXACT_PILOT_SCOPE_REQUIRED/);
});

test('attached browser admission rejects unready, nonloopback and changed identities before connection', async () => {
  let connected = 0;
  let checked = 0;
  const receipt = { endpoint: 'http://127.0.0.1:9222', endpointVerified: true, cloning: false, originalProfileChanged: false,
    processId: 1234, processStartedAt: '2026-09-12T12:00:00.000Z', profileDirectory: 'Default',
    userDataDirectory: 'C:\\Users\\test\\AppData\\Local\\WataiEval\\AutomationProfiles\\0566de25-53a4-485f-9bb5-541e05e07e40' };
  const input = { receipt, assertReady: () => { throw new Error('NOT_READY'); }, verifyProcess: () => { checked++; return false; }, connect: () => { connected++; } };
  await assert.rejects(attachExistingBrowser(input), /NOT_READY/);
  assert.equal(checked, 0); assert.equal(connected, 0);
  for (const endpoint of ['http://0.0.0.0:9222', 'http://localhost:9222', 'https://example.com', 'http://127.0.0.1:9222/extra']) {
    assert.throws(() => validateExistingBrowserReceipt({ ...receipt, endpoint }), /RECEIPT_INVALID/);
  }
  await assert.rejects(attachExistingBrowser({ ...input, assertReady() {} }), /IDENTITY_CHANGED/);
  assert.equal(connected, 0);
});

test('attached browser cleanup never closes borrowed browser, context or page, including ambiguous targets', async () => {
  let closed = 0;
  const context = { pages: () => [page], close: async () => { closed++; } };
  const page = { url: () => `${targetUrl}#/settings/account`, context: () => context, close: async () => { closed++; } };
  const browser = { contexts: () => [context], close: async () => { closed++; } };
  const receipt = { endpoint: 'http://127.0.0.1:9222', endpointVerified: true, cloning: false, originalProfileChanged: false,
    processId: 1234, processStartedAt: '2026-09-12T12:00:00Z', profileDirectory: 'Default',
    userDataDirectory: 'C:\\Users\\test\\AppData\\Local\\WataiEval\\AutomationProfiles\\0566de25-53a4-485f-9bb5-541e05e07e40' };
  const input = { receipt, assertReady() {}, verifyProcess: () => true, connect: async () => browser };
  const attached = await attachExistingBrowser(input);
  assert.equal(attached.page, page);
  for (const outcome of ['success', 'failure', 'timeout']) await closeOwnedBrowserResources({ ...attached, outcome });
  assert.equal(closed, 0);
  context.pages = () => [page, page];
  await assert.rejects(attachExistingBrowser(input), /EXACTLY_ONE/);
  assert.equal(closed, 0);
  await closeOwnedBrowserResources({ browser, context, ownsResources: true });
  assert.equal(closed, 2);
});

test('host response-observation failure closes capture and blocks later action phases', async () => {
  let closed = 0;
  let actions = 0;
  const policy = createCapturePolicy(() => { closed++; });
  await Promise.reject(new Error('synthetic failed body read')).catch(() => {
    policy.observe({ kind: 'capture-gap', payload: { code: 'RESPONSE_OBSERVATION_FAILED' } });
  });
  assert.equal(closed, 1);
  assert.throws(() => { policy.assertActive(); actions++; }, /CAPTURE_POLICY_STOPPED/);
  policy.observe({ kind: 'capture-gap', payload: { code: 'ANOTHER_GAP' } });
  assert.equal(closed, 1);
  assert.equal(actions, 0);
});
test('actual artifact/evidence bytes and every capture gap stop execution', () => {
  const flow = flows[0];
  assert.equal(budgetViolation(flow, { eventBytes: flow.maxEvidenceBytes - 1024 }), null);
  assert.equal(budgetViolation(flow, { eventBytes: flow.maxEvidenceBytes - 1023 }), 'RUNNER_EVIDENCE_LIMIT');
  assert.equal(budgetViolation(flow, { networkBytes: flow.maxNetworkBytes + 1 }), 'NETWORK_BYTE_LIMIT');
  assert.equal(budgetViolation(flow, { artifactBytes: 4194304 }), null);
  assert.equal(budgetViolation(flow, { artifactBytes: 4194305 }), 'ARTIFACT_IDENTITY_BYTE_LIMIT');
  assert.equal(budgetViolation(flow, { eventKind: 'capture-gap' }), 'CAPTURE_REPORTED_LOSS');
});
function journal() {
  let eventId = 0;
  return [...chat.phases.map(phase => ({ kind: 'phase', payload: { phase } })),
    { kind: 'frame', documentId: 'doc', sequence: 1, payload: { gapMs: 16, visibility: 'visible' } },
    { kind: 'snapshot', documentId: 'doc', sequence: 2, payload: { nodes: [row('user-message', 10), row('assistant-message', 40)] } },
    { kind: 'capture-stopped', payload: {} }, { kind: 'outcome', payload: { answer: true, restored: true, prompt: true, oneSubmission: true } },
  ].map(event => ({ ...event, eventId: ++eventId }));
}
test('every executable flow has fixed phases, regions and bounded budgets', () => {
  for (const flow of flows) assert.equal(validateFlow(flow), flow);
  assert.throws(() => validateFlow({ ...chat, maxEvents: Infinity }), /BUDGET/);
});
test('preflight fails closed and public mode never borrows an authenticated profile', () => {
  assert.equal(preflight({}, flows[0]).ready, false);
  const unprepared = preflight({ target: targetUrl, liveEnabled: true }, flows[0], { approvalValid: true });
  assert.equal(unprepared.ready, false);
  assert.ok(unprepared.blockers.includes('FLOW_PREPARATION_REQUIRED'));
  assert.ok(unprepared.blockers.includes('SEMANTIC_REVIEW_HARNESS_REQUIRED'));
  assert.equal(preflight({ target: targetUrl, liveEnabled: true, authStateFile: 'private' }, flows[0], { approvalValid: true }).ready, false);
  assert.equal(preflight({ target: targetUrl, liveEnabled: true }, chat, { approvalValid: true }).ready, false);
});
test('calibration and diagnostic success never grant release eligibility', () => {
  const result = evaluate(chat, journal(), { evidenceClass: 'calibration' });
  assert.equal(result.status, 'DIAGNOSTIC_PASS');
  assert.equal(result.releaseEligible, false);
  assert.deepEqual(result.semanticEvaluation, { required: true, status: 'NOT_RUN' });
  assert.equal(result.fullEddStatus, 'NOT_QUALIFIED');
});
test('transient inversion survives a corrected final snapshot', () => {
  const events = journal();
  const position = events.findIndex(event => event.kind === 'snapshot');
  events.splice(position, 0, { kind: 'snapshot', documentId: 'other', sequence: 1, eventId: 10,
    payload: { nodes: [row('assistant-message', 10), row('user-message', 40)] } });
  assert.equal(evaluate(chat, events).status, 'FAIL');
  assert.ok(evaluate(chat, events).findings.some(item => item.code === 'RESPONSE_BEFORE_PROMPT'));
});
test('sequence gaps and absent required branches are not vacuous passes', () => {
  const events = journal().filter(event => event.payload.phase !== 'reload');
  events.find(event => event.kind === 'snapshot').sequence = 4;
  assert.equal(evaluate(chat, events).status, 'INSUFFICIENT_EVIDENCE');
});
test('first-frame startup latency is distinct from a later missed frame interval', () => {
  const events = journal();
  const frame = events.find(event => event.kind === 'frame');
  frame.payload = { gapMs: null, startupWaitMs: 505, firstFrame: true, visibility: 'visible' };
  assert.equal(evaluate(chat, events).status, 'DIAGNOSTIC_PASS');
  frame.payload = { gapMs: 505, startupWaitMs: null, firstFrame: false, visibility: 'visible' };
  assert.equal(evaluate(chat, events).status, 'INSUFFICIENT_EVIDENCE');
});
test('an empty success payload cannot pass mandatory outcome requirements', () => {
  const events = journal();
  events.find(event => event.kind === 'outcome').payload = {};
  const result = evaluate(chat, events);
  assert.equal(result.status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(result.findings.filter(item => item.code.startsWith('MISSING_OUTCOME:')).length, 4);
});
test('capture failure cannot erase a reliably observed product failure', () => {
  const events = journal();
  events.push({ kind: 'page-error', eventId: 90, payload: {} }, { kind: 'capture-gap', eventId: 91, payload: { code: 'OVERFLOW' } });
  const result = evaluate(chat, events);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.evidenceSufficientForImplementedChecks, false);
});
test('replay can inspect an earlier checkpoint without executing product code', () => {
  const events = journal();
  assert.equal(Object.keys(replay(events, 1).documents).length, 0);
  assert.equal(replay(events).documents.doc.nodes.length, 2);
});
test('network location metadata never retains query or URL credentials', () => {
  const metadata = safeLocation('https://user:password@example.com/private?token=secret#secret');
  assert.equal(metadata.origin, 'https://example.com');
  assert.equal(JSON.stringify(metadata).includes('secret'), false);
  assert.equal(JSON.stringify(metadata).includes('password'), false);
});

function publicJournal() {
  const heading = { id: 'heading', regionId: 'welcome', role: 'h1', text: 'Welcome to Watai', visible: true,
    bounds: { x: 100, y: 100, width: 400, height: 40 } };
  const button = { id: 'signin', regionId: 'welcome', role: 'button', accessibleName: 'Sign in', visible: true, disabled: false,
    ancestorVisible: true, bounds: { x: 100, y: 180, width: 400, height: 48 }, clipBounds: { x: 0, y: 0, width: 1280, height: 850 }, hitTargetId: 'signin' };
  const payload = { coverage: { welcome: 'complete' }, nodes: [heading, button], viewport: { width: 1280, height: 850 }, focusId: 'body' };
  return [{ kind: 'phase', payload: { phase: 'navigate' } }, { kind: 'frame', payload: { visibility: 'visible', gapMs: 16 } },
    { kind: 'phase', payload: { phase: 'ready' } }, { kind: 'snapshot', payload: structuredClone(payload) },
    { kind: 'phase', payload: { phase: 'inspect' } }, { kind: 'action', payload: { name: 'Tab' } },
    { kind: 'snapshot', payload: { ...structuredClone(payload), focusId: 'signin', focusPaint: { visibleRingPixels: 320, screenshotId: 'focused' } } },
    { kind: 'capture-stopped', payload: {} }, { kind: 'outcome', payload: { heading: true, signInOperable: true, keyboardFocus: true } },
  ].map((event, index) => ({ ...event, eventId: index + 1 }));
}

test('public heuristics use observed content and paint, never driver success flags', () => {
  const events = publicJournal();
  assert.equal(evaluateAuthHeuristics(flows[0], events).status, 'DIAGNOSTIC_PASS');
  events.find(event => event.kind === 'outcome').payload = { heading: false, signInOperable: false, keyboardFocus: false };
  assert.equal(evaluateAuthHeuristics(flows[0], events).status, 'DIAGNOSTIC_PASS');
  events.find(event => event.kind === 'snapshot').payload.nodes[0].text = 'Wrong app';
  assert.equal(evaluateAuthHeuristics(flows[0], events).status, 'FAIL');
});

for (const defect of ['covered', 'clipped', 'offscreen', 'disabled', 'ancestor-hidden', 'missing-heading', 'duplicate-heading', 'invisible-focus']) {
  test(`public heuristic preserves transient ${defect} despite later correct state`, () => {
    const events = publicJournal();
    const snapshot = events.find(event => event.kind === 'snapshot');
    const button = snapshot.payload.nodes[1];
    if (defect === 'covered') button.hitTargetId = 'overlay';
    if (defect === 'clipped') button.clipBounds.width = 20;
    if (defect === 'offscreen') button.bounds.y = 900;
    if (defect === 'disabled') button.disabled = true;
    if (defect === 'ancestor-hidden') button.ancestorVisible = false;
    if (defect === 'missing-heading') snapshot.payload.nodes.shift();
    if (defect === 'duplicate-heading') snapshot.payload.nodes.push({ ...snapshot.payload.nodes[0], id: 'other-heading' });
    if (defect === 'invisible-focus') events.findLast(event => event.kind === 'snapshot').payload.focusPaint.visibleRingPixels = 0;
    const result = evaluateAuthHeuristics(flows[0], events);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.releaseEligible, false);
  });
}

test('missing recorder fields are insufficient, and cannot erase an observed public failure', () => {
  const events = publicJournal();
  delete events.find(event => event.kind === 'snapshot').payload.nodes[1].clipBounds;
  assert.equal(evaluateAuthHeuristics(flows[0], events).status, 'INSUFFICIENT_EVIDENCE');
  events.findLast(event => event.kind === 'snapshot').payload.nodes[0].text = 'Wrong app';
  assert.equal(evaluateAuthHeuristics(flows[0], events).status, 'FAIL');
});

test('public capture gaps and missing focus paint cannot pass', () => {
  const events = publicJournal();
  events[1].payload.gapMs = 300;
  delete events.findLast(event => event.kind === 'snapshot').payload.focusPaint;
  const result = evaluateAuthHeuristics(flows[0], events);
  assert.equal(result.status, 'INSUFFICIENT_EVIDENCE');
  assert.ok(result.findings.some(finding => finding.code === 'FRAME_GAP'));
  assert.ok(result.findings.some(finding => finding.code === 'FOCUS_PAINT_MISSING'));
});

test('recorder emits actual welcome regions, names and operability evidence without inventing focus pixels', async () => {
  const runtime = await buildCaptureRuntime();
  const dom = new JSDOM('<div class="onboard"><h1 class="onboard__title">Welcome to Watai</h1><div class="onboard__actions"><button><span>Sign in</span></button></div></div>', {
    url: targetUrl, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const browser = dom.window;
  const events = [];
  browser.__wataiEvidence = async batch => events.push(...batch);
  browser.TextEncoder = TextEncoder;
  browser.HTMLElement.prototype.checkVisibility = function () { return this.style.visibility !== 'hidden'; };
  browser.HTMLElement.prototype.getAnimations = () => [];
  browser.HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 50, y: this.tagName === 'H1' ? 50 : 120, width: 300, height: 40 };
  };
  browser.document.elementFromPoint = () => browser.document.querySelector('button span');
  try {
    browser.flow = { ...flows[0], captureOrigins: [new URL(targetUrl).origin] };
    browser.eval(`${runtime}\nWataiCaptureRuntime.install(flow)`);
    const checkpoint = await browser.__wataiEvalCapture.checkpoint();
    const first = events.findLast(event => event.kind === 'snapshot');
    assert.equal(checkpoint.documentId, first.documentId);
    assert.equal(checkpoint.snapshotSequence, first.sequence);
    assert.ok(checkpoint.sequence >= checkpoint.snapshotSequence);
    const button = first.payload.nodes.find(node => node.role === 'button');
    assert.equal(first.payload.coverage.welcome, 'complete');
    assert.equal(button.regionId, 'welcome');
    assert.equal(button.accessibleName, 'Sign in');
    assert.equal(button.ancestorVisible, true);
    assert.equal(button.hitWithinElement, true);
    assert.ok(button.clipBounds.width > 0);
    assert.equal(first.payload.focusPaint, null);
    const actualButton = browser.document.querySelector('button');
    actualButton.setAttribute('aria-label', 'A');
    actualButton.setAttribute('aria-label', 'B');
    actualButton.setAttribute('aria-label', 'A');
    actualButton.removeAttribute('aria-label');
    await Promise.resolve();
    await browser.__wataiEvalCapture.checkpoint();
    const attributeHistory = events.filter(event => event.kind === 'mutation' && event.payload.attribute === 'aria-label').map(event =>
      [event.payload.oldValue, event.payload.newValue]);
    assert.equal(JSON.stringify(attributeHistory), JSON.stringify([[null, 'A'], ['A', 'B'], ['B', 'A'], ['A', null]]));
    browser.document.querySelector('.onboard').style.opacity = '0';
    await browser.__wataiEvalCapture.checkpoint();
    const hidden = events.findLast(event => event.kind === 'snapshot').payload.nodes.find(node => node.role === 'button');
    assert.equal(hidden.ancestorVisible, false);
    const observedFlow = [
      { kind: 'phase', payload: { phase: 'navigate' } }, { kind: 'phase', payload: { phase: 'ready' } },
      ...events, { kind: 'phase', payload: { phase: 'inspect' } }, { kind: 'capture-stopped', payload: {} },
    ].map((event, index) => ({ ...event, eventId: index + 1 }));
    assert.ok(evaluateAuthHeuristics(flows[0], observedFlow).findings.some(finding => finding.code === 'SIGN_IN_NOT_OPERABLE'));
    browser.document.querySelector('.onboard').style.opacity = '1';
    await browser.__wataiEvalCapture.stop();
    assert.ok(events.some(event => event.kind === 'snapshot' && event.payload.nodes.some(node => node.role === 'button' && node.ancestorVisible === false)));
  } finally {
    await browser.__wataiEvalCapture?.stop();
    browser.close();
  }
});

function contentJournal() {
  const prompt = { role: 'user-message', domainId: 'prompt-1', content: chat.prompt, visible: true, bounds: { y: 10, width: 200, height: 40 } };
  const reply = { role: 'assistant-message', domainId: 'reply-1', content: '46', contentHasFormatting: false, visible: true, bounds: { y: 60, width: 200, height: 40 } };
  const snapshot = (documentId, nodes, status = 'running') => ({ kind: 'snapshot', documentId,
    payload: { coverage: { message: 'complete' }, nodes: structuredClone(nodes), observedRunStates: status ? { 'run-1': status } : {} } });
  const phase = name => ({ kind: 'phase', payload: { phase: name } });
  const status = value => ({ kind: 'run-status', payload: { runId: 'run-1', threadId: 'thread-1', clientMessageId: 'prompt-1', assistantMessageId: 'reply-1', status: value } });
  return [phase('navigate'), { kind: 'frame', payload: { gapMs: 16, visibility: 'visible' } }, phase('ready'), phase('compose'), phase('submit'),
    { kind: 'submitted-run', payload: { clientMessageId: 'prompt-1', threadId: 'thread-1', promptSha256: createHash('sha256').update(chat.prompt).digest('hex') } },
    snapshot('original', [prompt]), { kind: 'run-accepted', payload: { runId: 'run-1', threadId: 'thread-1', clientMessageId: 'prompt-1', assistantMessageId: 'reply-1' } },
    status('running'), phase('response'), snapshot('original', [prompt, reply]), status('complete'), phase('complete'), snapshot('original', [prompt, reply], 'complete'),
    phase('reload'), { kind: 'persisted-messages', payload: { source: 'http-response', requestPhase: 'reload', pageComplete: true, threadId: 'thread-1',
      messages: [{ id: 'prompt-1', role: 'user', content: chat.prompt }, { id: 'reply-1', role: 'assistant', content: '46' }] } },
    snapshot('reloaded', [prompt, reply], null), { kind: 'capture-stopped', payload: {} },
  ].map((event, index) => ({ ...event, eventId: index + 1 }));
}

test('CHAT content and persistence checks require original identity-bound observations', () => {
  const events = contentJournal();
  assert.equal(evaluateChatHeuristics(chat, events).status, 'DIAGNOSTIC_PASS');
  const missing = events.filter(event => event.kind !== 'persisted-messages').map((event, index) => ({ ...event, eventId: index + 1 }));
  assert.equal(evaluateChatHeuristics(chat, missing).status, 'INSUFFICIENT_EVIDENCE');
});

for (const defect of ['transient-prompt-loss', 'wrong-answer', 'wrong-reply-id', 'wrong-persisted-answer', 'changed-prompt', 'formatted-answer']) {
  test(`CHAT detects ${defect} without trusting successful driver outcomes`, () => {
    const events = contentJournal();
    const snapshots = events.filter(event => event.kind === 'snapshot');
    if (defect === 'transient-prompt-loss') snapshots[1].payload.nodes.shift();
    if (defect === 'wrong-answer') snapshots[2].payload.nodes[1].content = '47';
    if (defect === 'wrong-reply-id') snapshots[2].payload.nodes[1].domainId = 'other-reply';
    if (defect === 'wrong-persisted-answer') events.find(event => event.kind === 'persisted-messages').payload.messages[1].content = '47';
    if (defect === 'changed-prompt') snapshots[0].payload.nodes[0].content = 'A different question';
    if (defect === 'formatted-answer') snapshots[2].payload.nodes[1].contentHasFormatting = true;
    events.push({ eventId: events.length + 1, kind: 'outcome', payload: { answer: true, restored: true, prompt: true, oneSubmission: true } });
    const result = evaluateChatHeuristics(chat, events);
    assert.equal(result.status, 'FAIL');
    assert.equal(result.releaseEligible, false);
  });
}

test('uncorrelated optimistic assistant identity is insufficient, not a guessed handoff', () => {
  const events = contentJournal();
  events.filter(event => event.kind === 'snapshot')[1].payload.nodes[1].domainId = 'optimistic-unknown';
  const result = evaluateChatHeuristics(chat, events);
  assert.equal(result.status, 'INSUFFICIENT_EVIDENCE');
  assert.ok(result.findings.some(finding => finding.code === 'ASSISTANT_HANDOFF_UNCORRELATED'));
});

test('prepared reporting uses original evidence rather than driver outcome booleans', () => {
  const events = publicJournal();
  events.find(event => event.kind === 'outcome').payload = { heading: false, signInOperable: false, keyboardFocus: false };
  assert.equal(evaluatePreparedHeuristics(flows[0], events).status, 'DIAGNOSTIC_PASS');
  events.find(event => event.kind === 'snapshot').payload.nodes[0].text = 'Wrong app';
  events.find(event => event.kind === 'outcome').payload = { heading: true, signInOperable: true, keyboardFocus: true };
  assert.equal(evaluatePreparedHeuristics(flows[0], events).status, 'FAIL');
  assert.equal(evaluatePreparedHeuristics(flows[0], events).fullEddStatus, 'NOT_QUALIFIED');
});

function httpFixture(maxSubmissions = 1) {
  const cdp = new EventEmitter();
  const events = [];
  const pending = new Set();
  const bodies = new Map();
  let buffered = 0;
  let currentPhase = 'submit';
  cdp.send = async (_command, { requestId }) => { buffered++; return { body: bodies.get(requestId), base64Encoded: false }; };
  const observer = observeChatHttp({ cdp, emit: event => events.push(event), stop: () => {}, phase: () => currentPhase, pending, maxSubmissions });
  const respond = async (requestId, payload, { method = 'POST', suffix = '', bytes, collection = 'runs', afterRequest, response = {}, clientMessageId = 'prompt-1' } = {}) => {
    const body = JSON.stringify(payload); bodies.set(requestId, body);
    cdp.emit('Network.requestWillBeSent', { requestId, request: { url: `https://func-watai-cbroocyg3omrk.azurewebsites.net/api/threads/thread-1/${collection}${suffix}`,
      method, postData: JSON.stringify({ clientMessageId, text: chat.prompt }) } });
    afterRequest?.();
    cdp.emit('Network.responseReceived', { requestId, response: { status: method === 'POST' ? 202 : 200, ...response } });
    cdp.emit('Network.dataReceived', { requestId, dataLength: bytes ?? Buffer.byteLength(body) });
    cdp.emit('Network.loadingFinished', { requestId });
    await Promise.all([...pending]);
  };
  return { observer, events, respond, buffered: () => buffered, phase: value => { currentPhase = value; } };
}

test('actual decoded HTTP byte limit stops before whole-body buffering', async () => {
  const fixture = httpFixture();
  await fixture.respond('request-1', { runId: 'run-1', assistantMessageId: 'reply-1', status: 'queued' }, { bytes: 1048577 });
  assert.equal(fixture.buffered(), 0);
  assert.ok(fixture.events.some(event => event.payload.code === 'HTTP_RESPONSE_BYTE_LIMIT'));
});

for (const status of ['complete', 'error', 'canceled']) {
  test(`actual ${status} HTTP receipt terminates independently of answer text`, async () => {
    const fixture = httpFixture();
    await fixture.respond('request-1', { runId: 'run-1', assistantMessageId: 'reply-1', status: 'queued', executionToken: 'DO_NOT_RETAIN' });
    await fixture.respond('request-2', { id: 'run-1', threadId: 'thread-1', assistantMessageId: 'reply-1', status }, { method: 'GET', suffix: '/run-1' });
    assert.equal((await fixture.observer.waitForTerminal(20)).status, status);
    assert.equal(JSON.stringify(fixture.events).includes('DO_NOT_RETAIN'), false);
    fixture.observer.stop();
  });
}

test('cancel_requested remains active and wrong HTTP identity fails closed', async () => {
  assert.equal(terminalRunStatus('cancel_requested'), false);
  const fixture = httpFixture();
  await fixture.respond('request-1', { runId: 'run-1', assistantMessageId: 'reply-1', status: 'queued' });
  await fixture.respond('request-2', { id: 'wrong-run', threadId: 'thread-1', assistantMessageId: 'reply-1', status: 'complete' }, { method: 'GET', suffix: '/run-1' });
  await assert.rejects(fixture.observer.waitForTerminal(20), /HTTP_OBSERVATION_STOPPED/);
  assert.ok(fixture.events.some(event => event.payload.code === 'RUN_STATUS_IDENTITY_MISMATCH'));
});

test('HTTP message freshness uses request phase and never invents pagination completeness', async () => {
  const fixture = httpFixture();
  await fixture.respond('accept', { runId: 'run-1', assistantMessageId: 'reply-1', status: 'queued' });
  const payload = { messages: [{ id: 'prompt-1', role: 'user', content: chat.prompt }, { id: 'reply-1', role: 'assistant', content: '46' }] };
  fixture.phase('complete');
  await fixture.respond('stale', payload, { method: 'GET', collection: 'messages', afterRequest: () => fixture.phase('reload') });
  assert.equal(fixture.events.some(event => event.kind === 'persisted-messages'), false);
  await fixture.respond('fresh', payload, { method: 'GET', collection: 'messages' });
  const evidence = fixture.events.find(event => event.kind === 'persisted-messages');
  assert.equal(evidence.payload.requestPhase, 'reload');
  assert.equal(evidence.payload.pageComplete, false);
  assert.equal(evidence.payload.messages[1].content, '46');
  fixture.observer.stop();
});

test('cached HTTP bodies are not buffered without actual decoded-byte evidence', async () => {
  const fixture = httpFixture();
  await fixture.respond('cached', { runId: 'run-1', assistantMessageId: 'reply-1', status: 'complete' }, { response: { fromDiskCache: true } });
  assert.equal(fixture.buffered(), 0);
  assert.ok(fixture.events.some(event => event.payload.code === 'BOUNDED_HTTP_BODY_UNAVAILABLE'));
});

test('authored phase budgets reject skipped, repeated and late transitions', () => {
  let time = 0;
  const budget = createPhaseBudget([{ phase: 'navigate', deadlineMs: 20 }, { phase: 'ready', deadlineMs: 5 }], () => time);
  assert.throws(() => budget.enter('ready'), /UNDECLARED_PHASE_TRANSITION/);
  assert.equal(budget.enter('navigate'), 20);
  time = 18;
  assert.equal(budget.remaining(100), 2);
  assert.throws(() => budget.enter('navigate'), /UNDECLARED_PHASE_TRANSITION/);
  time = 20;
  assert.throws(() => budget.enter('ready'), /PHASE_DEADLINE_EXCEEDED/);
  assert.throws(() => budget.remaining(100), /PHASE_DEADLINE_EXCEEDED/);
});

function pilotJournal(id) {
  const { flow } = pilotChatPlans(chat).find(item => item.flow.id === id);
  const events = [];
  const rows = [];
  const runStates = {};
  const add = (kind, payload) => {
    if (kind === 'run-status') runStates[payload.runId] = payload.status;
    events.push({ eventId: events.length + 1, kind, payload: structuredClone(kind === 'snapshot' ? { ...payload, observedRunStates: { ...runStates } } : payload), ...(kind === 'snapshot' ? { documentId: 'doc' } : {}) });
  };
  const phase = name => add('phase', { phase: name });
  const submit = index => {
    add('submitted-run', { threadId: 'thread', clientMessageId: `prompt-${index}` });
    add('run-accepted', { runId: `run-${index}`, threadId: 'thread', clientMessageId: `prompt-${index}`, assistantMessageId: `reply-${index}` });
    rows.push({ domainId: `prompt-${index}`, role: 'user-message', content: flow.prompts[index], visible: true, bounds: { y: index * 100 } },
      { domainId: `reply-${index}`, role: 'assistant-message', content: '', visible: true, bounds: { y: index * 100 + 30 } });
    add('run-status', { runId: `run-${index}`, threadId: 'thread', status: 'running' });
  };
  let anchor;
  const snapshot = () => add('snapshot', { coverage: { message: 'complete' }, nodes: rows, ...(anchor ? { anchor } : {}) });
  const complete = index => { add('run-status', { runId: `run-${index}`, threadId: 'thread', status: 'complete' }); rows[index * 2 + 1].content = flow.answers[index]; snapshot(); };
  phase('ready');
  if (id === 'CHAT-02') {
    phase('seed'); submit(0); complete(0);
    phase('follow-up'); submit(1); snapshot();
    phase('complete'); complete(1);
  } else {
    phase('submit'); submit(0);
    phase('stream'); rows[1].content = '1'; snapshot(); rows[1].content = '1\n2'; snapshot();
    if (id === 'CHAT-03') {
      rows[1].content = '1\n2\n3'; snapshot(); phase('read-history');
      anchor = { messageId: 'prompt-0', offset: 20, visible: true };
      add('anchor-pinned', { ...anchor, source: 'real-wheel' });
      rows[1].content = '1\n2\n3\n4'; snapshot(); rows[1].content = '1\n2\n3\n4\n5'; snapshot();
      phase('complete'); complete(0);
    } else {
      add('action', { name: 'Stop', runId: 'run-0' }); add('cancel-request', { method: 'DELETE', runId: 'run-0' });
      phase('cancel'); add('run-status', { runId: 'run-0', threadId: 'thread', status: 'cancel_requested' });
      add('run-status', { runId: 'run-0', threadId: 'thread', status: 'canceled' }); snapshot();
      phase('next-prompt'); submit(1); snapshot(); phase('complete'); complete(1);
    }
  }
  add('capture-stopped', {});
  return { flow, events };
}

for (const id of ['CHAT-02', 'CHAT-03', 'CHAT-04']) {
  test(`${id} pilot has a distinct passing observation path and rejects wrong terminal content`, () => {
    const { flow, events } = pilotJournal(id);
    assert.equal(evaluatePilotChat(flow, events).status, 'DIAGNOSTIC_PASS');
    events.findLast(event => event.kind === 'snapshot').payload.nodes.at(-1).content = 'wrong';
    assert.equal(evaluatePilotChat(flow, events).status, 'FAIL');
  });
}
test('pilot streaming requires updates and detects pinned-anchor movement', () => {
  const { flow, events } = pilotJournal('CHAT-03');
  events.findLast(event => event.kind === 'snapshot').payload.anchor.offset = 40;
  assert.ok(evaluatePilotChat(flow, events).findings.some(item => item.code === 'READING_ANCHOR_MOVED'));
  const missing = events.filter(event => event.kind !== 'anchor-pinned').map((event, index) => ({ ...event, eventId: index + 1 }));
  assert.ok(evaluatePilotChat(flow, missing).findings.some(item => item.code === 'ANCHORED_STREAM_NOT_REACHED'));
});
test('pilot cancellation rejects late old-reply writes and request-only cancellation', () => {
  const { flow, events } = pilotJournal('CHAT-04');
  events.findLast(event => event.kind === 'snapshot').payload.nodes[1].content += '\n3';
  assert.ok(evaluatePilotChat(flow, events).findings.some(item => item.code === 'CANCELED_REPLY_CHANGED'));
  const missing = events.filter(event => !(event.kind === 'run-status' && event.payload.status === 'canceled')).map((event, index) => ({ ...event, eventId: index + 1 }));
  assert.ok(evaluatePilotChat(flow, missing).findings.some(item => item.code === 'CANCELLATION_BRANCH_NOT_REACHED'));
});
test('pilot follow-up preserves earlier messages through every state', () => {
  const { flow, events } = pilotJournal('CHAT-02');
  events.filter(event => event.kind === 'snapshot')[1].payload.nodes.shift();
  assert.ok(evaluatePilotChat(flow, events).findings.some(item => item.code === 'PREVIOUS_MESSAGE_DISAPPEARED'));
});

test('a later correction cannot hide a wrong earlier completed pilot answer', () => {
  const { flow, events } = pilotJournal('CHAT-02');
  events.find(event => event.kind === 'snapshot').payload.nodes[1].content = 'Incorrect acknowledgement';
  assert.ok(evaluatePilotChat(flow, events).findings.some(item => item.code === 'WRONG_TERMINAL_ANSWER'));
  const streaming = pilotJournal('CHAT-03');
  const snapshot = streaming.events.filter(event => event.kind === 'snapshot').at(-2);
  snapshot.payload.nodes[1].content += '\n999';
  assert.ok(evaluatePilotChat(streaming.flow, streaming.events).findings.some(item => item.code === 'TERMINAL_STREAM_ROLLBACK'));
});

test('HTTP observer keeps cancellation and next-turn receipts bound to their own runs', async () => {
  const fixture = httpFixture(2);
  await fixture.respond('accept-1', { runId: 'run-1', assistantMessageId: 'reply-1', status: 'running' });
  await fixture.respond('cancel-1', { id: 'run-1', threadId: 'thread-1', assistantMessageId: 'reply-1', status: 'cancel_requested' }, { method: 'DELETE', suffix: '/run-1' });
  assert.equal(fixture.observer.status('run-1'), 'cancel_requested');
  await fixture.respond('done-1', { id: 'run-1', threadId: 'thread-1', assistantMessageId: 'reply-1', status: 'canceled' }, { method: 'GET', suffix: '/run-1' });
  assert.equal((await fixture.observer.waitForTerminal(20, 'run-1')).status, 'canceled');
  await fixture.respond('accept-2', { runId: 'run-2', assistantMessageId: 'reply-2', status: 'running' }, { clientMessageId: 'prompt-2' });
  await fixture.respond('done-2', { id: 'run-2', threadId: 'thread-1', assistantMessageId: 'reply-2', status: 'complete' }, { method: 'GET', suffix: '/run-2' });
  assert.equal((await fixture.observer.waitForTerminal(20, 'run-2')).assistantMessageId, 'reply-2');
  assert.equal((await fixture.observer.waitForTerminal(20, 'run-1')).status, 'canceled');
  assert.equal(fixture.events.filter(event => event.kind === 'cancel-request').length, 1);
  fixture.observer.stop();
});

test('HTTP observer rejects a next submission before the first run is terminal', async () => {
  const fixture = httpFixture(2);
  await fixture.respond('accept-1', { runId: 'run-1', assistantMessageId: 'reply-1', status: 'running' });
  await fixture.respond('accept-2', { runId: 'run-2', assistantMessageId: 'reply-2', status: 'running' }, { clientMessageId: 'prompt-2' });
  assert.ok(fixture.events.some(event => event.payload.code === 'SUBMISSION_SEQUENCE_INVALID'));
});

test('HTTP observer preserves terminal state against a stale running response', async () => {
  const fixture = httpFixture();
  await fixture.respond('accept', { runId: 'run-1', assistantMessageId: 'reply-1', status: 'complete' });
  await fixture.respond('stale', { id: 'run-1', threadId: 'thread-1', assistantMessageId: 'reply-1', status: 'running' }, { method: 'GET', suffix: '/run-1' });
  assert.ok(fixture.events.some(event => event.payload.code === 'TERMINAL_RUN_REGRESSION'));
});

test('pilot monitor counts distinct running snapshots and closes pending waits on evidence loss', async () => {
  const monitor = createPilotMonitor();
  monitor.observe({ kind: 'run-accepted', payload: { runId: 'run', assistantMessageId: 'reply' } });
  monitor.observe({ kind: 'run-status', payload: { runId: 'run', status: 'running' } });
  for (const body of ['1', '1', '1\n2']) monitor.observe({ kind: 'snapshot', payload: { nodes: [{ domainId: 'reply', content: body }] } });
  assert.equal(monitor.state.streams.get('run').updates, 2);
  const wait = monitor.wait(state => state.streams.get('run').updates >= 3, 100);
  monitor.observe({ kind: 'capture-gap', payload: { code: 'LOST_INTERVAL' } });
  await assert.rejects(wait, /LOST_INTERVAL/);
  await assert.rejects(monitor.wait(() => true, 10), /PILOT_MONITOR_CLOSED/);
});

test('follow-up driver waits for terminal first turn before submitting the second', async () => {
  const { flow } = pilotChatPlans(chat).find(plan => plan.flow.id === 'CHAT-02');
  const monitor = createPilotMonitor();
  const actions = [];
  let turn = 0;
  const page = { locator: selector => ({
    fill: async text => actions.push(`fill:${text}`),
    click: async () => { turn++; actions.push(`send:${turn}`); monitor.observe({ kind: 'run-accepted', payload: { runId: `run-${turn}`, threadId: 'thread', assistantMessageId: `reply-${turn}` } }); },
    waitFor: async () => actions.push(`hidden:${selector}`),
    evaluate: async () => true,
  }), evaluate: async () => actions.push('checkpoint') };
  await drivePilotChat({ flow, page, monitor, phase: name => actions.push(`phase:${name}`), budget: { remaining: () => 100 },
    http: { waitForTerminal: async (_milliseconds, runId) => { actions.push(`terminal:${runId}`); return { runId, status: 'complete' }; } },
    emit: () => {}, screenshot: async name => actions.push(`image:${name}`), observeWindow: async () => {}, assertActive: () => {} });
  assert.ok(actions.indexOf('terminal:run-1') < actions.indexOf('send:2'));
  assert.ok(actions.includes('image:follow-up-complete.png'));
  assert.equal(turn, 2);
  monitor.close();
});

function interactiveDriverFixture(id, { cancelWins = true } = {}) {
  const { flow } = pilotChatPlans(chat).find(plan => plan.flow.id === id);
  const monitor = createPilotMonitor();
  const actions = [];
  let turn = 0;
  const terminalRecords = new Map();
  const snapshot = body => monitor.observe({ kind: 'snapshot', payload: {
    nodes: [{ domainId: 'reply-1', content: body }], scroll: { scrollHeight: 1600, clientHeight: 700, scrollTop: 400 },
  } });
  const updateStatus = (runId, status) => {
    monitor.observe({ kind: 'run-status', payload: { runId, status } });
    if (['canceled', 'complete'].includes(status)) terminalRecords.set(runId, { runId, status });
  };
  const page = {
    locator: selector => ({
      fill: async text => actions.push(`fill:${text}`), hover: async () => actions.push('hover-scroll'),
      evaluate: async () => selector === '.chat__scroll' ? 400 : true, waitFor: async () => {},
      click: async () => {
        if (selector === flow.stopSelector) {
          actions.push('stop');
          updateStatus('run-1', cancelWins ? 'canceled' : 'complete');
          return;
        }
        actions.push(`send:${++turn}`);
        monitor.observe({ kind: 'run-accepted', payload: { runId: `run-${turn}`, threadId: 'thread', clientMessageId: `prompt-${turn}`, assistantMessageId: `reply-${turn}` } });
        updateStatus(`run-${turn}`, 'running');
        if (turn === 1) for (const body of ['1', '1\n2', '1\n2\n3']) snapshot(body);
        else updateStatus(`run-${turn}`, 'complete');
      },
    }),
    evaluate: async (_callback, messageId) => {
      if (!messageId) return;
      actions.push('pin-anchor');
      setTimeout(() => {
        snapshot('1\n2\n3\n4'); snapshot('1\n2\n3\n4\n5');
        updateStatus('run-1', 'complete');
      }, 0);
      return { messageId, offset: 10, visible: true };
    },
    waitForFunction: async () => actions.push('wait-prompt-visible'),
    mouse: { wheel: async (_deltaX, deltaY) => actions.push(`wheel:${deltaY}`) },
  };
  const input = { flow, page, monitor, phase: name => actions.push(`phase:${name}`), budget: { remaining: () => 100 },
    http: { status: runId => monitor.state.statuses.get(runId), waitForTerminal: async (_milliseconds, runId) => {
      actions.push(`terminal:${runId}`); const result = terminalRecords.get(runId);
      if (!result) throw new Error('NO_TERMINAL_RECEIPT'); return result;
    } }, emit: event => actions.push(`event:${event.kind}:${event.payload.name ?? ''}`),
    screenshot: async name => actions.push(`image:${name}`), observeWindow: async () => {}, assertActive: () => {} };
  return { input, actions };
}

test('cancellation driver submits the next prompt only after canceled, with one Stop action', async () => {
  const { input, actions } = interactiveDriverFixture('CHAT-04');
  await drivePilotChat(input);
  assert.equal(actions.filter(action => action === 'stop').length, 1);
  assert.ok(actions.indexOf('terminal:run-1') < actions.indexOf('send:2'));
  assert.ok(actions.includes('image:after-cancel-complete.png'));
  input.monitor.close();
});

test('cancellation losing a race to completion never submits a replacement prompt', async () => {
  const { input, actions } = interactiveDriverFixture('CHAT-04', { cancelWins: false });
  await assert.rejects(drivePilotChat(input), /CANCELLATION_BRANCH_NOT_REACHED/);
  assert.equal(actions.includes('send:2'), false);
  input.monitor.close();
});

test('streaming driver uses one real wheel delta and observes updates after pinning', async () => {
  const { input, actions } = interactiveDriverFixture('CHAT-03');
  await drivePilotChat(input);
  assert.deepEqual(actions.filter(action => action.startsWith('wheel:')), ['wheel:-400']);
  assert.ok(actions.indexOf('pin-anchor') < actions.indexOf('terminal:run-1'));
  assert.equal(input.monitor.state.streams.get('run-1').updates, 5);
  assert.ok(actions.includes('image:streaming-anchor-complete.png'));
  input.monitor.close();
});

test('live pilot monitoring stops on a transient inversion before subsequent actions', async () => {
  const failures = [];
  const monitor = createPilotMonitor({ stopOnViolation: code => failures.push(code) });
  monitor.observe({ kind: 'run-accepted', payload: { runId: 'run', clientMessageId: 'prompt', assistantMessageId: 'reply' } });
  const pending = monitor.wait(() => false, 100);
  monitor.observe({ kind: 'snapshot', documentId: 'doc', payload: { coverage: { message: 'complete' }, nodes: [
    { domainId: 'reply', role: 'assistant-message', visible: true, content: '46', bounds: { y: 0 } },
    { domainId: 'prompt', role: 'user-message', visible: true, content: 'Question', bounds: { y: 40 } },
  ] } });
  await assert.rejects(pending, /RESPONSE_BEFORE_PROMPT/);
  assert.deepEqual(failures, ['RESPONSE_BEFORE_PROMPT']);
  assert.equal(monitor.state.closed, true);
});

test('buffered running snapshots delivered after completion are not reclassified as terminal', () => {
  const { flow, events } = pilotJournal('CHAT-02');
  const firstSnapshot = events.findIndex(event => event.kind === 'snapshot');
  const buffered = structuredClone(events[firstSnapshot]);
  buffered.payload.nodes[1].content = '';
  buffered.payload.observedRunStates['run-0'] = 'running';
  events.splice(firstSnapshot, 0, buffered);
  events.forEach((event, index) => { event.eventId = index + 1; });
  assert.equal(evaluatePilotChat(flow, events).status, 'DIAGNOSTIC_PASS');
  buffered.payload.observedRunStates['run-0'] = 'complete';
  assert.ok(evaluatePilotChat(flow, events).findings.some(item => item.code === 'WRONG_TERMINAL_ANSWER'));
});

test('driver rejects a correct terminal answer that is outside the visible conversation', async () => {
  const { input } = interactiveDriverFixture('CHAT-04');
  const original = input.page.locator;
  input.page.locator = selector => ({ ...original(selector), evaluate: async () => false });
  await assert.rejects(drivePilotChat(input), /PILOT_TERMINAL_OUTPUT_NOT_VISIBLE/);
  input.monitor.close();
});

test('CHAT uses recorder status rather than receiver phase for buffered streaming snapshots', () => {
  const events = contentJournal();
  const buffered = structuredClone(events.filter(event => event.kind === 'snapshot')[1]);
  buffered.payload.nodes[1].content = '4';
  events.splice(events.findIndex(event => event.kind === 'phase' && event.payload.phase === 'complete') + 1, 0, buffered);
  const result = evaluateChatHeuristics(chat, events.map((event, index) => ({ ...event, eventId: index + 1 })));
  assert.equal(result.status, 'DIAGNOSTIC_PASS');
});

test('CHAT preserves a wrong terminal frame before the driver complete phase and a later correction', () => {
  const events = contentJournal();
  const wrong = structuredClone(events.filter(event => event.kind === 'snapshot')[2]);
  wrong.payload.nodes[1].content = '47';
  events.splice(events.findIndex(event => event.kind === 'phase' && event.payload.phase === 'complete'), 0, wrong);
  const result = evaluateChatHeuristics(chat, events.map((event, index) => ({ ...event, eventId: index + 1 })));
  assert.equal(result.status, 'FAIL');
  assert.ok(result.findings.some(finding => finding.code === 'ANSWER_CONTENT_MISMATCH'));
});

for (const defect of ['missing-status', 'uncorrelated-status', 'missing-boundary', 'missing-frames', 'long-frame-gap', 'missing-frame-timing']) {
  test(`CHAT cannot pass with ${defect} evidence`, () => {
    let events = contentJournal();
    if (defect === 'missing-status') events = events.filter(event => event.kind !== 'run-status');
    if (defect === 'uncorrelated-status') events.find(event => event.kind === 'run-status').payload.runId = 'other';
    if (defect === 'missing-boundary') delete events.filter(event => event.kind === 'snapshot')[1].payload.observedRunStates;
    if (defect === 'missing-frames') events = events.filter(event => event.kind !== 'frame');
    if (defect === 'long-frame-gap') events.find(event => event.kind === 'frame').payload.gapMs = 251;
    if (defect === 'missing-frame-timing') delete events.find(event => event.kind === 'frame').payload.gapMs;
    assert.equal(evaluateChatHeuristics(chat, events.map((event, index) => ({ ...event, eventId: index + 1 }))).status, 'INSUFFICIENT_EVIDENCE');
  });
}

for (const defect of ['one-frame-hidden', 'one-frame-visual-inversion', 'terminal-regression', 'false-entrance-exemption', 'zero-area-message']) {
  test(`CHAT retains ${defect} despite later correction`, () => {
    const events = contentJournal();
    if (defect === 'terminal-regression') {
      const stale = structuredClone(events.find(event => event.kind === 'run-status'));
      events.splice(events.findIndex(event => event.kind === 'phase' && event.payload.phase === 'reload'), 0, stale);
    } else {
      const snapshot = events.filter(event => event.kind === 'snapshot')[1];
      if (defect === 'one-frame-hidden') snapshot.payload.nodes[0].visible = false;
      else if (defect === 'false-entrance-exemption') Object.assign(snapshot.payload.nodes[0], { visible: false, initialEntrance: true });
      else if (defect === 'zero-area-message') snapshot.payload.nodes[0].bounds.height = 0;
      else snapshot.payload.nodes[1].bounds.y = 0;
    }
    assert.equal(evaluateChatHeuristics(chat, events.map((event, index) => ({ ...event, eventId: index + 1 }))).status, 'FAIL');
  });
}