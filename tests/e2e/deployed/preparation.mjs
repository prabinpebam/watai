import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';

const capabilities = new WeakMap();
const hashPattern = /^[a-f0-9]{64}$/;
const text = value => typeof value === 'string' && value.trim().length > 0 && !/\b(TODO|TBD|PLACEHOLDER)\b/i.test(value);
const strings = value => Array.isArray(value) && value.length > 0 && value.every(text) && new Set(value).size === value.length;
export const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
export const preparationDigest = value => createHash('sha256').update(canonical(value)).digest('hex');

export function validatePreparation(pack, flow) {
  const missing = [];
  const require = (condition, code) => { if (!condition) missing.push(code); };
  if (!pack || typeof pack !== 'object') return ['FLOW_PACK_MISSING'];
  require(pack.schemaVersion === 1 && pack.flowId === flow.id && pack.flowVersion === flow.version &&
    pack.flowDigest === preparationDigest(flow), 'FLOW_BINDING_MISMATCH');
  require(text(pack.expectation) && strings(pack.userGoals), 'QUALITATIVE_EXPECTATION_REQUIRED');
  require(strings(pack.preconditions) && strings(pack.cleanup) && strings(pack.safety), 'STATE_AND_SAFETY_PLAN_REQUIRED');
  require(Array.isArray(pack.unresolved) && pack.unresolved.length === 0, 'UNRESOLVED_FLOW_DETAILS');
  const steps = Array.isArray(pack.steps) ? pack.steps : [];
  if (steps.some(step => !step || typeof step !== 'object')) return [...missing, 'INVALID_STEP_RECORD'];
  const ids = steps.map(step => step.id);
  require(steps.length > 0 && strings(ids), 'UNIQUE_STEP_DEFINITIONS_REQUIRED');
  require(text(pack.entryStep) && ids.includes(pack.entryStep), 'ENTRY_STEP_REQUIRED');
  require(flow.requiredPhases.every(phase => steps.some(step => step.phase === phase)), 'PHASE_DESIGN_INCOMPLETE');
  for (const step of steps) {
    require(flow.phases.includes(step.phase) && text(step.action) && text(step.trigger) &&
      text(step.expected) && strings(step.failureModes) && strings(step.next) &&
      step.next.every(next => next === 'end' || next === 'stop' || ids.includes(next)) &&
      Number.isSafeInteger(step.deadlineMs) && step.deadlineMs > 0 && step.deadlineMs <= flow.deadlineMs &&
      Number.isSafeInteger(step.maxVisits) && step.maxVisits > 0,
    `STEP_INCOMPLETE:${step.id}`);
    const capture = step.capture;
    require(capture && strings(capture.channels) && strings(capture.fields) && text(capture.start) &&
      text(capture.end) && text(capture.overflow) && text(capture.unexpectedSurface) &&
      Number.isSafeInteger(capture.maxBytes) && capture.maxBytes > 0 && capture.maxBytes <= flow.maxEvidenceBytes &&
      Array.isArray(capture.regions) && capture.regions.length === flow.regions.length &&
      capture.regions.every(region => region && typeof region === 'object') &&
      new Set(capture.regions.map(region => region.id)).size === flow.regions.length && capture.regions.every(region =>
        flow.regions.some(bound => bound.id === region.id && bound.selector === region.selector) &&
        ['detailed', 'context', 'abstract'].includes(region.level) && strings(region.fields) && text(region.reason)),
    `CAPTURE_PLAN_INCOMPLETE:${step.id}`);
  }
  const reachable = new Set();
  const pending = [pack.entryStep];
  while (pending.length) {
    const id = pending.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    const step = steps.find(item => item.id === id);
    if (Array.isArray(step?.next)) pending.push(...step.next);
  }
  require(ids.every(id => reachable.has(id)) && (reachable.has('end') || reachable.has('stop')), 'STEP_GRAPH_INCOMPLETE');
  require(steps.reduce((total, step) => total + step.deadlineMs * step.maxVisits, 0) <= flow.deadlineMs, 'STEP_BUDGET_EXCEEDS_FLOW');
  const checks = Array.isArray(pack.heuristics) ? pack.heuristics : [];
  if (checks.some(check => !check || typeof check !== 'object')) return [...missing, 'INVALID_HEURISTIC_RECORD'];
  require(checks.length > 0 && strings(checks.map(check => check.id)), 'HEURISTIC_DESIGN_REQUIRED');
  require(flow.requiredOutcomes.every(name => checks.some(check => check.outcome === name)), 'HEURISTIC_OUTCOME_COVERAGE_INCOMPLETE');
  require(ids.every(id => checks.some(check => check.steps?.includes(id))), 'HEURISTIC_STEP_COVERAGE_INCOMPLETE');
  for (const check of checks) require(strings(check.steps) && check.steps.every(id => ids.includes(id)) &&
    text(check.algorithm) && strings(check.inputs) && text(check.pass) && text(check.fail) &&
    text(check.insufficient) && strings(check.negativeCases) && text(check.implementation), `HEURISTIC_INCOMPLETE:${check.id}`);
  const semantic = pack.semantic;
  require(semantic?.required === true && semantic.openEnded === true && text(semantic.expectation) &&
    semantic.skillPath === '.github/skills/edd-semantic-review/SKILL.md' && hashPattern.test(semantic.skillSha256 ?? '') &&
    semantic.agentPath === 'tests/e2e/deployed/semantic-agent.json' && hashPattern.test(semantic.agentSha256 ?? '') &&
    semantic.reviewProtocol === 'complete-timeline-then-cross-phase-synthesis-v1' &&
    strings(semantic.evidenceLayers) && text(semantic.contextExhaustion) && text(semantic.findingContract),
  'SEMANTIC_HARNESS_BINDING_REQUIRED');
  require(Array.isArray(pack.artifacts) && pack.artifacts.length >= 5 &&
    pack.artifacts.length <= 128 && pack.artifacts.every(item => item && typeof item === 'object') &&
    new Set(pack.artifacts.map(item => item.path)).size === pack.artifacts.length &&
    ['tests/e2e/deployed/capture.mjs', 'tests/e2e/deployed/core.mjs', 'tests/e2e/deployed/semantic.mjs', 'tests/e2e/deployed/run.mjs', 'tests/e2e/deployed/preparation.mjs']
      .every(path => pack.artifacts.some(item => item.path === path)) &&
    pack.artifacts.every(item => text(item.path) && hashPattern.test(item.sha256 ?? '')), 'IMPLEMENTATION_BINDINGS_REQUIRED');
  require(pack.attestations === undefined || (Array.isArray(pack.attestations) && pack.attestations.every(record =>
    record && typeof record === 'object')), 'INVALID_ATTESTATION_RECORDS');
  return [...new Set(missing)];
}

