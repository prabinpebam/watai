import { createHash } from 'node:crypto';
import { preparationBlockers } from './preparation.mjs';
import { evaluateAuthHeuristics } from './auth-heuristics.mjs';
import { evaluateChatHeuristics } from './chat-heuristics.mjs';
import { evaluatePilotChat } from './pilot-chat-heuristics.mjs';

export const targetUrl = 'https://prabinpebam.github.io/watai/';
export const digest = value => createHash('sha256').update(value).digest('hex');

export function pilotWorkCommand(pilot, flows, settings) {
  return `deployed-eval-pilot-${digest(JSON.stringify({ pilot, flows, settings }))}`;
}

export async function runPilotOnce({ flows, inspect, consumePermit, run }) {
  if (JSON.stringify(flows.map(flow => flow.id)) !== JSON.stringify(['AUTH-01', 'CHAT-01', 'CHAT-02', 'CHAT-03', 'CHAT-04']) ||
      flows.reduce((sum, flow) => sum + (flow.mode === 'authenticated' ? flow.maxRunSubmissions ?? 1 : 0), 0) !== 6) {
    throw new Error('EXACT_PILOT_SCOPE_REQUIRED');
  }
  const statuses = await Promise.all(flows.map(inspect));
  if (statuses.some(status => status.ready !== true)) return { status: 'BLOCKED', flows: statuses };
  await consumePermit();
  const attempts = [];
  for (const flow of flows) {
    const result = await run(flow);
    attempts.push({ flowId: flow.id, ...result });
    if (result?.status !== 'DIAGNOSTIC_PASS') return { status: 'STOPPED', attempts };
  }
  return { status: 'OBSERVATIONS_COLLECTED', attempts, releaseEligible: false };
}

export function validateExistingBrowserReceipt(receipt) {
  if (!receipt || receipt.endpoint !== 'http://127.0.0.1:9222' || receipt.endpointVerified !== true ||
      receipt.cloning !== false || receipt.originalProfileChanged !== false || !Number.isSafeInteger(receipt.processId) || receipt.processId <= 0 ||
      !Number.isFinite(Date.parse(receipt.processStartedAt)) || receipt.profileDirectory !== 'Default' ||
      typeof receipt.userDataDirectory !== 'string' || !/\\WataiEval\\AutomationProfiles\\[a-f0-9-]{36}$/i.test(receipt.userDataDirectory)) {
    throw new Error('EXISTING_BROWSER_RECEIPT_INVALID');
  }
  return structuredClone(receipt);
}

export async function attachExistingBrowser({ receipt, assertReady, verifyProcess, connect }) {
  await assertReady();
  const bound = validateExistingBrowserReceipt(receipt);
  if (await verifyProcess(bound) !== true) throw new Error('EXISTING_BROWSER_IDENTITY_CHANGED');
  const browser = await connect(bound.endpoint, { timeout: 10000 });
  if (await verifyProcess(bound) !== true) throw new Error('EXISTING_BROWSER_IDENTITY_CHANGED');
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => {
    try { const url = new URL(page.url()); return !url.username && !url.password && url.origin === new URL(targetUrl).origin && url.pathname === '/watai/'; }
    catch { return false; }
  });
  if (pages.length !== 1) throw new Error('EXACTLY_ONE_WATAI_TARGET_REQUIRED');
  return { browser, context: pages[0].context(), page: pages[0], ownsResources: false };
}

export async function closeOwnedBrowserResources({ browser, context, ownsResources }) {
  if (ownsResources !== true) return;
  try { await context?.close(); } finally { await browser?.close(); }
}

export function createPhaseBudget(steps, now = () => performance.now()) {
  if (!Array.isArray(steps) || !steps.length || new Set(steps.map(step => step.phase)).size !== steps.length ||
      steps.some(step => !step.phase || !Number.isSafeInteger(step.deadlineMs) || step.deadlineMs <= 0)) throw new Error('INVALID_PHASE_BUDGET');
  let index = -1;
  let expiresAt = Infinity;
  return {
    enter(phase) {
      if (now() >= expiresAt) throw new Error('PHASE_DEADLINE_EXCEEDED');
      if (steps[index + 1]?.phase !== phase) throw new Error('UNDECLARED_PHASE_TRANSITION');
      const step = steps[++index]; expiresAt = now() + step.deadlineMs;
      return step.deadlineMs;
    },
    remaining(limit) {
      const remaining = expiresAt - now();
      if (index < 0 || remaining <= 0) throw new Error('PHASE_DEADLINE_EXCEEDED');
      return Math.max(1, Math.floor(Math.min(limit, remaining)));
    },
  };
}

export function createCapturePolicy(stop) {
  let stopped = false;
  return {
    observe(event) {
      if (event.kind === 'capture-gap' && !stopped) { stopped = true; stop('CAPTURE_REPORTED_LOSS'); }
    },
    assertActive() { if (stopped) throw new Error('CAPTURE_POLICY_STOPPED'); },
  };
}

