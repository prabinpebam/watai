export function evaluatePilotChat(flow, events) {
  if (!['CHAT-02', 'CHAT-03', 'CHAT-04'].includes(flow.id)) throw new Error('UNSUPPORTED_PILOT_CHAT');
  const findings = [];
  const add = (code, event, kind = 'product') => findings.push({ code, kind, eventId: event?.eventId ?? null });
  const accepted = events.filter(event => event.kind === 'run-accepted').map(event => ({ ...event.payload, eventId: event.eventId }));
  const submissions = events.filter(event => event.kind === 'submitted-run');
  if (accepted.length !== flow.prompts.length || submissions.length !== flow.prompts.length) add('TURN_RECEIPTS_INCOMPLETE', null, 'evidence');
  const expectedOrder = accepted.flatMap(turn => [turn.clientMessageId, turn.assistantMessageId]);
  if (accepted.some(turn => !turn.runId || !turn.clientMessageId || !turn.assistantMessageId || turn.threadId !== accepted[0].threadId) ||
      new Set(expectedOrder).size !== expectedOrder.length || new Set(accepted.map(turn => turn.runId)).size !== accepted.length) add('TURN_IDENTITY_MISMATCH');
  for (const [index, submission] of submissions.entries()) {
    const turn = accepted[index];
    if (turn && (submission.payload.clientMessageId !== turn.clientMessageId || submission.payload.threadId !== turn.threadId)) add('SUBMISSION_IDENTITY_MISMATCH', submission);
  }
  const seenByDocument = new Map();
  const bodies = new Map();
  const statuses = new Map();
  const phases = [];
  let phase;
  let lastId = 0;
  let lastStream = '';
  let streamUpdates = 0;
  let updatesAfterAnchor = 0;
  let pinned;
  let canceled;
  let frozenBody;
  let stop;
  let cancelRequest;
  const terminalAnswers = new Map();
  for (const event of events) {
    if (event.eventId !== ++lastId) add('EVENT_SEQUENCE_GAP', event, 'evidence');
    if (event.kind === 'phase') { phase = event.payload?.phase; phases.push(phase); }
    if (['capture-gap', 'policy-stop', 'runner-error'].includes(event.kind)) add('CAPTURE_INCOMPLETE', event, 'evidence');
    if (event.kind === 'page-error') add('PAGE_ERROR', event);
    if (event.kind === 'observed-product-failure') add(event.payload.code, event);
    if (event.kind === 'action' && event.payload?.name === 'Stop') stop = event;
    if (event.kind === 'cancel-request') cancelRequest = event;
    if (event.kind === 'anchor-pinned') {
      pinned = event.payload;
      if (event.payload.source !== 'real-wheel' || !Number.isFinite(event.payload.offset) || pinned.messageId !== accepted[0]?.clientMessageId) add('ANCHOR_OBSERVATION_INVALID', event, 'evidence');
    }
    if (event.kind === 'run-status') {
      const turn = accepted.find(turn => turn.runId === event.payload.runId);
      if (!turn || (event.payload.threadId && event.payload.threadId !== turn.threadId)) { add('RUN_STATUS_UNCORRELATED', event, 'evidence'); continue; }
      const old = statuses.get(turn.runId);
      if (['complete', 'error', 'canceled'].includes(old) && event.payload.status !== old) add('TERMINAL_STATE_REGRESSED', event);
      statuses.set(turn.runId, event.payload.status);
      if (flow.id === 'CHAT-04' && turn === accepted[0] && event.payload.status === 'canceled') {
        canceled = event;
      }
    }
    if (event.kind !== 'snapshot') continue;
    if (!event.documentId || event.payload?.coverage?.message !== 'complete' || !Array.isArray(event.payload.nodes)) {
      add('MESSAGE_CAPTURE_INCOMPLETE', event, 'evidence'); continue;
    }
    const rows = event.payload.nodes.filter(node => ['user-message', 'assistant-message'].includes(node.role));
    const ids = rows.map(node => node.domainId);
    if (new Set(ids).size !== ids.length) add('DUPLICATE_MESSAGE', event);
    const prior = seenByDocument.get(event.documentId) ?? [];
    if (prior.some(id => !ids.includes(id))) add('PREVIOUS_MESSAGE_DISAPPEARED', event);
    if (prior.some((id, index) => index > 0 && ids.indexOf(id) < ids.indexOf(prior[index - 1]))) add('PREVIOUS_ORDER_CHANGED', event);
    seenByDocument.set(event.documentId, ids);
    for (const [index, turn] of accepted.entries()) {
      const prompt = rows.find(row => row.domainId === turn.clientMessageId);
      const reply = rows.find(row => row.domainId === turn.assistantMessageId);
      if (reply && (!prompt || ids.indexOf(reply.domainId) < ids.indexOf(prompt.domainId))) add('RESPONSE_BEFORE_PROMPT', event);
      if (prompt && typeof prompt.content === 'string' && prompt.content !== flow.prompts[index]) add('PROMPT_CHANGED', event);
      if (prompt && reply && Number.isFinite(prompt.bounds?.y) && Number.isFinite(reply.bounds?.y) && reply.bounds.y < prompt.bounds.y) add('VISUAL_INVERSION', event);
      if (prompt && index > 0 && ids.indexOf(turn.clientMessageId) < ids.indexOf(accepted[index - 1].assistantMessageId)) add('TURN_ORDER_CHANGED', event);
      if (reply && typeof reply.content === 'string') {
        bodies.set(reply.domainId, reply.content);
        const observedStatus = event.payload.observedRunStates?.[turn.runId];
        if (!event.payload.observedRunStates) add('SNAPSHOT_RUN_BOUNDARY_MISSING', event, 'evidence');
        if (observedStatus === 'complete') {
          terminalAnswers.set(index, reply.content);
          if (flow.answers[index] !== null && reply.content.trim().replaceAll('\r\n', '\n') !== flow.answers[index]) add('WRONG_TERMINAL_ANSWER', event);
          if (flow.id === 'CHAT-03' && lastStream && !reply.content.startsWith(lastStream)) add('TERMINAL_STREAM_ROLLBACK', event);
        }
        if (index === 0 && observedStatus === 'running' && reply.content.length && reply.content !== lastStream) {
          if (flow.id === 'CHAT-03' && !reply.content.startsWith(lastStream)) add('STREAM_TEXT_ROLLBACK', event);
          streamUpdates++; lastStream = reply.content;
          if (pinned) updatesAfterAnchor++;
        }
        if (index === 0 && canceled && observedStatus === 'canceled') {
          frozenBody ??= reply.content;
          if (reply.content !== frozenBody) add('CANCELED_REPLY_CHANGED', event);
        }
      }
    }
    for (const row of rows) {
      if (!expectedOrder.includes(row.domainId)) add('UNKNOWN_MESSAGE_ASSOCIATION', event, 'evidence');
      if (typeof row.content !== 'string' || typeof row.visible !== 'boolean') add('MESSAGE_FIELDS_MISSING', event, 'evidence');
      else if (!row.visible && row.initialEntrance !== true) add('MESSAGE_HIDDEN', event);
    }
    if (pinned) {
      const anchor = event.payload.anchor;
      if (!anchor || anchor.messageId !== pinned.messageId || !Number.isFinite(anchor.offset) || typeof anchor.visible !== 'boolean') add('PINNED_ANCHOR_EVIDENCE_MISSING', event, 'evidence');
      else if (!anchor.visible || Math.abs(anchor.offset - pinned.offset) > 2) add('READING_ANCHOR_MOVED', event);
    }
    if (phase === 'complete' && rows.length !== expectedOrder.length) add('FINAL_TURN_MISSING', event);
  }
  if (JSON.stringify(phases) !== JSON.stringify(flow.phases)) add('PHASE_COVERAGE_INCOMPLETE', null, 'evidence');
  for (const [index, answer] of flow.answers.entries()) {
    if (answer === null) continue;
    const body = terminalAnswers.get(index);
    if (typeof body !== 'string') add('TERMINAL_ANSWER_MISSING', null, 'evidence');
    else if (body.trim().replaceAll('\r\n', '\n') !== answer) add('WRONG_TERMINAL_ANSWER');
  }
  if (flow.id === 'CHAT-03') {
    if (streamUpdates < 3) add('STREAM_UPDATES_NOT_REACHED', null, 'evidence');
    if (!pinned || updatesAfterAnchor < 2) add('ANCHORED_STREAM_NOT_REACHED', null, 'evidence');
  }
  if (flow.id === 'CHAT-04') {
    if (typeof frozenBody !== 'string') add('CANCELED_BODY_UNOBSERVED', null, 'evidence');
    if (streamUpdates < 2 || !canceled || !stop || stop.payload.runId !== accepted[0]?.runId ||
        !cancelRequest || cancelRequest.payload.method !== 'DELETE' || cancelRequest.payload.runId !== accepted[0]?.runId ||
        stop.eventId >= canceled.eventId || cancelRequest.eventId >= canceled.eventId) add('CANCELLATION_BRANCH_NOT_REACHED', null, 'evidence');
    if (canceled && submissions[1]?.eventId <= canceled.eventId) add('NEXT_PROMPT_PRECEDES_CANCELLATION', submissions[1]);
  }
  if (!events.some(event => event.kind === 'capture-stopped')) add('FINAL_DRAIN_MISSING', null, 'evidence');
  return { flowId: flow.id, status: findings.some(item => item.kind === 'product') ? 'FAIL' : findings.length ? 'INSUFFICIENT_EVIDENCE' : 'DIAGNOSTIC_PASS', findings,
    releaseEligible: false, fullEddStatus: 'NOT_QUALIFIED', unimplementedChecks: ['independent-paint-and-identity-calibration', 'actual-flow-driver-and-semantic-qualification'] };
}