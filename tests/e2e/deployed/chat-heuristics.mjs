import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 200;

export function evaluateChatHeuristics(flow, events) {
  if (flow.id !== 'CHAT-01' || flow.mode !== 'authenticated') throw new Error('FIRST_PROMPT_CHAT_FLOW_REQUIRED');
  const findings = [];
  const add = (code, event, kind = 'product') => findings.push({ code, eventId: event?.eventId ?? null, kind });
  const receipts = events.filter(event => event.kind === 'run-accepted');
  const receipt = receipts.length === 1 ? receipts[0].payload : null;
  const receiptValid = receipt && ['runId', 'threadId', 'clientMessageId', 'assistantMessageId'].every(key => identity(receipt[key]));
  if (receipts.length > 1) add('MULTIPLE_ACCEPTANCE_RECORDS', receipts[1]);
  if (!receiptValid) add('ACCEPTANCE_IDENTITY_MISSING', receipts[0], 'evidence');
  const submissions = events.filter(event => event.kind === 'submitted-run');
  if (!submissions.length) add('SUBMISSION_IDENTITY_MISSING', null, 'evidence');
  else if (submissions.length !== 1) add('MULTIPLE_SUBMISSIONS', submissions[1]);
  else if (submissions[0].payload?.promptSha256 !== digest(flow.prompt) || (receiptValid &&
      (submissions[0].payload.clientMessageId !== receipt.clientMessageId || submissions[0].payload.threadId !== receipt.threadId))) add('SUBMISSION_BINDING_MISMATCH', submissions[0]);
  const documents = new Map();
  const phases = [];
  let phase;
  let lastEventId = 0;
  let terminalObserved = false;
  let reloadObserved = false;
  let firstDocument;
  let persistedObserved = false;
  const statuses = new Set(['queued', 'running', 'cancel_requested', 'complete', 'error', 'canceled']);
  const correlatedStatuses = new Set();
  let terminalStatus;
  for (const event of events) {
    if (event.eventId !== ++lastEventId) add('RECEIVER_SEQUENCE_GAP', event, 'evidence');
    if (event.kind === 'phase') { phase = event.payload?.phase; phases.push(phase); }
    if (['capture-gap', 'runner-error', 'policy-stop'].includes(event.kind)) add('CAPTURE_INCOMPLETE', event, 'evidence');
    if (event.kind === 'page-error') add('PAGE_ERROR', event);
    if (event.kind === 'frame') {
      if (!['visible', 'hidden'].includes(event.payload?.visibility) ||
          !(Number.isFinite(event.payload?.gapMs) && event.payload.gapMs >= 0) && !(event.payload?.firstFrame === true && event.payload.gapMs === null)) {
        add('FRAME_TIMING_MISSING', event, 'evidence');
      } else if (event.payload.visibility !== 'visible' || event.payload.gapMs > 250) add('FRAME_COVERAGE_GAP', event, 'evidence');
    }
    if (event.kind === 'run-status') {
      const payload = event.payload;
      if (!receiptValid || !['runId', 'threadId', 'clientMessageId', 'assistantMessageId'].every(key => payload?.[key] === receipt[key]) ||
          !statuses.has(payload?.status)) add('RUN_STATUS_UNCORRELATED', event, 'evidence');
      else {
        if (terminalStatus && payload.status !== terminalStatus) add('TERMINAL_STATE_REGRESSED', event);
        correlatedStatuses.add(payload.status);
        if (['complete', 'error', 'canceled'].includes(payload.status)) {
          terminalStatus ??= payload.status;
          if (payload.status !== 'complete') add('RUN_DID_NOT_COMPLETE', event);
        }
      }
    }
    if (event.kind === 'persisted-messages' && phase === 'reload') {
      const payload = event.payload;
      if (!receiptValid || payload?.source !== 'http-response' || payload.requestPhase !== 'reload' ||
          payload.pageComplete !== true || payload.threadId !== receipt.threadId || !Array.isArray(payload.messages)) {
        add('FRESH_PERSISTENCE_EVIDENCE_MISSING', event, 'evidence'); continue;
      }
      persistedObserved = true;
      const prompts = payload.messages.filter(message => message.id === receipt.clientMessageId && message.role === 'user');
      const replies = payload.messages.filter(message => message.id === receipt.assistantMessageId && message.role === 'assistant');
      if (payload.messages.length !== 2 || prompts.length !== 1 || replies.length !== 1) add('PERSISTED_IDENTITY_MISMATCH', event);
      else if (prompts[0].content !== flow.prompt || typeof replies[0].content !== 'string' || replies[0].content.trim() !== flow.expectedAnswer) add('PERSISTED_CONTENT_MISMATCH', event);
    }
    if (event.kind !== 'snapshot') continue;
    if (!identity(event.documentId) || event.payload?.coverage?.message !== 'complete' || !Array.isArray(event.payload.nodes)) {
      add('MESSAGE_OBSERVATION_INCOMPLETE', event, 'evidence'); continue;
    }
    const state = documents.get(event.documentId) ?? { promptSeen: false, replySeen: false, visibleIds: new Set() };
    const rows = event.payload.nodes;
    const prompts = rows.filter(node => node.role === 'user-message');
    const replies = rows.filter(node => node.role === 'assistant-message');
    const observedStatus = receiptValid ? event.payload.observedRunStates?.[receipt.runId] : undefined;
    const isTerminalSnapshot = observedStatus === 'complete' && correlatedStatuses.has('complete');
    const isRestoredSnapshot = phase === 'reload' && event.documentId !== firstDocument && persistedObserved && terminalStatus === 'complete';
    if (replies.length && !isRestoredSnapshot && (!event.payload.observedRunStates || !statuses.has(observedStatus) || !correlatedStatuses.has(observedStatus))) {
      add('SNAPSHOT_RUN_BOUNDARY_MISSING', event, 'evidence');
    }
    if (prompts.length > 1 || replies.length > 1) add('UNEXPECTED_MESSAGE_COUNT', event);
    if (state.promptSeen && !prompts.length) add('PROMPT_DISAPPEARED', event);
    if (state.replySeen && !replies.length) add('REPLY_DISAPPEARED', event);
    if (replies.length && (!prompts.length || rows.indexOf(replies[0]) < rows.indexOf(prompts[0]))) add('RESPONSE_BEFORE_PROMPT', event);
    if (prompts.length && replies.length) {
      if (![prompts[0].bounds?.y, replies[0].bounds?.y].every(Number.isFinite)) add('MESSAGE_GEOMETRY_MISSING', event, 'evidence');
      else if (replies[0].bounds.y < prompts[0].bounds.y) add('RESPONSE_VISUALLY_BEFORE_PROMPT', event);
    }
    for (const node of [...prompts, ...replies]) {
      if (typeof node.visible !== 'boolean' || !identity(node.domainId) || typeof node.content !== 'string') add('MESSAGE_FIELDS_MISSING', event, 'evidence');
      else if (!node.visible && (node.initialEntrance !== true || state.visibleIds.has(node.domainId))) add('MESSAGE_HIDDEN', event);
      if (![node.bounds?.width, node.bounds?.height].every(Number.isFinite)) add('MESSAGE_GEOMETRY_MISSING', event, 'evidence');
      else if (node.bounds.width <= 0 || node.bounds.height <= 0) add('MESSAGE_ZERO_AREA', event);
      if (node.visible === true && identity(node.domainId)) state.visibleIds.add(node.domainId);
    }
    if (prompts.length) {
      firstDocument ??= event.documentId;
      if (typeof prompts[0].content === 'string' && prompts[0].content !== flow.prompt) add('PROMPT_CONTENT_CHANGED', event);
      if (receiptValid && prompts[0].domainId !== receipt.clientMessageId) add('PROMPT_IDENTITY_MISMATCH', event);
    }
    if (replies.length && receiptValid && replies[0].domainId !== receipt.assistantMessageId) {
      add(isTerminalSnapshot || isRestoredSnapshot ? 'REPLY_IDENTITY_MISMATCH' : 'ASSISTANT_HANDOFF_UNCORRELATED', event,
        isTerminalSnapshot || isRestoredSnapshot ? 'product' : 'evidence');
    }
    if ((isTerminalSnapshot || isRestoredSnapshot) && replies.length) {
      terminalObserved ||= isTerminalSnapshot;
      reloadObserved ||= isRestoredSnapshot;
      if (typeof replies[0].content !== 'string' || typeof replies[0].contentHasFormatting !== 'boolean') add('ANSWER_EVIDENCE_MISSING', event, 'evidence');
      else if (replies[0].content.trim() !== flow.expectedAnswer || replies[0].contentHasFormatting) add('ANSWER_CONTENT_MISMATCH', event);
    }
    state.promptSeen ||= prompts.length > 0; state.replySeen ||= replies.length > 0;
    documents.set(event.documentId, state);
  }
  if (JSON.stringify(phases) !== JSON.stringify(flow.requiredPhases)) add('PHASE_ORDER_OR_COVERAGE', null, 'evidence');
  if (!terminalObserved) add('TERMINAL_ANSWER_NOT_OBSERVED', null, 'evidence');
  if (!reloadObserved) add('NEW_DOCUMENT_RELOAD_NOT_OBSERVED', null, 'evidence');
  if (!persistedObserved) add('FRESH_PERSISTENCE_EVIDENCE_MISSING', null, 'evidence');
  if (!events.some(event => event.kind === 'frame') || !events.some(event => event.kind === 'capture-stopped')) add('TEMPORAL_EVIDENCE_MISSING', null, 'evidence');
  const failed = findings.some(finding => finding.kind === 'product');
  const sufficient = !findings.some(finding => finding.kind === 'evidence');
  return { flowId: flow.id, variantId: 'CHAT-01.first-prompt-reload-desktop',
    status: failed ? 'FAIL' : sufficient ? 'DIAGNOSTIC_PASS' : 'INSUFFICIENT_EVIDENCE', findings,
    evidenceSufficientForImplementedChecks: sufficient, fullEddStatus: 'NOT_QUALIFIED', releaseEligible: false,
    unimplementedChecks: ['actual-serving-run-state-correlation-calibration', 'independent-paint-and-scroll-qualification', 'complete-calibrated-intermediate-state-coverage'] };
}