export function budgetViolation(flow, { eventBytes = 0, networkBytes = 0, artifactBytes = 0, eventKind } = {}) {
  if (eventKind === 'capture-gap') return 'CAPTURE_REPORTED_LOSS';
  if (eventBytes > flow.maxEvidenceBytes - 1024) return 'RUNNER_EVIDENCE_LIMIT';
  if (networkBytes > flow.maxNetworkBytes) return 'NETWORK_BYTE_LIMIT';
  if (artifactBytes > 4194304) return 'ARTIFACT_IDENTITY_BYTE_LIMIT';
  return null;
}

export function validateFlow(flow) {
  if (!flow || !['AUTH-01', 'CHAT-01', 'CHAT-02', 'CHAT-03', 'CHAT-04'].includes(flow.id) || !Number.isSafeInteger(flow.version) || flow.version < 1 ||
      !['public', 'authenticated'].includes(flow.mode) || !Array.isArray(flow.phases) ||
      !flow.phases.length || new Set(flow.phases).size !== flow.phases.length ||
      !flow.requiredPhases?.every(phase => flow.phases.includes(phase)) || !flow.regions?.length ||
      !flow.regions.every(region => region.id && region.selector && ['detailed', 'context', 'abstract'].includes(region.level)) ||
      !flow.requiredOutcomes?.length || new Set(flow.requiredOutcomes).size !== flow.requiredOutcomes.length ||
      !flow.origins?.includes(new URL(targetUrl).origin)) throw new Error('INVALID_FLOW_DESIGN');
  for (const field of ['deadlineMs', 'maxRequests', 'maxNetworkBytes', 'maxEvents', 'maxEvidenceBytes']) {
    if (!Number.isSafeInteger(flow[field]) || flow[field] <= 0) throw new Error('INVALID_FLOW_BUDGET');
  }
  return flow;
}

export function preflight(config, flow, { existingBrowserVerified = false, approvalValid = false, preparation } = {}) {
  validateFlow(flow);
  const blockers = preparationBlockers(preparation, flow);
  if (flow.driver === 'PILOT_DRIVER_NOT_IMPLEMENTED') blockers.push('PILOT_DRIVER_NOT_IMPLEMENTED');
  if (flow.driver === 'PILOT_DRIVER_IMPLEMENTED_UNCALIBRATED') blockers.push('PILOT_DRIVER_CALIBRATION_REQUIRED');
  if (flow.driver === 'PILOT_DRIVER_LOCAL_CALIBRATED') blockers.push('PILOT_REAL_SERVICE_CALIBRATION_REQUIRED');
  if (!config || config.target !== targetUrl) blockers.push('EXACT_DEPLOYED_TARGET_REQUIRED');
  if (config?.liveEnabled !== true) blockers.push('LIVE_EXECUTION_DISABLED');
  if (!approvalValid) blockers.push('FRESH_WORK_DECISION_REQUIRED');
  if (flow.mode === 'authenticated') {
    if (!existingBrowserVerified || config?.useExistingBrowser !== true || config?.dedicatedAccountAcknowledged !== true) blockers.push('GENUINE_DEDICATED_AUTH_SESSION_REQUIRED');
    if (config?.authStateFile) blockers.push('AUTH_STATE_EXPORT_NOT_PERMITTED');
    const permitted = config?.maxRunSubmissionsByFlow?.[flow.id] ?? config?.maxRunSubmissions;
    if (permitted !== (flow.maxRunSubmissions ?? 1)) blockers.push(flow.maxRunSubmissions > 1 ? 'EXPLICIT_FLOW_SUBMISSION_LIMIT_REQUIRED' : 'EXPLICIT_ONE_SUBMISSION_LIMIT_REQUIRED');
    if (config?.providerBudgetVerified !== true) blockers.push('PROVIDER_SIDE_BUDGET_VERIFICATION_REQUIRED');
  } else if (config?.authStateFile) blockers.push('PUBLIC_FLOW_MUST_USE_FRESH_CONTEXT');
  return { ready: blockers.length === 0, blockers, releaseEligible: false };
}

export function safeLocation(value) {
  try {
    const url = new URL(value);
    return { origin: url.origin, locationHash: digest(`${url.origin}${url.pathname}`) };
  } catch { return { origin: 'unavailable' }; }
}

