export function createPilotMonitor({ stopOnViolation } = {}) {
  const state = { accepted: [], statuses: new Map(), streams: new Map(), snapshot: null, closed: false };
  const priorMessages = new Map();
  const latestBodies = new Map();
  const canceledBodies = new Map();
  const waiters = new Set();
  const test = waiter => {
    try {
      const value = waiter.predicate(state);
      if (value) { clearTimeout(waiter.timer); waiters.delete(waiter); waiter.resolve(value); }
    } catch (error) { clearTimeout(waiter.timer); waiters.delete(waiter); waiter.reject(error); }
  };
  return {
    state,
    observe(event) {
      if (state.closed) return;
      if (['capture-gap', 'policy-stop', 'runner-error'].includes(event.kind)) {
        this.close(event.payload?.code ?? 'PILOT_OBSERVATION_FAILED'); return;
      }
      if (event.kind === 'run-accepted') state.accepted.push({ ...event.payload });
      if (event.kind === 'run-status') {
        state.statuses.set(event.payload.runId, event.payload.status);
        if (event.payload.status === 'canceled') {
          const run = state.accepted.find(run => run.runId === event.payload.runId);
          if (run) canceledBodies.set(run.assistantMessageId, null);
        }
      }
      if (event.kind === 'snapshot') {
        state.snapshot = event;
        if (stopOnViolation && event.documentId && event.payload.coverage?.message === 'complete') {
          const rows = event.payload.nodes.filter(node => ['user-message', 'assistant-message'].includes(node.role));
          const ids = rows.map(row => row.domainId);
          const previous = priorMessages.get(event.documentId) ?? [];
          let violation = new Set(ids).size !== ids.length ? 'DUPLICATE_VISIBLE_MESSAGE' : previous.some(id => !ids.includes(id)) ? 'VISIBLE_MESSAGE_DISAPPEARED' : null;
          for (const run of state.accepted) {
            const prompt = rows.find(row => row.domainId === run.clientMessageId);
            const reply = rows.find(row => row.domainId === run.assistantMessageId);
            if (reply && (!prompt || ids.indexOf(reply.domainId) < ids.indexOf(prompt.domainId) || reply.bounds?.y < prompt.bounds?.y)) violation ??= 'RESPONSE_BEFORE_PROMPT';
          }
          for (const row of rows) {
            if (row.visible === false && row.initialEntrance !== true) violation ??= 'MESSAGE_HIDDEN';
            const run = state.accepted.find(run => run.assistantMessageId === row.domainId);
            if (canceledBodies.has(row.domainId) && event.payload.observedRunStates?.[run?.runId] === 'canceled') {
              if (canceledBodies.get(row.domainId) === null) canceledBodies.set(row.domainId, row.content);
              else if (row.content !== canceledBodies.get(row.domainId)) violation ??= 'CANCELED_REPLY_CHANGED';
            }
            if (typeof row.content === 'string') latestBodies.set(row.domainId, row.content);
          }
          priorMessages.set(event.documentId, ids);
          if (violation) { this.close(violation); stopOnViolation(violation, event); return; }
        }
        for (const run of state.accepted) {
          const body = event.payload.nodes?.find(node => node.domainId === run.assistantMessageId)?.content;
          const snapshotStatus = event.payload.observedRunStates ? event.payload.observedRunStates[run.runId] : state.statuses.get(run.runId);
          if (typeof body !== 'string' || !body.length || snapshotStatus !== 'running') continue;
          const stream = state.streams.get(run.runId) ?? { updates: 0, lastBody: '' };
          if (body !== stream.lastBody) { stream.updates++; stream.lastBody = body; }
          state.streams.set(run.runId, stream);
        }
      }
      for (const waiter of [...waiters]) test(waiter);
    },
    wait(predicate, milliseconds) {
      if (state.closed) return Promise.reject(new Error('PILOT_MONITOR_CLOSED'));
      if (!Number.isFinite(milliseconds) || milliseconds <= 0) return Promise.reject(new Error('PILOT_WAIT_DEADLINE'));
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject, timer: setTimeout(() => {
          waiters.delete(waiter); reject(new Error('PILOT_REQUIRED_OBSERVATION_MISSING'));
        }, milliseconds) };
        waiters.add(waiter); test(waiter);
      });
    },
    close(code = 'PILOT_MONITOR_CLOSED') {
      state.closed = true;
      for (const waiter of waiters) { clearTimeout(waiter.timer); waiter.reject(new Error(code)); }
      waiters.clear();
    },
  };
}