export async function inspectPreparation({ pack, flow, readArtifact, verifyAttestation, now = Date.now() }) {
  pack = structuredClone(pack);
  flow = structuredClone(flow);
  const blockers = validatePreparation(pack, flow);
  if (blockers.length) return { ready: false, blockers, variantId: pack?.variantId,
    unresolved: Array.isArray(pack?.unresolved) ? pack.unresolved.filter(text) : [] };
  const bindings = [...pack.artifacts, { path: pack.semantic.skillPath, sha256: pack.semantic.skillSha256 },
    { path: pack.semantic.agentPath, sha256: pack.semantic.agentSha256 }];
  const contents = new Map();
  for (const binding of bindings) {
    try {
      const bytes = await readArtifact(binding.path);
      if (createHash('sha256').update(bytes).digest('hex') !== binding.sha256) blockers.push(`ARTIFACT_CHANGED:${binding.path}`);
      else contents.set(binding.path, bytes);
    } catch { blockers.push(`ARTIFACT_UNAVAILABLE:${binding.path}`); }
  }
  if (!blockers.length) {
    try {
      const { validateSemanticProfile } = await import('./semantic.mjs');
      const profile = JSON.parse(contents.get(pack.semantic.agentPath).toString('utf8'));
      validateSemanticProfile(profile);
        const coveredEvents = profile.windowEvents + (profile.maxWindows - 1) * (profile.windowEvents - profile.overlapEvents);
        const requiredWindows = Math.max(1, Math.ceil((flow.maxEvents - profile.overlapEvents) / (profile.windowEvents - profile.overlapEvents)));
        if (flow.maxEvents > coveredEvents || flow.maxEvidenceBytes > profile.maxInputBytes ||
          profile.maxRequests < requiredWindows + 1) blockers.push('SEMANTIC_CAPTURE_CAPACITY_INSUFFICIENT');
      const skill = contents.get(pack.semantic.skillPath).toString('utf8');
      if (!/^---\r?\n/.test(skill) || !/^name: edd-semantic-review\r?$/m.test(skill) ||
          profile.skillPath !== pack.semantic.skillPath || profile.reviewProtocol !== pack.semantic.reviewProtocol) {
        throw new Error('INVALID_SKILL_BINDING');
      }
    } catch { blockers.push('SEMANTIC_CONFIGURATION_INVALID'); }
  }
  const unsigned = { ...pack }; delete unsigned.attestations;
  const packDigest = preparationDigest(unsigned);
  let expiresAt = Infinity;
  for (const kind of ['flow-design-review', 'capture-calibration', 'heuristic-calibration', 'semantic-agent-calibration', 'semantic-runtime-readiness']) {
    const records = (pack.attestations ?? []).filter(record => record.kind === kind);
    if (records.length !== 1) { blockers.push(`ATTESTATION_REQUIRED:${kind}`); continue; }
    const record = records[0];
    const until = Date.parse(record.expiresAt);
    if (record.subject !== packDigest || record.result !== 'accepted' || !(until > now) ||
      !text(record.issuer) || !text(record.signature) || typeof verifyAttestation !== 'function' ||
      await Promise.resolve().then(() => verifyAttestation(structuredClone(record))).catch(() => false) !== true) {
      blockers.push(`ATTESTATION_UNVERIFIED:${kind}`); continue;
    }
    expiresAt = Math.min(expiresAt, until);
  }
  if (blockers.length) return { ready: false, packDigest, blockers, variantId: pack.variantId };
  const handle = Object.freeze({ packDigest });
  capabilities.set(handle, { flowDigest: preparationDigest(flow), expiresAt, pack: structuredClone(pack) });
  return { ready: true, blockers: [], packDigest, handle, variantId: pack.variantId };
}