export function evaluate(flow, events, metadata = {}) {
  validateFlow(flow);
  const findings = [];
  const add = (code, event, kind = 'product') => {
    if (!findings.some(item => item.code === code && item.eventId === event?.eventId)) {
      findings.push({ code, kind, eventId: event?.eventId ?? null });
    }
  };
  const phases = new Set();
  const sequences = new Map();
  const known = new Map();
  let frames = 0;
  let snapshots = 0;
  for (const event of events) {
    if (event.kind === 'phase') phases.add(event.payload.phase);
    if (event.kind === 'page-error') add('PAGE_ERROR', event);
    if (event.kind === 'observed-product-failure') add(event.payload.code, event);
    if (event.kind === 'capture-gap' || event.kind === 'runner-error' || event.kind === 'policy-stop') add(event.payload.code, event, 'evidence');
    if (event.documentId) {
      const last = sequences.get(event.documentId) ?? 0;
      if (event.sequence !== last + 1) add('CAPTURE_SEQUENCE_GAP', event, 'evidence');
      sequences.set(event.documentId, event.sequence);
    }
    if (event.kind === 'frame') {
      frames++;
      if (event.payload.gapMs > 250 && event.payload.visibility === 'visible') add('FRAME_COVERAGE_GAP', event, 'evidence');
    }
    if (event.kind !== 'snapshot') continue;
    snapshots++;
    const rows = event.payload.nodes ?? [];
    const document = known.get(event.documentId) ?? { prompt: false, reply: false };
    const prompts = rows.filter(node => node.role === 'user-message');
    const replies = rows.filter(node => node.role === 'assistant-message');
    if (flow.mode === 'authenticated') {
      if (prompts.length > 1 || replies.length > 1) add('UNEXPECTED_MESSAGE_COUNT', event);
      if (document.prompt && !prompts.length) add('PROMPT_DISAPPEARED', event);
      if (document.reply && !replies.length) add('REPLY_DISAPPEARED', event);
      if (replies.length && (!prompts.length || rows.indexOf(replies[0]) < rows.indexOf(prompts[0]) || replies[0].bounds.y < prompts[0].bounds.y)) add('RESPONSE_BEFORE_PROMPT', event);
      document.prompt ||= prompts.length > 0;
      document.reply ||= replies.length > 0;
    }
    for (const row of [...prompts, ...replies]) {
      if ((!row.visible && !row.initialEntrance) || row.bounds.height <= 0) add('MESSAGE_HIDDEN', event);
    }
    known.set(event.documentId, document);
  }
  for (const phase of flow.requiredPhases) if (!phases.has(phase)) add(`MISSING_PHASE:${phase}`, null, 'evidence');
  if (!frames || !snapshots) add('NO_TEMPORAL_CAPTURE', null, 'evidence');
  if (!events.some(event => event.kind === 'capture-stopped')) add('CAPTURE_NOT_FINALIZED', null, 'evidence');
  const check = events.findLast(event => event.kind === 'outcome');
  if (!check) add('NO_OUTCOME_EVIDENCE', null, 'evidence');
  else for (const name of flow.requiredOutcomes) {
    if (!(name in check.payload)) add(`MISSING_OUTCOME:${name}`, check, 'evidence');
    else if (check.payload[name] !== true) add(`OUTCOME_FAILED:${name}`, check);
  }
  const productFailed = findings.some(item => item.kind === 'product');
  const sufficient = !findings.some(item => item.kind === 'evidence');
  return {
    flowId: flow.id,
    evidenceClass: metadata.evidenceClass ?? 'unknown',
    status: productFailed ? 'FAIL' : sufficient ? 'DIAGNOSTIC_PASS' : 'INSUFFICIENT_EVIDENCE',
    evidenceSufficientForImplementedChecks: sufficient,
    heuristicScope: 'implemented-diagnostic-checks-only',
    semanticEvaluation: { required: true, status: 'NOT_RUN' },
    fullEddStatus: 'NOT_QUALIFIED',
    releaseEligible: false,
    findings,
    observations: { events: events.length, snapshots, frames },
    unqualified: flow.unqualified,
  };
}

export function replay(events, until = Infinity) {
  const documents = new Map();
  for (const event of events) {
    if (event.eventId > until) break;
    if (event.kind === 'snapshot') documents.set(event.documentId, event.payload);
  }
  return { eventLimit: Number.isFinite(until) ? until : null, documents: Object.fromEntries(documents),
    limitations: ['Replays retained semantic checkpoints, not arbitrary HTML or omitted descendants.'] };
}

export function evaluatePreparedHeuristics(flow, events, metadata = {}) {
  if (['CHAT-02', 'CHAT-03', 'CHAT-04'].includes(flow.id)) return { ...evaluatePilotChat(flow, events), evidenceClass: metadata.evidenceClass ?? 'unknown' };
  const temporal = evaluate(flow, events, metadata);
  const specific = flow.mode === 'public' ? evaluateAuthHeuristics(flow, events) : evaluateChatHeuristics(flow, events);
  const findings = [...temporal.findings.filter(finding => !/^(NO_OUTCOME_EVIDENCE|MISSING_OUTCOME:|OUTCOME_FAILED:)/.test(finding.code)), ...specific.findings];
  const failed = findings.some(finding => finding.kind === 'product');
  const sufficient = !findings.some(finding => finding.kind === 'evidence');
  return { ...temporal, status: failed ? 'FAIL' : sufficient ? 'DIAGNOSTIC_PASS' : 'INSUFFICIENT_EVIDENCE',
    evidenceSufficientForImplementedChecks: sufficient, findings, unimplementedChecks: specific.unimplementedChecks,
    heuristicScope: 'original-evidence-child-checks; unimplemented checks explicitly excluded from qualification' };
}