export async function drivePilotChat({ flow, page, phase, budget, monitor, http, emit, screenshot, observeWindow, assertActive }) {
  if (!['CHAT-02', 'CHAT-03', 'CHAT-04'].includes(flow.id)) throw new Error('UNSUPPORTED_PILOT_DRIVER');
  const checkpoint = () => { assertActive(); return page.evaluate(() => window.__wataiEvalCapture.checkpoint()); };
  const submit = async index => {
    assertActive();
    if (monitor.state.accepted.length !== index) throw new Error('PILOT_UNEXPECTED_TURN_COUNT');
    await page.locator(flow.readySelector).fill(flow.prompts[index]);
    assertActive(); emit({ kind: 'action', payload: { name: 'Send', turnIndex: index } });
    await page.locator(flow.actionSelector).click();
    return monitor.wait(state => state.accepted[index] ?? false, budget.remaining(30000));
  };
  const terminal = async (run, expected) => {
    const result = await http.waitForTerminal(budget.remaining(60000), run.runId);
    assertActive();
    if (result.status !== expected) throw new Error(expected === 'canceled' ? 'PILOT_CANCELLATION_BRANCH_NOT_REACHED' : 'PILOT_RUN_DID_NOT_COMPLETE');
    await page.locator(flow.stopSelector).waitFor({ state: 'detached', timeout: budget.remaining(5000) });
    await checkpoint();
    if (expected === 'complete' && flow.id !== 'CHAT-03') {
      const visible = await page.locator(`[data-message-id="${run.assistantMessageId}"] .md`).evaluate(element => {
        const container = document.querySelector('.chat__scroll');
        if (!container || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        const box = element.getBoundingClientRect(); const viewport = container.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.top >= viewport.top && box.bottom <= viewport.bottom &&
          box.left >= viewport.left && box.right <= viewport.right;
      });
      if (visible !== true) throw new Error('PILOT_TERMINAL_OUTPUT_NOT_VISIBLE');
    }
    return result;
  };
  const streaming = (run, minimum) => monitor.wait(state => {
    const status = state.statuses.get(run.runId);
    if (['complete', 'error', 'canceled'].includes(status)) throw new Error('PILOT_STREAM_BRANCH_NOT_REACHED');
    return status === 'running' && (state.streams.get(run.runId)?.updates ?? 0) >= minimum;
  }, budget.remaining(30000));
  if (flow.id === 'CHAT-02') {
    phase('seed'); const first = await submit(0); await terminal(first, 'complete');
    await screenshot('follow-up-seed.png');
    phase('follow-up'); const second = await submit(1);
    if (second.threadId !== first.threadId) throw new Error('PILOT_THREAD_CHANGED');
    await terminal(second, 'complete');
    phase('complete'); await observeWindow(page, flow.reconciliationMs); await screenshot('follow-up-complete.png');
    return;
  }
  phase('submit'); const first = await submit(0);
  phase('stream'); await streaming(first, flow.id === 'CHAT-03' ? 3 : 2);
  await screenshot('streaming-before-action.png');
  if (flow.id === 'CHAT-04') {
    assertActive();
    if (http.status(first.runId) !== 'running') throw new Error('PILOT_STOP_RACE_NOT_REACHED');
    emit({ kind: 'action', payload: { name: 'Stop', runId: first.runId } });
    await page.locator(flow.stopSelector).click();
    phase('cancel'); await terminal(first, 'canceled');
    await screenshot('canceled.png');
    phase('next-prompt'); const second = await submit(1);
    if (second.threadId !== first.threadId || second.runId === first.runId) throw new Error('PILOT_NEXT_RUN_IDENTITY_MISMATCH');
    await terminal(second, 'complete');
    phase('complete'); await observeWindow(page, flow.reconciliationMs); await screenshot('after-cancel-complete.png');
    return;
  }
  phase('read-history');
  await monitor.wait(state => {
    if (state.statuses.get(first.runId) !== 'running') throw new Error('PILOT_STREAM_BRANCH_NOT_REACHED');
    const scroll = state.snapshot?.payload.scroll;
    return scroll && scroll.scrollHeight > scroll.clientHeight && scroll.scrollTop > 0;
  }, budget.remaining(15000));
  const scroll = page.locator('.chat__scroll');
  await scroll.hover();
  const distance = await scroll.evaluate(element => element.scrollTop);
  if (!(distance > 0)) throw new Error('PILOT_SCROLL_BRANCH_NOT_REACHED');
  emit({ kind: 'action', payload: { name: 'Wheel', deltaY: -distance, messageId: first.clientMessageId } });
  await page.mouse.wheel(0, -distance);
  await page.waitForFunction(messageId => {
    const element = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    const container = document.querySelector('.chat__scroll');
    if (!element || !container) return false;
    const box = element.getBoundingClientRect(); const viewport = container.getBoundingClientRect();
    return box.top >= viewport.top && box.top < viewport.bottom;
  }, first.clientMessageId, { timeout: budget.remaining(5000) });
  const anchor = await page.evaluate(messageId => window.__wataiEvalCapture.pinAnchor(messageId), first.clientMessageId);
  if (!anchor?.visible || !Number.isFinite(anchor.offset)) throw new Error('PILOT_ANCHOR_UNAVAILABLE');
  emit({ kind: 'anchor-pinned', payload: { ...anchor, source: 'real-wheel' } });
  const before = monitor.state.streams.get(first.runId)?.updates ?? 0;
  await streaming(first, before + 2);
  await terminal(first, 'complete');
  phase('complete'); await observeWindow(page, flow.reconciliationMs); await screenshot('streaming-anchor-complete.png');
}