export function preparationBlockers(handle, flow, now = Date.now()) {
  const record = handle && capabilities.get(handle);
  if (!record) return ['FLOW_PREPARATION_REQUIRED', 'SEMANTIC_REVIEW_HARNESS_REQUIRED'];
  if (record.expiresAt <= now || record.flowDigest !== preparationDigest(flow)) return ['FLOW_PREPARATION_STALE'];
  return [];
}

export function semanticPreparation(handle, flow, profileBytes, skillBytes, now = Date.now()) {
  const blockers = preparationBlockers(handle, flow, now);
  if (blockers.length) throw new Error(blockers.join(','));
  const { pack } = capabilities.get(handle);
  if (createHash('sha256').update(profileBytes).digest('hex') !== pack.semantic.agentSha256 ||
      createHash('sha256').update(skillBytes).digest('hex') !== pack.semantic.skillSha256) {
    throw new Error('SEMANTIC_PREPARATION_BINDING_MISMATCH');
  }
  return structuredClone(pack.semantic);
}

export function preparedActionSteps(handle, flow, now = Date.now()) {
  const blockers = preparationBlockers(handle, flow, now);
  if (blockers.length) throw new Error(blockers.join(','));
  const steps = capabilities.get(handle).pack.steps;
  if (steps.length !== flow.phases.length || steps.some((step, index) => step.phase !== flow.phases[index] || step.maxVisits !== 1)) {
    throw new Error('DRIVER_REQUIRES_FIXED_SINGLE_VISIT_PHASES');
  }
  return structuredClone(steps.map(({ id, phase, deadlineMs }) => ({ id, phase, deadlineMs })));
}

export async function readPreparation(root, flow, verifyAttestation) {
  const base = await realpath(root);
  const readArtifact = async path => {
    if (!text(path) || isAbsolute(path)) throw new Error('UNSAFE_PREPARATION_PATH');
    const target = await realpath(resolve(base, path));
    const location = relative(base, target);
    if (location.startsWith('..') || isAbsolute(location)) throw new Error('UNSAFE_PREPARATION_PATH');
    return readFile(target);
  };
  try {
    const pack = JSON.parse(await readArtifact(`tests/e2e/deployed/preparation/${flow.id}.json`));
    return await inspectPreparation({ pack, flow, readArtifact, verifyAttestation });
  } catch { return { ready: false, blockers: [`FLOW_PACK_MISSING_OR_INVALID:${flow.id}`] }; }
}

