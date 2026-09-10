import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// This is a plan linter, not the future trusted evaluator or release controller.
const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '..', '..', '..');
const auditCommit = '9b4314ddd537401667d68642c3eeee85e7fabca7';
const sourceBaseline = 'f7dc195300c4039aae5b9a7a8fb1691327864ea1';
const auditPath = 'documentation\\audits\\2026-09-10-implementation-audit\\evidence\\findings.md';
const read = (...segments) => readFileSync(resolve(directory, ...segments), 'utf8');
const schema = JSON.parse(read('contracts', 'plan.schema.json'));
const bundle = Object.fromEntries(['backlog', 'policy', 'workflow', 'examples']
  .map((name) => [name, JSON.parse(read('contracts', `${name}.json`))]));
// Git object paths use slash syntax; this is not a filesystem path supplied by a candidate.
const auditText = execFileSync('git', ['show', `${auditCommit}:${auditPath.replaceAll('\\', '/')}`],
  { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
const auditIds = [...auditText.matchAll(/^\| ((?:MEM|BE|FE|OPS)-\d{2}) \|/gm)].map((m) => m[1]);

class PlanError extends Error {}
function requirePlan(condition, message) {
  if (!condition) throw new PlanError(message);
}
function canonical(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map((v) => JSON.parse(canonical(v))));
  if (value !== null && typeof value === 'object') {
    return JSON.stringify(Object.fromEntries(Object.keys(value).sort().map((key) =>
      [key, JSON.parse(canonical(value[key]))])));
  }
  return JSON.stringify(value);
}
const supportedKeywords = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'type', 'additionalProperties', 'required',
  'properties', 'items', 'minItems', 'maxItems', 'uniqueItems', 'minLength', 'pattern',
  'minimum', 'maximum', 'enum', 'const',
]);
function inspectSchema(node, path = '$schema') {
  for (const key of Object.keys(node)) requirePlan(supportedKeywords.has(key), `${path}: unsupported keyword ${key}`);
  for (const [name, child] of Object.entries(node.properties ?? {})) inspectSchema(child, `${path}.${name}`);
  for (const [name, child] of Object.entries(node.$defs ?? {})) inspectSchema(child, `${path}.$defs.${name}`);
  if (node.items) inspectSchema(node.items, `${path}.items`);
}
function validateSchema(value, node, path = '$') {
  if (node.$ref) {
    requirePlan(node.$ref.startsWith('#/$defs/'), `${path}: external schema refs forbidden`);
    const target = schema.$defs[node.$ref.slice('#/$defs/'.length)];
    requirePlan(target, `${path}: unknown schema ref`);
    validateSchema(value, target, path);
    return;
  }
  if ('const' in node) requirePlan(canonical(value) === canonical(node.const), `${path}: wrong constant`);
  if (node.enum) requirePlan(node.enum.some((entry) => canonical(entry) === canonical(value)), `${path}: invalid enum`);
  if (node.type) {
    const valid = node.type === 'array' ? Array.isArray(value)
      : node.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
        : node.type === 'integer' ? Number.isSafeInteger(value)
          : typeof value === node.type;
    requirePlan(valid, `${path}: expected ${node.type}`);
  }
  if (typeof value === 'string') {
    if (node.minLength !== undefined) requirePlan(value.trim().length >= node.minLength, `${path}: empty text`);
    if (node.pattern) requirePlan(new RegExp(node.pattern).test(value), `${path}: invalid pattern`);
  }
  if (typeof value === 'number') {
    if (node.minimum !== undefined) requirePlan(value >= node.minimum, `${path}: below minimum`);
    if (node.maximum !== undefined) requirePlan(value <= node.maximum, `${path}: above maximum`);
  }
  if (Array.isArray(value)) {
    if (node.minItems !== undefined) requirePlan(value.length >= node.minItems, `${path}: too few items`);
    if (node.maxItems !== undefined) requirePlan(value.length <= node.maxItems, `${path}: too many items`);
    if (node.uniqueItems) requirePlan(new Set(value.map(canonical)).size === value.length, `${path}: duplicate items`);
    if (node.items) value.forEach((item, i) => validateSchema(item, node.items, `${path}[${i}]`));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of node.required ?? []) requirePlan(Object.hasOwn(value, key), `${path}: missing ${key}`);
    for (const [key, item] of Object.entries(value)) {
      if (Object.hasOwn(node.properties ?? {}, key)) validateSchema(item, node.properties[key], `${path}.${key}`);
      else requirePlan(node.additionalProperties !== false, `${path}: unexpected ${key}`);
    }
  }
}
function indexUnique(values, label) {
  const result = new Map();
  for (const entry of values) {
    requirePlan(!result.has(entry.id), `${label}: duplicate ${entry.id}`);
    result.set(entry.id, entry);
  }
  return result;
}
function acyclic(nodes, dependencies, label) {
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    requirePlan(nodes.has(id), `${label}: unknown ${id}`);
    requirePlan(!visiting.has(id), `${label}: cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const parent of dependencies(nodes.get(id))) visit(parent);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of nodes.keys()) visit(id);
}
function closure(id, slices, result = new Set()) {
  for (const dependency of slices.get(id).dependsOn) {
    if (!result.has(dependency)) {
      result.add(dependency);
      closure(dependency, slices, result);
    }
  }
  return result;
}
function validatePlan(plan) {
  validateSchema(plan, schema);
  const { backlog, policy, workflow, examples } = plan;
  requirePlan(backlog.auditCommit === auditCommit && backlog.sourceBaseline === sourceBaseline, 'Baseline binding changed');
  requirePlan(backlog.auditRegister === auditPath, 'Audit path must be the fixed committed register');
  const slices = indexUnique(backlog.slices, 'slices');
  const findings = indexUnique(backlog.findings, 'findings');
  const roles = indexUnique(policy.roles, 'roles');
  const gates = indexUnique(policy.gates, 'gates');
  const states = indexUnique(workflow.states, 'states');
  requirePlan(canonical([...findings.keys()].sort()) === canonical([...auditIds].sort()), 'Audit finding coverage differs');
  for (const role of roles.values()) {
    requirePlan(!(role.canEditCandidate && (role.canAttest || role.canRelease || role.canEditPolicy)), 'Builder authority separation violated');
    requirePlan(!(role.canAttest && (role.canRelease || role.canEditPolicy)), 'Evaluator authority separation violated');
    requirePlan(!(role.canEditPolicy && role.canRelease), 'Policy self-release forbidden');
  }
  requirePlan(roles.get('builder')?.canEditCandidate && !roles.get('builder').canAttest, 'Builder role missing');
  requirePlan(roles.get('evaluator')?.canAttest, 'Independent evaluator missing');
  requirePlan(roles.get('release-broker')?.canRelease, 'Release broker missing');
  for (const id of ['G00', 'G01', 'G02', 'G08', 'G09']) requirePlan(policy.mandatoryGates.includes(id), `Mandatory gate ${id} removed`);
  for (const id of ['G03', 'G04', 'G05']) requirePlan(policy.productMandatoryGates.includes(id), `Sticky product gate ${id} removed`);
  for (const gate of gates.values()) {
    requirePlan(roles.has(gate.authority), `Unknown authority ${gate.authority}`);
    requirePlan(states.has(gate.failure), `Unknown failure state ${gate.failure}`);
    requirePlan(!roles.get(gate.authority).canEditCandidate, 'Builder cannot decide a gate');
  }
  const limit = policy.limits;
  requirePlan(limit.productWip <= 2 && limit.builders === 1 && limit.promotions === 1, 'WIP floor violated');
  requirePlan(limit.builderAttempts <= 3 && limit.infrastructureReruns <= 2 && limit.strategySwitches <= 1, 'Retry ceiling violated');
  requirePlan(limit.controllerHeartbeatSeconds * 2 < limit.controllerLeaseSeconds, 'Controller heartbeat unsafe');
  requirePlan(limit.workerHeartbeatSeconds * 2 < limit.workerLeaseSeconds, 'Worker heartbeat unsafe');
  requirePlan(limit.minimumEffectLeaseSeconds < Math.min(limit.controllerLeaseSeconds, limit.workerLeaseSeconds), 'Effect lease unsafe');
  requirePlan(limit.permitTtlSeconds <= 900, 'Permit freshness ceiling exceeded');
  for (let i = 1; i < limit.backoffSeconds.length; i++) requirePlan(limit.backoffSeconds[i] > limit.backoffSeconds[i - 1], 'Backoff must increase');
  const acceptanceIds = new Set();
  for (const slice of slices.values()) {
    requirePlan(roles.has(slice.ownerAgent), `${slice.id}: unknown owner`);
    for (const id of slice.gates) requirePlan(gates.has(id), `${slice.id}: unknown gate ${id}`);
    for (const check of slice.acceptance) {
      requirePlan(!acceptanceIds.has(check.id), `Duplicate acceptance ${check.id}`);
      acceptanceIds.add(check.id);
      requirePlan(slice.gates.includes(check.gate) || policy.mandatoryGates.includes(check.gate), `${slice.id}: unmapped acceptance gate`);
    }
    for (const kind of slice.evidence) requirePlan(policy.evidenceKinds.includes(kind), `${slice.id}: unknown evidence kind`);
    requirePlan(policy.rolloutProfiles.includes(slice.rollout.profile), `${slice.id}: unknown rollout profile`);
    for (const id of slice.findings) {
      requirePlan(findings.get(id)?.closureSlices.includes(slice.id), `${slice.id}: nonreciprocal finding ${id}`);
    }
  }
  for (const finding of findings.values()) {
    for (const id of finding.closureSlices) requirePlan(slices.get(id)?.findings.includes(finding.id), `${finding.id}: invalid closure ${id}`);
  }
  acyclic(slices, (slice) => slice.dependsOn, 'backlog');
  const envelopes = indexUnique(policy.capabilityEnvelopes, 'capability envelopes');
  acyclic(envelopes, (envelope) => envelope.inherits, 'envelope inheritance');
  for (const envelope of envelopes.values()) {
    requirePlan(canonical([...envelope.allowed, ...envelope.denied].sort()) === canonical([...policy.capabilities].sort()), 'Envelope must partition every capability');
    for (const id of [...envelope.requiredShippedSlices, ...envelope.bootstrapCandidateSubstitutions]) requirePlan(slices.has(id), 'Unknown envelope slice');
    for (const id of envelope.requiredGates) requirePlan(gates.has(id), 'Unknown envelope gate');
    for (const parentId of envelope.inherits) {
      const parent = envelopes.get(parentId);
      requirePlan(parent.allowed.every((capability) => envelope.allowed.includes(capability)), 'Envelope drops inherited capability without a new policy');
    }
    if (envelope.id !== 'R0') requirePlan(envelope.bootstrapCandidateSubstitutions.length === 0, 'Bootstrap substitution outside R0');
  }
  const requiredEnvelopeSlices = {
    R0: ['H01','H02','H03','H04','H05','S01','S02','S04','S06'],
    R1: ['H06','S03','S05','S07','S08','S09','S10'],
    R2: ['S12','S13','S14'], R3: ['S47'], RT: ['S49'], R4: ['S49'],
  };
  for (const [id, required] of Object.entries(requiredEnvelopeSlices)) {
    requirePlan(envelopes.has(id) && required.every((slice) => envelopes.get(id).requiredShippedSlices.includes(slice)), `Envelope ${id} missing safety dependency`);
  }
  requirePlan(canonical([...envelopes.get('R0').allowed].sort()) === canonical(['history.read','local.draft','settings.read','settings.restrict'].sort()), 'R0 permits unsafe capability');
  function envelopeRequirements(id, requirements = new Set()) {
    const envelope = envelopes.get(id);
    for (const slice of envelope.requiredShippedSlices) {
      requirements.add(slice);
      for (const parent of closure(slice, slices)) requirements.add(parent);
    }
    for (const parent of envelope.inherits) envelopeRequirements(parent, requirements);
    return requirements;
  }
  requirePlan(slices.has('S48'), 'Final closure slice missing');
  requirePlan(closure('S48', slices).size === slices.size - 1, 'Final slice must require every other slice');
  const edges = new Map([...states.keys()].map((id) => [id, []]));
  const transitions = new Map();
  for (const guard of workflow.transitionDefaults.requiredGuards) requirePlan(workflow.guards.includes(guard), `Unknown default guard ${guard}`);
  for (const guard of ['valid-envelope', 'current-lease', 'current-source']) requirePlan(workflow.transitionDefaults.requiredGuards.includes(guard), `Missing transition guard ${guard}`);
  for (const transition of workflow.transitions) {
    requirePlan(states.has(transition.to) && roles.has(transition.actor), 'Unknown state or transition actor');
    for (const guard of transition.guards) requirePlan(workflow.guards.includes(guard), `Unknown guard ${guard}`);
    for (const from of transition.from) {
      requirePlan(states.has(from) && !states.get(from).terminal, `Invalid outgoing state ${from}`);
      const key = `${from}:${transition.event}`;
      requirePlan(!transitions.has(key), `Ambiguous transition ${key}`);
      transitions.set(key, transition);
      edges.get(from).push(transition.to);
    }
    if (transition.event === 'retry') {
      for (const guard of ['attempts-remaining', 'budget-remaining', 'effects-reconciled']) requirePlan(transition.guards.includes(guard), 'Unbounded retry edge');
    }
    if (transition.to === 'PROMOTING') requirePlan(transition.actor === 'release-verifier' && transition.guards.includes('permit-current'), 'Unauthorized promotion edge');
    if (transition.effect === 'promote' || transition.effect === 'expand') {
      requirePlan(transition.actor === 'release-verifier' && transition.guards.includes('new-single-use-permit'), 'Public effect without a fresh independent permit');
      requirePlan(transition.guards.includes('gates-passed'), 'Public authorization lacks current gate recheck');
      requirePlan(transition.guards.includes(transition.effect === 'promote' ? 'cohort-scope' : 'full-scope'), 'Missing rollout-phase scope');
    }
    if (transition.to === 'SHIPPED') requirePlan(transition.actor === 'evaluator' && transition.guards.includes('independent-evidence'), 'Unverified shipped edge');
  }
  requirePlan(states.has(workflow.initial), 'Unknown initial state');
  function reachable(start) {
    const seen = new Set([start]);
    const pending = [start];
    while (pending.length) for (const next of edges.get(pending.pop())) {
      if (!seen.has(next)) { seen.add(next); pending.push(next); }
    }
    return seen;
  }
  requirePlan(reachable(workflow.initial).size === states.size, 'Unreachable workflow state');
  for (const state of ['PROMOTING', 'OBSERVING', 'EXPANSION_READY', 'EXPANDING', 'FINAL_OBSERVING']) {
    requirePlan(transitions.get(`${state}:release_failed`)?.to === 'ROLLING_BACK', `${state}: missing public rollback`);
    requirePlan(transitions.get(`${state}:recovery_blocked`)?.to === 'BLOCKED_SAFE', `${state}: missing safe fallback`);
  }
  for (const state of states.values()) requirePlan([...reachable(state.id)].some((id) => states.get(id).terminal), `${state.id}: no terminal path`);
  // The workflow is intentionally cyclic only through explicitly budgeted retry edges.
  const noRetry = new Map([...states.keys()].map((id) => [id, { next: [] }]));
  for (const t of workflow.transitions.filter((t) => t.event !== 'retry')) for (const from of t.from) noRetry.get(from).next.push(t.to);
  acyclic(noRetry, (state) => state.next, 'unbounded workflow');
  for (const id of ['FAILED', 'TIMED_OUT', 'CANCEL_REQUESTED', 'QUARANTINED', 'ROLLING_BACK', 'SHIPPED', 'REJECTED', 'BLOCKED_SAFE', 'CANCELLED', 'ROLLED_BACK']) requirePlan(states.has(id), `Missing required state ${id}`);
  const subjects = indexUnique(examples.subjects, 'evidence subjects');
  acyclic(subjects, (subject) => subject.parents.map((parent) => parent.subject), 'evidence');
  for (const subject of subjects.values()) requirePlan(createHash('sha256').update(subject.payload).digest('hex') === subject.sha256, `Subject digest mismatch ${subject.id}`);
  const packet = examples.packet;
  requirePlan(slices.has(packet.sliceId), 'Unknown packet slice');
  for (const id of Object.values(packet.subjects)) requirePlan(subjects.has(id), `Missing bound subject ${id}`);
  requirePlan(packet.sourceSha === sourceBaseline && packet.baseSha === sourceBaseline, 'Synthetic packet source binding changed');
  const binding = examples.capabilityBinding;
  const envelope = envelopes.get(binding.envelopeId);
  requirePlan(envelope, 'Unknown requested envelope');
  const envelopeClosure = new Set();
  function envelopeAncestry(id) {
    envelopeClosure.add(id);
    for (const parent of envelopes.get(id).inherits) envelopeAncestry(parent);
  }
  envelopeAncestry(envelope.id);
  const envelopeMaterial = envelopeClosure.size === 1 ? envelope
    : [...envelopeClosure].sort().map((id) => envelopes.get(id));
  requirePlan(createHash('sha256').update(canonical(envelopeMaterial)).digest('hex') === binding.envelopeSha256, 'Forged envelope digest');
  requirePlan(binding.configurationSubject === packet.subjects.configuration, 'Envelope not bound to config');
  requirePlan(canonical([...binding.observedCapabilities].sort()) === canonical([...envelope.allowed].sort()), 'Deployed capabilities differ from approved envelope');
  for (const id of [...binding.shippedSlices, ...binding.bootstrapCandidateSlices]) requirePlan(slices.has(id), 'Unknown slice receipt');
  const eligible = new Set(binding.shippedSlices);
  if (binding.bootstrap) {
    requirePlan(envelope.id === 'R0', 'Bootstrap can only activate R0');
    for (const id of binding.bootstrapCandidateSlices) {
      requirePlan(envelope.bootstrapCandidateSubstitutions.includes(id), 'Unauthorized bootstrap candidate substitution');
      eligible.add(id);
    }
  } else requirePlan(binding.bootstrapCandidateSlices.length === 0, 'Candidate substitutions outside bootstrap');
  for (const id of envelopeRequirements(envelope.id)) requirePlan(eligible.has(id), `Envelope dependency not satisfied ${id}`);
  const rollbackEnvelope = envelopes.get(binding.rollbackEnvelopeId);
  requirePlan(rollbackEnvelope, 'Unknown rollback envelope');
  requirePlan(!rollbackEnvelope.allowed.some((capability) => binding.revokedCapabilities.includes(capability)), 'Rollback expands revoked capability');
  requirePlan(!envelope.allowed.some((capability) => binding.revokedCapabilities.includes(capability)), 'Promotion exposes revoked capability');
  const age = Date.parse(packet.expiresAt) - Date.parse(packet.createdAt);
  requirePlan(Number.isFinite(age) && age > 0 && age <= limit.permitTtlSeconds * 1000, 'Invalid packet expiry');
  const banks = indexUnique(examples.exposureLedger.banks.map((bank) => ({ ...bank, id: bank.bankId })), 'holdout banks');
  const reservations = indexUnique(examples.exposureLedger.reservations.map((entry) => ({ ...entry, id: entry.reservationId })), 'exposure reservations');
  const counters = new Map();
  let sequence = 0;
  for (const bank of banks.values()) {
    requirePlan(bank.maxExposures === (bank.purpose === 'final' ? 1 : 3), 'Holdout cap changed');
    requirePlan([...banks.values()].filter((other) => other.digest === bank.digest).length === 1, 'Bank rename cannot reset exposure');
  }
  for (const entry of reservations.values()) {
    const bank = banks.get(entry.bankId);
    requirePlan(bank, 'Unknown exposure bank');
    requirePlan(entry.sequence === ++sequence, 'Nonmonotone exposure ledger');
    const ordinal = (counters.get(entry.bankId) ?? 0) + 1;
    requirePlan(entry.ordinal === ordinal && ordinal <= bank.maxExposures, 'Exhausted or reset exposure ordinal');
    counters.set(entry.bankId, ordinal);
  }
  const evaluation = packet.evaluationReservation;
  const bank = banks.get(evaluation.bankId);
  const reservation = reservations.get(evaluation.reservationId);
  requirePlan(bank && reservation, 'Missing evaluator-owned reservation');
  requirePlan(bank.digest === evaluation.digest && bank.precommitId === evaluation.precommitId && bank.purpose === evaluation.purpose, 'Forged bank identity');
  requirePlan(reservation.bankId === bank.bankId && reservation.runId === packet.runId && reservation.sourceSha === packet.sourceSha && reservation.ordinal === evaluation.exposureOrdinal && reservation.sequence === evaluation.ledgerSequence, 'Forged exposure receipt');
  requirePlan(evaluation.digest === subjects.get(packet.subjects.dataset).sha256, 'Evaluation dataset differs from bank');
  const permits = indexUnique(examples.rolloutPermits.map((permit) => ({ ...permit, id: permit.permitId })), 'rollout permits');
  requirePlan(new Set([...permits.values()].map((p) => p.nonce)).size === permits.size, 'Permit nonce reused');
  for (const permit of permits.values()) {
    requirePlan(permit.envelopeId === binding.envelopeId && permit.envelopeSha256 === binding.envelopeSha256, 'Permit envelope substitution');
    requirePlan(permit.manifestSha256 === subjects.get('releaseManifest').sha256 && permit.fencingEpoch === packet.fencingEpoch, 'Permit subject mismatch');
    const ttl = Date.parse(permit.expiresAt) - Date.parse(permit.issuedAt);
    requirePlan(Number.isFinite(ttl) && ttl > 0 && ttl <= limit.permitTtlSeconds * 1000, 'Invalid rollout permit TTL');
    requirePlan(Date.parse(permit.consumedAt) >= Date.parse(permit.issuedAt) && Date.parse(permit.consumedAt) < Date.parse(permit.expiresAt), 'Stale rollout permit consumed');
    if (permit.phase === 'full') {
      const parent = permits.get(permit.parentPermitId);
      requirePlan(parent?.phase === 'cohort' && permit.permitId !== parent.permitId && permit.nonce !== parent.nonce, 'Expansion reuses cohort permit');
      requirePlan(Date.parse(permit.issuedAt) > Date.parse(parent.issuedAt), 'Expansion precedes cohort');
    } else requirePlan(permit.parentPermitId === 'none' && permit.scope !== 'all-authorized-accounts', 'Invalid initial cohort scope');
  }
  indexUnique(packet.checks, 'checks');
  indexUnique(packet.negativeControls, 'negative controls');
  for (const check of packet.checks) {
    requirePlan(gates.has(check.gate), 'Unknown check gate');
    requirePlan(roles.get(check.producerRole)?.canAttest, 'Untrusted check producer');
    requirePlan(subjects.get(check.resultSubject)?.kind === 'result', 'Missing result subject');
    requirePlan(check.expected === check.attempted + check.skipped, 'Test inventory mismatch');
    requirePlan(check.attempted === check.passed + check.failed + check.timedOut, 'Test result denominator mismatch');
    for (const id of check.artifactSubjects) {
      requirePlan(id === packet.subjects.api || id === packet.subjects.frontend, 'Check tested different artifact');
      requirePlan(subjects.get(check.resultSubject).parents.some((p) => p.relation === 'testedArtifact' && p.subject === id), 'Missing tested-artifact edge');
    }
  }
  for (const control of packet.negativeControls) requirePlan(gates.has(control.gate), 'Unknown negative-control gate');
  const event = examples.eventExample;
  requirePlan(event.runId === packet.runId && event.sourceSha === packet.sourceSha && event.fencingEpoch === packet.fencingEpoch, 'Event subject or epoch mismatch');
  requirePlan(event.policySha256 === subjects.get(packet.subjects.policy).sha256, 'Event policy mismatch');
  requirePlan([...subjects.values()].some((s) => s.sha256 === event.payloadSha256), 'Unknown event payload');
  requirePlan(workflow.transitions.some((t) => t.event === event.eventType), 'Unknown event type');
  indexUnique(examples.traces, 'traces');
  for (const trace of examples.traces) {
    requirePlan(states.has(trace.start), 'Unknown trace start');
    let state = trace.start;
    let builds = 0;
    for (const eventType of trace.events) {
      const transition = transitions.get(`${state}:${eventType}`);
      requirePlan(transition, `${trace.id}: invalid ${state}/${eventType}`);
      if (eventType === 'start_build') builds++;
      requirePlan(builds <= limit.builderAttempts, `${trace.id}: exceeds attempt budget`);
      state = transition.to;
    }
    requirePlan(state === trace.end && states.get(state).terminal, `${trace.id}: wrong terminal state`);
  }
  return { slices: slices.size, findings: findings.size, states: states.size, subjects: subjects.size, checks: acceptanceIds.size };
}

inspectSchema(schema);
requirePlan(auditIds.length === 52 && new Set(auditIds).size === 52, 'Committed audit ID inventory corrupt');
const result = validatePlan(bundle);
const tests = [
  ['duplicate slice', (p) => p.backlog.slices.push(structuredClone(p.backlog.slices[0]))],
  ['unknown dependency', (p) => p.backlog.slices[0].dependsOn.push('S99')],
  ['dependency cycle', (p) => p.backlog.slices[0].dependsOn.push('S48')],
  ['missing audit finding', (p) => p.backlog.findings.pop()],
  ['wrong audit path', (p) => { p.backlog.auditRegister = '..\\untrusted.md'; }],
  ['wrong baseline SHA', (p) => { p.backlog.auditCommit = 'a'.repeat(40); }],
  ['invalid closure', (p) => p.backlog.findings[0].closureSlices.push('S99')],
  ['empty visible outcome', (p) => { p.backlog.slices[0].visibleChange = ''; }],
  ['missing acceptance', (p) => { p.backlog.slices[0].acceptance = []; }],
  ['unknown gate', (p) => p.backlog.slices[0].gates.push('G99')],
  ['unmapped acceptance', (p) => { p.backlog.slices[0].acceptance[0].gate = 'G06'; }],
  ['builder self-attestation', (p) => { p.policy.roles.find((r) => r.id === 'builder').canAttest = true; }],
  ['infinite retries', (p) => { p.policy.limits.builderAttempts = 999; }],
  ['missing hard gate', (p) => { p.policy.mandatoryGates = p.policy.mandatoryGates.filter((g) => g !== 'G01'); }],
  ['missing sticky isolation', (p) => { p.policy.productMandatoryGates = ['G04', 'G05']; }],
  ['missing sticky consent', (p) => { p.policy.productMandatoryGates = ['G03', 'G05']; }],
  ['missing sticky durability', (p) => { p.policy.productMandatoryGates = ['G03', 'G04']; }],
  ['R0 generation enabled', (p) => p.examples.capabilityBinding.observedCapabilities.push('chat.generate')],
  ['R1 worker fence dependency removed', (p) => { const e = p.policy.capabilityEnvelopes.find((e) => e.id === 'R1'); e.requiredShippedSlices = e.requiredShippedSlices.filter((id) => id !== 'S08'); }],
  ['unknown capability', (p) => p.policy.capabilities.push('production.admin')],
  ['forged envelope digest', (p) => { p.examples.capabilityBinding.envelopeSha256 = '0'.repeat(64); }],
  ['unknown envelope', (p) => { p.examples.capabilityBinding.envelopeId = 'R99'; }],
  ['rollback restores revoked capability', (p) => { p.examples.capabilityBinding.rollbackEnvelopeId = 'R3'; }],
  ['missing bootstrap dependency', (p) => { p.examples.capabilityBinding.bootstrapCandidateSlices = ['S01','S02','S04']; }],
  ['permit envelope mismatch', (p) => { p.examples.rolloutPermits[1].envelopeId = 'R3'; }],
  ['manual fallback', (p) => { p.policy.blockedPolicy.humanFallback = true; }],
  ['unapproved spending', (p) => { p.policy.authorizationGranted = true; }],
  ['ambiguous transition', (p) => p.workflow.transitions.push(structuredClone(p.workflow.transitions[0]))],
  ['builder promotion', (p) => { p.workflow.transitions.find((t) => t.to === 'PROMOTING').actor = 'builder'; }],
  ['terminal reopened', (p) => p.workflow.transitions[0].from.push('SHIPPED')],
  ['unbounded workflow cycle', (p) => { p.workflow.transitions.find((t) => t.event === 'patch_submitted').to = 'BUILDING'; }],
  ['unfenced retry', (p) => { p.workflow.transitions.find((t) => t.event === 'retry').guards = ['valid-envelope']; }],
  ['evidence cycle', (p) => p.examples.subjects[0].parents.push({ relation: 'derivedFrom', subject: 'releaseManifest' })],
  ['artifact substitution', (p) => { p.examples.subjects[1].payload = 'different artifact'; }],
  ['builder result producer', (p) => { p.examples.packet.checks[0].producerRole = 'builder'; }],
  ['wrong tested artifact', (p) => { p.examples.packet.checks[0].artifactSubjects = ['configuration']; }],
  ['missing denominator', (p) => { p.examples.packet.checks[0].attempted = 0; }],
  ['missed negative control', (p) => { p.examples.packet.negativeControls[0].observed = 'ACCEPT'; }],
  ['stale event epoch', (p) => { p.examples.eventExample.fencingEpoch = 6; }],
  ['excessive permit lifetime', (p) => { p.examples.packet.expiresAt = '2026-09-11T06:00:00Z'; }],
  ['example claims release', (p) => { p.examples.releaseEligible = true; }],
  ['fourth adaptive exposure', (p) => {
    p.examples.exposureLedger.reservations.push(
      { reservationId: 'validation-A-3', bankId: 'validation-bank-A', ordinal: 3, sequence: 4, runId: 'extra-3', sourceSha: sourceBaseline, outcome: 'failed' },
      { reservationId: 'validation-A-4', bankId: 'validation-bank-A', ordinal: 4, sequence: 5, runId: 'extra-4', sourceSha: sourceBaseline, outcome: 'failed' });
  }],
  ['reset exposure ordinal', (p) => { p.examples.exposureLedger.reservations[1].ordinal = 1; }],
  ['reused final bank', (p) => p.examples.exposureLedger.reservations.push({ reservationId: 'final-A-2', bankId: 'final-bank-A', ordinal: 2, sequence: 4, runId: 'retry', sourceSha: sourceBaseline, outcome: 'aborted' })],
  ['exposure bound to wrong source', (p) => { p.examples.exposureLedger.reservations[2].sourceSha = 'a'.repeat(40); }],
  ['forged exposure receipt', (p) => { p.examples.packet.evaluationReservation.exposureOrdinal = 2; }],
  ['changed bank digest', (p) => { p.examples.packet.evaluationReservation.digest = '0'.repeat(64); }],
  ['refund aborted exposure', (p) => { p.policy.holdoutPolicy.refundAbortedExposure = true; }],
  ['reused permit nonce', (p) => { p.examples.rolloutPermits[1].nonce = p.examples.rolloutPermits[0].nonce; }],
  ['wrong permit phase', (p) => { p.examples.rolloutPermits[1].phase = 'cohort'; }],
  ['expired permit consumed', (p) => { p.examples.rolloutPermits[0].consumedAt = '2026-09-10T07:00:00Z'; }],
  ['reused permit identity', (p) => { p.examples.rolloutPermits[1].permitId = p.examples.rolloutPermits[0].permitId; }],
  ['expansion missing permit', (p) => { p.workflow.transitions.find((t) => t.effect === 'expand').guards = ['gates-passed']; }],
  ['initial authorization missing gate recheck', (p) => { const t = p.workflow.transitions.find((t) => t.effect === 'promote'); t.guards = t.guards.filter((g) => g !== 'gates-passed'); }],
  ['cohort missing rollback', (p) => { p.workflow.transitions.find((t) => t.event === 'release_failed').from = ['EXPANDING']; }],
  ['invalid simulated trace', (p) => p.examples.traces[0].events.splice(1, 1)],
];
for (const [name, mutate] of tests) {
  const invalid = structuredClone(bundle);
  mutate(invalid);
  let rejected = false;
  try { validatePlan(invalid); } catch (error) {
    if (!(error instanceof PlanError)) throw error;
    rejected = true;
  }
  assert.ok(rejected, `Negative control survived: ${name}`);
}
const backlogDocument = read('04-implementation-backlog.md');
const rows = [...backlogDocument.matchAll(/^\| ([HES]\d{2}) \| ([^|]+) \|/gm)];
requirePlan(rows.length === result.slices, 'Markdown slice table count differs');
const rowMap = new Map(rows.map((match) => [match[1], match[2].trim()]));
for (const slice of bundle.backlog.slices) requirePlan(rowMap.get(slice.id) === slice.title, `Markdown title differs: ${slice.id}`);
for (const gate of bundle.policy.gates) {
  const filename = gate.definition.split('#')[0];
  const fullPath = resolve(directory, filename);
  const local = relative(directory, fullPath);
  requirePlan(!local.startsWith('..') && !isAbsolute(local) && existsSync(fullPath), `Invalid gate document ${filename}`);
}
console.log(`Plan valid: ${result.slices} slices, ${result.findings} audited findings, ${result.checks} acceptance checks, ${result.states} workflow states, ${result.subjects} synthetic evidence subjects.`);
console.log(`Negative controls: ${tests.length}/${tests.length} rejected. Markdown slice table matches JSON. No network, model, product test or deployment executed.`);
console.log('Scope: schema subset and structural/trace validation only; guard truth, cryptographic authority and runtime behavior are NOT established.');