export function validatePreparationCatalog(catalog) {
  if (catalog?.schemaVersion !== 1 || !text(catalog.coverageVersion) || !text(catalog.source) ||
      typeof catalog.denominatorApproved !== 'boolean' || !Array.isArray(catalog.flows) || !catalog.flows.length ||
      !strings(catalog.flows.map(flow => flow?.id)) || catalog.flows.some(flow =>
        !/^[A-Z]+-\d{2}$/.test(flow.id) || !text(flow.task) || !Array.isArray(flow.missingDetails) ||
        flow.missingDetails.some(detail => !text(detail)))) throw new Error('INVALID_PREPARATION_CATALOG');
}

export function validatePilot(pilot, catalog) {
  if (pilot?.schemaVersion !== 1 || !text(pilot.id) || !Number.isSafeInteger(pilot.version) || pilot.version < 1 ||
      pilot.target !== 'https://prabinpebam.github.io/watai/' || pilot.releaseEligible !== false ||
      !Array.isArray(pilot.variants) || pilot.variants.length !== 5 || !strings(pilot.variants.map(item => item?.flowId)) ||
      !strings(pilot.variants.map(item => item?.variantId)) || pilot.execution?.maxAttemptsPerVariant !== 1 ||
      pilot.execution?.liveEnabled !== false || !strings(pilot.execution?.stopOn) ||
      !strings(pilot.execution?.order) || pilot.execution.order.length !== 5) throw new Error('INVALID_FIVE_FLOW_PILOT');
  const seen = new Set();
  for (const id of pilot.execution.order) {
    const variant = pilot.variants.find(item => item.flowId === id);
    if (!variant || !catalog.flows.some(item => item.id === id) || !variant.variantId.startsWith(`${id}.`) ||
        !text(variant.task) || !Array.isArray(variant.dependsOn) || variant.dependsOn.some(parent => !seen.has(parent))) throw new Error('INVALID_PILOT_DEPENDENCY');
    seen.add(id);
  }
}

export async function preparationInventory(root, definitions, pilot) {
  const catalog = JSON.parse(await readFile(resolve(root, 'tests/e2e/deployed/preparation/catalog.json'), 'utf8'));
  validatePreparationCatalog(catalog);
  if (pilot) validatePilot(pilot, catalog);
  const selected = pilot ? pilot.execution.order.map(id => catalog.flows.find(item => item.id === id)) : catalog.flows;
  const flows = await Promise.all(selected.map(async item => {
    const flow = definitions.find(definition => definition.id === item.id);
    const inspection = flow ? await readPreparation(root, flow) : { ready: false, blockers: ['FLOW_DRIVER_AND_DEFINITION_REQUIRED'] };
    const blockers = [...inspection.blockers, ...(inspection.unresolved ?? []).map(detail => `PACK_DETAIL_REQUIRED:${detail}`),
      ...(pilot ? [] : item.missingDetails.map(detail => `DESIGN_DETAIL_REQUIRED:${detail}`))];
    const variant = pilot?.variants.find(variant => variant.flowId === item.id);
    if (flow?.driver === 'PILOT_DRIVER_NOT_IMPLEMENTED') blockers.push('PILOT_DRIVER_NOT_IMPLEMENTED');
    if (flow?.driver === 'PILOT_DRIVER_IMPLEMENTED_UNCALIBRATED') blockers.push('PILOT_DRIVER_CALIBRATION_REQUIRED');
    if (flow?.driver === 'PILOT_DRIVER_LOCAL_CALIBRATED') blockers.push('PILOT_REAL_SERVICE_CALIBRATION_REQUIRED');
    if (variant && inspection.variantId && inspection.variantId !== variant.variantId) blockers.push('PILOT_VARIANT_BINDING_MISMATCH');
    return { flowId: item.id, ...(variant ? { variantId: variant.variantId } : {}), task: variant?.task ?? item.task, status: blockers.length ? 'NOT_READY' : 'READY',
      preparationPath: `tests/e2e/deployed/preparation/${item.id}.json`, blockers };
  }));
  return { generatedAt: new Date().toISOString(), coverageVersion: pilot ? `${pilot.id}-v${pilot.version}` : catalog.coverageVersion,
    scope: pilot ? 'five-flow-pilot' : 'full-catalog', deferredFlows: catalog.flows.length - selected.length,
    denominatorApproved: pilot ? true : catalog.denominatorApproved, releaseEligible: false,
    requiredFlows: flows.length, readyFlows: flows.filter(flow => flow.status === 'READY').length,
    status: (pilot || catalog.denominatorApproved) && flows.every(flow => flow.status === 'READY') ? 'READY' : 'NOT_READY', flows };
}