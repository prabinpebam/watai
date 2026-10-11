import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReviewEvidence, createReviewJournal } from './evidence.mjs';
import { inspectPreparation, validatePreparation, preparationDigest, preparationBlockers, semanticPreparation, validatePreparationCatalog, preparationInventory } from './preparation.mjs';
import { fileURLToPath } from 'node:url';
import { pilotChatPlans } from './pilot-chat-plans.mjs';
import { encodeReviewEvidence, decodeReviewEvidence, encodeTimelineWindow, decodeTimelineWindow, planTimelineWindows } from './review-codec.mjs';
import { preflight, targetUrl } from './core.mjs';
import { buildSemanticSession, prepareEvidence, validateSemanticResult, runSemanticReview, combineEvaluations, createSemanticDispatchGuard, createSemanticMetadataGuard, prepareSemanticCalibration } from './semantic.mjs';

const sourceFlow = JSON.parse(readFileSync(new URL('./flows.json', import.meta.url))).flows[0];
const flow = { ...sourceFlow, maxEvents: 9, maxEvidenceBytes: 10000 };
const bytes = Buffer.from('offline fixture only');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const now = Date.parse('2026-09-12T00:00:00Z');
const profileFile = readFileSync(new URL('./semantic-agent.json', import.meta.url));
const profile = JSON.parse(profileFile);
const skillFile = readFileSync(new URL('../../../.github/skills/edd-semantic-review/SKILL.md', import.meta.url));
const fixtureArtifact = async path => path === profile.skillPath ? skillFile : path === 'tests/e2e/deployed/semantic-agent.json' ? profileFile : bytes;
function fixture() {
  const pack = {
    schemaVersion: 1, flowId: flow.id, flowVersion: flow.version, flowDigest: preparationDigest(flow),
    expectation: 'A visitor can understand and use the welcome screen.', userGoals: ['Reach a usable welcome screen'],
    preconditions: ['Fresh signed-out context'], cleanup: ['Close owned browser'], safety: ['No model calls'], unresolved: [],
    entryStep: flow.phases[0],
    steps: flow.phases.map((phase, index) => ({ id: phase, phase, action: 'Observe the real app', trigger: 'Driver phase starts',
      expected: 'Required surface is usable', failureModes: ['Hidden primary content'], next: [flow.phases[index + 1] ?? 'end'], deadlineMs: 1000, maxVisits: 1,
      capture: { channels: ['mutations', 'frames'], fields: ['order', 'safe-text', 'bounds'], start: 'Before action',
        end: 'Declared phase ends', overflow: 'Stop as insufficient', unexpectedSurface: 'Stop and retain evidence', maxBytes: 1000,
        regions: flow.regions.map(region => ({ ...region, fields: ['bounds'], reason: 'Required context' })) } })),
    heuristics: flow.requiredOutcomes.map(outcome => ({ id: outcome, outcome, steps: [...flow.phases],
      algorithm: 'Compare fixed expected value', inputs: ['events'], pass: 'Exact agreement', fail: 'Mismatch',
      insufficient: 'Missing evidence', negativeCases: ['Wrong value'], implementation: 'tests/e2e/deployed/core.mjs' })),
    semantic: { required: true, openEnded: true, expectation: 'The complete experience meets the user goal.',
      skillPath: '.github/skills/edd-semantic-review/SKILL.md', skillSha256: createHash('sha256').update(skillFile).digest('hex'),
      agentPath: 'tests/e2e/deployed/semantic-agent.json', agentSha256: createHash('sha256').update(profileFile).digest('hex'),
      reviewProtocol: 'complete-timeline-then-cross-phase-synthesis-v1', evidenceLayers: ['visual'],
      contextExhaustion: 'Insufficient evidence, never truncate', findingContract: 'Novel findings cite original evidence' },
    artifacts: ['capture', 'core', 'semantic', 'run', 'preparation'].map(name => ({ path: `tests/e2e/deployed/${name}.mjs`, sha256 })),
  };
  pack.attestations = ['flow-design-review', 'capture-calibration', 'heuristic-calibration', 'semantic-agent-calibration', 'semantic-runtime-readiness'].map(kind => ({
    kind, subject: preparationDigest(pack), result: 'accepted', issuer: 'offline-test-verifier',
    signature: 'test-only', expiresAt: '2026-09-12T01:00:00Z',
  }));
  return pack;
}
test('missing preparation and fabricated readiness cannot start a flow', () => {
  assert.deepEqual(validatePreparation(null, flow), ['FLOW_PACK_MISSING']);
  const result = preflight({ target: targetUrl, liveEnabled: true }, flow, { approvalValid: true, preparation: { ready: true } });
  assert.equal(result.ready, false);
});
test('complete offline fixture needs verified attestations; structure alone is insufficient', async () => {
  const pack = fixture();
  assert.deepEqual(validatePreparation(pack, flow), []);
  const blocked = await inspectPreparation({ pack, flow, readArtifact: fixtureArtifact, now });
  assert.equal(blocked.ready, false);
  assert.ok(blocked.blockers.includes('ATTESTATION_UNVERIFIED:semantic-agent-calibration'));
  const verified = await inspectPreparation({ pack, flow, readArtifact: fixtureArtifact, verifyAttestation: async () => true, now });
  assert.equal(verified.ready, true);
  assert.deepEqual(preparationBlockers(verified.handle, flow, now), []);
  assert.deepEqual(preparationBlockers(verified.handle, { ...flow, version: 999 }, now), ['FLOW_PREPARATION_STALE']);
  assert.deepEqual(preparationBlockers(verified.handle, flow, now + 3600000), ['FLOW_PREPARATION_STALE']);
  assert.equal(semanticPreparation(verified.handle, flow, profileFile, skillFile, now).required, true);
  assert.throws(() => semanticPreparation(verified.handle, flow, Buffer.from('other model'), skillFile, now), /BINDING_MISMATCH/);
  assert.throws(() => semanticPreparation(verified.handle, flow, profileFile, Buffer.from('other skill'), now), /BINDING_MISMATCH/);
});
for (const change of ['step', 'capture', 'heuristic', 'semantic', 'unresolved', 'flow', 'attestation', 'artifact', 'unreachable-step', 'unbounded-loop']) {
  test(`incomplete or changed ${change} blocks readiness`, async () => {
    const pack = fixture();
    if (change === 'step') pack.steps.pop();
    if (change === 'capture') delete pack.steps[0].capture.fields;
    if (change === 'heuristic') pack.heuristics.pop();
    if (change === 'semantic') pack.semantic.openEnded = false;
    if (change === 'unresolved') pack.unresolved.push('Missing validated selector');
    if (change === 'flow') pack.flowDigest = '0'.repeat(64);
    if (change === 'attestation') pack.attestations.pop();
    if (change === 'unreachable-step') pack.steps[0].next = ['end'];
    if (change === 'unbounded-loop') delete pack.steps[0].maxVisits;
    const result = await inspectPreparation({ pack, flow, readArtifact: async path => change === 'artifact' ? Buffer.from('changed') : fixtureArtifact(path),
      verifyAttestation: async () => true, now });
    assert.equal(result.ready, false);
  });
}

test('malformed nested preparation denies admission without interpreting missing records', async () => {
  for (const field of ['steps', 'heuristics', 'artifacts', 'attestations']) {
    const pack = fixture(); pack[field] = [null];
    const result = await inspectPreparation({ pack, flow, readArtifact: fixtureArtifact, verifyAttestation: async () => true, now });
    assert.equal(result.ready, false);
  }
});

test('async verification uses a locked copy rather than caller-mutated preparation', async () => {
  const pack = fixture();
  const result = await inspectPreparation({ pack, flow, readArtifact: async path => {
    pack.semantic.expectation = 'Changed after review started';
    return fixtureArtifact(path);
  }, verifyAttestation: async record => { record.subject = 'changed verifier argument'; return true; }, now });
  assert.equal(result.ready, true);
  assert.equal(semanticPreparation(result.handle, flow, profileFile, skillFile, now).expectation, 'The complete experience meets the user goal.');
});

test('a signed but invalid semantic profile still cannot admit browser execution', async () => {
  const pack = fixture(); delete pack.attestations;
  const invalidProfile = Buffer.from(JSON.stringify({ ...profile, tools: ['shell'] }));
  pack.semantic.agentSha256 = createHash('sha256').update(invalidProfile).digest('hex');
  const subject = preparationDigest(pack);
  pack.attestations = fixture().attestations.map(record => ({ ...record, subject }));
  const result = await inspectPreparation({ pack, flow, readArtifact: async path =>
    path === pack.semantic.agentPath ? invalidProfile : fixtureArtifact(path), verifyAttestation: async () => true, now });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('SEMANTIC_CONFIGURATION_INVALID'));
});

test('semantic SDK configuration preloads the named skill and exposes only evidence tools', async () => {
  const skill = readFileSync(new URL('../../../.github/skills/edd-semantic-review/SKILL.md', import.meta.url), 'utf8');
  const session = buildSemanticSession({ profile, skill, skillDirectory: 'isolated-skills', scratchDirectory: 'isolated-scratch', tools: [] });
  assert.equal(session.agent, 'edd-semantic-reviewer');
  assert.deepEqual(session.customAgents[0].skills, ['edd-semantic-review']);
  assert.deepEqual(session.availableTools, ['read_evidence_window', 'read_evidence_asset']);
  assert.deepEqual(session.excludedTools, ['builtin:*', 'mcp:*']);
  assert.equal(session.enableConfigDiscovery, false);
  assert.equal(session.enableFileHooks, false);
  assert.equal(session.sessionLimits.maxAiCredits, 30);
  assert.ok(session.systemMessage.content.includes('Any nonempty coverageGaps requires outcome INSUFFICIENT_EVIDENCE'));
  assert.equal((await session.onPermissionRequest()).kind, 'reject');
  assert.equal((await session.onPermissionRequest({ kind: 'custom-tool', toolName: 'read_evidence_window' })).kind, 'approve-once');
  assert.equal((await session.onPermissionRequest({ kind: 'custom-tool', toolName: 'read_evidence_asset' })).kind, 'approve-once');
  assert.equal((await session.onPermissionRequest({ kind: 'custom-tool', toolName: 'read_evidence_asset', managedApprovalRequired: true })).kind, 'reject');
  assert.equal((await session.onPermissionRequest({ kind: 'shell', toolName: 'read_evidence_window' })).kind, 'reject');
  assert.equal((await session.onPermissionRequest({ kind: 'custom-tool', toolName: 'write_file' })).kind, 'reject');
});

const timeline = Array.from({ length: 9 }, (_, index) => ({ eventId: index + 1, kind: 'frame', payload: { order: ['prompt', 'reply'] } }));
test('semantic window planning retains every original event with bounded overlap', () => {
  const evidence = prepareEvidence(timeline, [], { ...profile, windowEvents: 4, overlapEvents: 1 });
  assert.deepEqual(evidence.windows.map(window => window.events.map(event => event.eventId)), [[1, 2, 3, 4], [4, 5, 6, 7], [7, 8, 9]]);
  assert.throws(() => prepareEvidence(timeline.slice(1), [], profile), /INVALID_REVIEW_SEQUENCE/);
  assert.throws(() => prepareEvidence([...timeline, { eventId: 10, kind: 'capture-gap' }], [], profile), /REVIEW_CAPTURE_INCOMPLETE/);
  assert.throws(() => prepareEvidence(timeline, [], { ...profile, maxWindowBytes: 4 }), /CAPACITY_INSUFFICIENT/);
});

test('semantic findings support novel categories but require full coverage and genuine citations', () => {
  const evidence = prepareEvidence(timeline, [], profile);
  const result = { outcome: 'ANOMALIES_FOUND', assessment: 'Unexpected relationship observed.', crossPhaseSynthesis: 'A transient contradiction survives final correction.',
    reviewedWindowIds: ['window-1'], reviewedAssetIds: [], coverageGaps: [], findings: [{ category: 'Previously unenumerated relationship failure',
      observation: 'The result is associated with the wrong request.', expectation: 'Each result belongs to its request.', impact: 'The user may apply the wrong result.', severity: 'critical', evidenceIds: ['event:2'] }] };
  assert.equal(validateSemanticResult(result, evidence).findings[0].category, result.findings[0].category);
  assert.throws(() => validateSemanticResult({ ...result, reviewedWindowIds: [] }, evidence), /TIMELINE_REVIEW_INCOMPLETE/);
  assert.throws(() => validateSemanticResult({ ...result, findings: [{ ...result.findings[0], evidenceIds: ['event:999'] }] }, evidence), /UNGROUNDED/);
  assert.throws(() => validateSemanticResult({ ...result, outcome: 'NO_ANOMALIES_FOUND' }, evidence), /FINDINGS_CANNOT_PASS/);
  assert.throws(() => validateSemanticResult({ ...result, coverageGaps: ['missing phase'] }, evidence), /GAPS_CANNOT_PASS/);
});

test('an unprepared semantic call cannot construct a client or request credentials', async () => {
  let calls = 0;
  await assert.rejects(runSemanticReview({ flow, preparation: { ready: true },
    createClient: () => { calls++; }, getCredential: () => { calls++; } }), /FLOW_PREPARATION_REQUIRED/);
  assert.equal(calls, 0);
});

test('every seed flow has its own explicit preparation gaps and no inherited readiness', async () => {
  const catalog = JSON.parse(readFileSync(new URL('./preparation/catalog.json', import.meta.url)));
  const specification = readFileSync(new URL('../../../documentation/quality-gate/04-task-flow-coverage.md', import.meta.url), 'utf8');
  const seed = specification.match(/## Seed Catalog\r?\n([\s\S]*?)## Required Variants/)[1];
  const seedIds = [...seed.matchAll(/^\| ([A-Z]+-\d{2}) \|/gm)].map(match => match[1]);
  validatePreparationCatalog(catalog);
  assert.equal(seedIds.length, 60);
  assert.deepEqual(catalog.flows.map(item => item.id).sort(), seedIds.sort());
  assert.ok(catalog.flows.every(item => item.missingDetails.length > 0));
  assert.throws(() => validatePreparationCatalog({ ...catalog, flows: [...catalog.flows, catalog.flows[0]] }), /INVALID_PREPARATION_CATALOG/);
  const inventory = await preparationInventory(fileURLToPath(new URL('../../../', import.meta.url)), [flow]);
  assert.equal(inventory.status, 'NOT_READY');
  assert.equal(inventory.readyFlows, 0);
  assert.equal(inventory.requiredFlows, 60);
  assert.ok(inventory.flows.every(item => item.blockers.length > 0));
  assert.ok(inventory.flows.find(item => item.flowId === 'AUTH-01').blockers.some(code => code.startsWith('PACK_DETAIL_REQUIRED:')));
});

async function preparedReview(overrides = {}) {
  const skill = readFileSync(new URL('../../../.github/skills/edd-semantic-review/SKILL.md', import.meta.url), 'utf8');
  const profileBytes = Buffer.from(JSON.stringify({ ...profile, windowEvents: 4, overlapEvents: 1, dispatchOrigins: ['https://model.example.invalid'], ...overrides }));
  const pack = fixture();
  delete pack.attestations;
  pack.semantic.skillSha256 = createHash('sha256').update(skill).digest('hex');
  pack.semantic.agentSha256 = createHash('sha256').update(profileBytes).digest('hex');
  pack.semantic.evidenceLayers = ['timeline', 'artifact'];
  const subject = preparationDigest(pack);
  pack.attestations = fixture().attestations.map(record => ({ ...record, subject, expiresAt: new Date(Date.now() + 60000).toISOString() }));
  const verified = await inspectPreparation({ pack, flow, verifyAttestation: async () => true,
    readArtifact: async path => path === pack.semantic.skillPath ? Buffer.from(skill) : path === pack.semantic.agentPath ? profileBytes : bytes });
  assert.equal(verified.ready, true);
  const events = timeline.map((event, index) => index < flow.requiredPhases.length
    ? { ...event, kind: 'phase', payload: { phase: flow.requiredPhases[index] } } : event);
  const content = Buffer.from('{"observed":"Unexpected output association"}');
  let recordSequence = 0;
  return { flow, preparation: verified.handle, profileBytes, skill, skillDirectory: 'isolated-skills', scratchDirectory: 'isolated-scratch',
    events, assets: [{ id: 'actual-output', mime: 'application/json', bytes: content, sha256: createHash('sha256').update(content).digest('hex'), redactionVerified: true }],
    authorize: async () => true, getCredential: async () => 'offline-unit-test-token',
    reserveRequest: async () => { throw new Error('OFFLINE_TEST_MUST_NOT_DISPATCH'); },
    record: async entry => ({ sequence: ++recordSequence, recordDigest: preparationDigest(entry) }) };
}

function offlineReviewer({ omitAssetRead = false, model = profile.model, usageCopies = 1 } = {}) {
  const calls = { started: 0, stopped: 0, prompts: [], client: null, session: null, sessions: 0, disconnected: 0 };
  let usage;
  return { calls, createClient: options => {
    calls.client = options;
    return {
      start: async () => { calls.started++; }, forceStop: async () => { calls.stopped++; },
      createSession: async configuration => {
        calls.session = configuration;
        return { sessionId: `offline-session-${++calls.sessions}`, disconnect: async () => { calls.disconnected++; },
          on: (_name, handler) => { usage = handler; return () => { usage = null; }; },
          sendAndWait: async ({ prompt }) => {
            const request = JSON.parse(prompt); calls.prompts.push(request);
            for (let index = 0; index < usageCopies; index++) usage({ data: { model, inputTokens: 12, outputTokens: 10, copilotUsage: { totalNanoAiu: 1 } } });
            if (request.stage === 'open-ended-window-review') return { data: { content: JSON.stringify({ windowId: request.window.id,
              observations: ['Review retained with event references'], unresolvedConcerns: [] }) } };
            if (!omitAssetRead) await configuration.tools.find(tool => tool.name === 'read_evidence_asset').handler({ id: 'actual-output' });
            return { data: { content: JSON.stringify({ outcome: 'ANOMALIES_FOUND', assessment: 'Unexpected association failure.',
              crossPhaseSynthesis: 'Earlier output is inconsistent with its later association.', reviewedWindowIds: request.windows,
              reviewedAssetIds: request.assets, coverageGaps: [], findings: [{ category: 'Novel cross-phase association anomaly',
                observation: 'Wrong result association.', expectation: 'Results belong to their input.', impact: 'The user receives a misleading result.',
                severity: 'critical', evidenceIds: ['event:4', 'asset:actual-output'] }] }) } };
          } };
      },
    };
  } };
}

test('offline SDK orchestration reviews all windows, reads assets and synthesizes novel findings', async () => {
  const input = await preparedReview();
  const fake = offlineReviewer();
  const result = await runSemanticReview({ ...input, createClient: fake.createClient });
  assert.equal(result.report.outcome, 'ANOMALIES_FOUND');
  assert.equal(result.windowReviews.length, 3);
  assert.deepEqual(fake.calls.prompts.map(prompt => prompt.stage), [
    'open-ended-window-review', 'open-ended-window-review', 'open-ended-window-review', 'complete-cross-phase-synthesis']);
  assert.ok(fake.calls.prompts.every(prompt => prompt.expectation === 'The complete experience meets the user goal.'));
  assert.equal(result.usage.requests, 4);
  assert.equal(fake.calls.sessions, 4);
  assert.equal(fake.calls.disconnected, 4);
  assert.ok(fake.calls.client.requestHandler);
  assert.equal(result.releaseEligible, false);
  assert.deepEqual(result.inspectedAssets, ['actual-output']);
  assert.equal(fake.calls.client.mode, 'empty');
  assert.equal(fake.calls.client.useLoggedInUser, false);
  assert.equal(fake.calls.stopped, 1);
  const combined = combineEvaluations({ status: 'DIAGNOSTIC_PASS', findings: [] }, result, result);
  assert.equal(combined.status, 'FAIL');
  assert.equal(combined.semanticFindings[0].category, 'Novel cross-phase association anomaly');
  assert.equal(combined.releaseEligible, false);
  result.report.outcome = 'NO_ANOMALIES_FOUND'; result.report.findings = [];
  assert.equal(combineEvaluations({ status: 'DIAGNOSTIC_PASS' }, result, result).status, 'FAIL');
  assert.equal(combineEvaluations({ status: 'DIAGNOSTIC_PASS' }, result, { ...result, evidenceDigest: 'other-trace' }).status, 'INSUFFICIENT_EVIDENCE');
});

test('self-reported asset coverage without tool inspection is rejected and the client stops', async () => {
  const fake = offlineReviewer({ omitAssetRead: true });
  await assert.rejects(runSemanticReview({ ...await preparedReview(), createClient: fake.createClient }), /ASSETS_NOT_INSPECTED/);
  assert.equal(fake.calls.stopped, 1);
});

test('an unconfirmed model stops review rather than silently accepting a fallback', async () => {
  const fake = offlineReviewer({ model: 'unexpected-model' });
  await assert.rejects(runSemanticReview({ ...await preparedReview(), createClient: fake.createClient }), /RESPONSE_UNAVAILABLE/);
  assert.equal(fake.calls.prompts.length, 1);
  assert.ok(fake.calls.stopped >= 1);
});

test('absent required phases deny review before authorization or credentials', async () => {
  const input = await preparedReview();
  let authorityCalls = 0;
  await assert.rejects(runSemanticReview({ ...input, events: timeline,
    authorize: async () => { authorityCalls++; return true; } }), /REQUIRED_PHASE_MISSING/);
  assert.equal(authorityCalls, 0);
});

test('authorization denial cannot construct a client or acquire a credential', async () => {
  const fake = offlineReviewer();
  let credentials = 0;
  await assert.rejects(runSemanticReview({ ...await preparedReview(), createClient: fake.createClient,
    authorize: async () => false, getCredential: async () => { credentials++; return 'offline-unit-test-token'; } }), /NOT_AUTHORIZED/);
  assert.equal(fake.calls.client, null);
  assert.equal(credentials, 0);
});

test('deadline covers credential acquisition and prevents late client startup', async () => {
  const input = await preparedReview({ maxDurationMs: 5 });
  const fake = offlineReviewer();
  let releaseCredential;
  const credential = new Promise(resolve => { releaseCredential = resolve; });
  await assert.rejects(runSemanticReview({ ...input, createClient: fake.createClient, getCredential: () => credential }), /DEADLINE_EXCEEDED/);
  releaseCredential('offline-unit-test-token');
  await Promise.resolve();
  assert.equal(fake.calls.client, null);
});

test('reported usage over the configured request ceiling stops further turns', async () => {
  const fake = offlineReviewer({ usageCopies: 4 });
  await assert.rejects(runSemanticReview({ ...await preparedReview({ maxRequests: 4 }), createClient: fake.createClient }), /RESPONSE_UNAVAILABLE/);
  assert.equal(fake.calls.prompts.length, 2);
  assert.ok(fake.calls.stopped >= 1);
});

test('missing or caller-fabricated semantic approval cannot complete a diagnostic eval', () => {
  const heuristic = { status: 'DIAGNOSTIC_PASS', findings: [] };
  assert.equal(combineEvaluations(heuristic).status, 'INSUFFICIENT_EVIDENCE');
  assert.equal(combineEvaluations(heuristic, { report: { outcome: 'NO_ANOMALIES_FOUND' }, passed: true }).status, 'INSUFFICIENT_EVIDENCE');
  const failed = { status: 'FAIL', findings: [{ code: 'RESPONSE_BEFORE_PROMPT' }] };
  assert.equal(combineEvaluations(failed).status, 'FAIL');
  assert.deepEqual(combineEvaluations(failed).heuristicFindings, failed.findings);
});

test('review capacity must cover the declared capture envelope before admission', async () => {
  const pack = fixture(); delete pack.attestations;
  pack.flowDigest = preparationDigest(sourceFlow);
  const subject = preparationDigest(pack);
  pack.attestations = fixture().attestations.map(record => ({ ...record, subject }));
  const result = await inspectPreparation({ pack, flow: sourceFlow, readArtifact: fixtureArtifact, verifyAttestation: async () => true, now });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('SEMANTIC_CAPTURE_CAPACITY_INSUFFICIENT'));
});

test('the authored public child pack declares every step and heuristic but cannot claim readiness', () => {
  const pack = JSON.parse(readFileSync(new URL('./preparation/AUTH-01.json', import.meta.url)));
  assert.equal(pack.variantId, 'AUTH-01.public-desktop');
  assert.deepEqual(pack.steps.map(step => step.phase), sourceFlow.phases);
  assert.deepEqual(pack.heuristics.map(check => check.id), ['AUTH-H01', 'AUTH-H02', 'AUTH-H03', 'AUTH-H04', 'AUTH-H05', 'AUTH-H06']);
  assert.equal(pack.semantic.required, true);
  assert.equal(pack.semantic.openEnded, true);
  assert.equal(pack.attestations.length, 0);
  assert.ok(pack.unresolved.length >= 7);
  const blockers = validatePreparation(pack, sourceFlow);
  assert.ok(blockers.includes('UNRESOLVED_FLOW_DETAILS'));
  assert.ok(!blockers.some(code => code.startsWith('STEP_') || code.startsWith('CAPTURE_') || code.startsWith('HEURISTIC_')));
});

test('the authored CHAT child covers its exact phases and rules without claiming unresolved readiness', () => {
  const pack = JSON.parse(readFileSync(new URL('./preparation/CHAT-01.json', import.meta.url)));
  const chat = JSON.parse(readFileSync(new URL('./flows.json', import.meta.url))).flows.find(flow => flow.id === 'CHAT-01');
  assert.deepEqual(pack.steps.map(step => step.phase), chat.phases);
  assert.equal(pack.heuristics.length, 7);
  assert.equal(pack.semantic.openEnded, true);
  assert.equal(pack.attestations.length, 0);
  const blockers = validatePreparation(pack, chat);
  assert.ok(blockers.includes('UNRESOLVED_FLOW_DETAILS'));
  assert.ok(!blockers.some(code => code.startsWith('STEP_') || code.startsWith('CAPTURE_') || code.startsWith('HEURISTIC_')));
});

async function evidenceFixture(context, modify = () => {}) {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'watai-evidence-unit-')));
  context.after(() => rm(base, { recursive: true, force: true }));
  const attemptRoot = join(base, 'attempt'); await mkdir(attemptRoot);
  const journal = Buffer.from(timeline.map(event => JSON.stringify(event)).join('\n') + '\n');
  const asset = Buffer.from('Actual output retained for offline unit test.');
  await writeFile(join(attemptRoot, 'events.jsonl'), journal);
  await writeFile(join(attemptRoot, 'output.txt'), asset);
  const descriptor = (path, bytes) => ({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  const manifest = { schemaVersion: 2, runId: 'offline-unit-attempt', flowId: flow.id, preparationDigest: 'a'.repeat(64),
    events: descriptor('events.jsonl', journal), assets: [{ ...descriptor('output.txt', asset), id: 'output', mime: 'text/plain' }] };
  await modify({ base, attemptRoot, manifest });
  manifest.privacy = { subject: preparationDigest(manifest), purpose: 'semantic-llm-review', profileDigest: preparationDigest(profile),
    expiresAt: '2026-09-12T01:00:00Z', issuer: 'offline-test-verifier', signature: 'unit-test-only' };
  const bytes = Buffer.from(JSON.stringify(manifest));
  await writeFile(join(attemptRoot, 'semantic-evidence.json'), bytes);
  return { attemptRoot, manifestSha256: createHash('sha256').update(bytes).digest('hex'), flowId: flow.id,
    preparationDigest: manifest.preparationDigest, profile, now, verifyPrivacy: async () => true };
}

test('evidence reader retains verified original events and actual assets', async context => {
  const evidence = await readReviewEvidence(await evidenceFixture(context));
  assert.deepEqual(evidence.events, timeline);
  assert.equal(evidence.assets[0].bytes.toString('utf8'), 'Actual output retained for offline unit test.');
});

test('evidence content and manifest hash changes cannot reach review', async context => {
  const input = await evidenceFixture(context);
  await assert.rejects(readReviewEvidence({ ...input, manifestSha256: '0'.repeat(64) }), /MANIFEST_CHANGED/);
  await writeFile(join(input.attemptRoot, 'output.txt'), 'Tampered');
  await assert.rejects(readReviewEvidence(input), /CONTENT_CHANGED/);
});

for (const path of ['../outside.txt', 'C:/outside.txt', '/outside.txt', 'output.txt:secret', 'NUL', 'nested\\output.txt', 'alias./output.txt']) {
  test(`evidence path is rejected before privacy approval: ${path}`, async context => {
    const input = await evidenceFixture(context, ({ manifest }) => { manifest.assets[0].path = path; });
    let calls = 0;
    await assert.rejects(readReviewEvidence({ ...input, verifyPrivacy: async () => { calls++; return true; } }), /UNSAFE_EVIDENCE_PATH/);
    assert.equal(calls, 0);
  });
}

test('junction or symlink evidence paths are rejected', async context => {
  const input = await evidenceFixture(context, async ({ base, attemptRoot, manifest }) => {
    const outside = join(base, 'outside'); await mkdir(outside);
    await symlink(outside, join(attemptRoot, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    manifest.assets[0].path = 'escape/output.txt';
  });
  await assert.rejects(readReviewEvidence(input), /EVIDENCE_REPARSE_POINT/);
});

test('oversized evidence is rejected before privacy authority is queried', async context => {
  const input = await evidenceFixture(context, ({ manifest }) => { manifest.assets[0].bytes = profile.maxAssetBytes + 1; });
  let calls = 0;
  await assert.rejects(readReviewEvidence({ ...input, verifyPrivacy: async () => { calls++; return true; } }), /OVERSIZED/);
  assert.equal(calls, 0);
});

test('missing or misbound privacy authority never yields admitted evidence', async context => {
  const input = await evidenceFixture(context);
  await assert.rejects(readReviewEvidence({ ...input, verifyPrivacy: undefined }), /AUTHORITY_REQUIRED/);
  await assert.rejects(readReviewEvidence({ ...input, verifyPrivacy: async () => false }), /PRIVACY_UNVERIFIED/);
  await assert.rejects(readReviewEvidence({ ...input, profile: { ...profile, model: 'other-model' } }), /PRIVACY_UNVERIFIED/);
});

test('review journal is create-only, serialized and retains a durable failure prefix', async context => {
  const input = await evidenceFixture(context);
  const journal = await createReviewJournal({ directory: input.attemptRoot, verifyPrivateDirectory: async () => true });
  context.after(() => journal.close());
  await assert.rejects(createReviewJournal({ directory: input.attemptRoot, verifyPrivateDirectory: async () => true }), /EEXIST/);
  const receipts = await Promise.all([journal.append({ type: 'prepared', payload: { binding: 'example' } }),
    journal.append({ type: 'turn-end', payload: { observation: 'Retained unexpected result', usage: { requests: 1 } } })]);
  assert.deepEqual(receipts.map(receipt => receipt.sequence), [1, 2]);
  await journal.append({ type: 'terminal', payload: { status: 'FAILED', code: 'SECOND_WINDOW_FAILED' } });
  await journal.close();
  const records = readFileSync(journal.path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(records[1].payload.observation, 'Retained unexpected result');
  assert.equal(records[2].payload.status, 'FAILED');
  assert.equal(records[1].previousSha256, receipts[0].sha256);
  await assert.rejects(journal.append({ type: 'prepared', payload: {} }), /JOURNAL_CLOSED/);
});

test('semantic failure retains the first review and sanitized terminal reason in a real journal', async context => {
  const fixture = await evidenceFixture(context);
  const journal = await createReviewJournal({ directory: fixture.attemptRoot, verifyPrivateDirectory: async () => true });
  context.after(() => journal.close());
  const fake = offlineReviewer();
  const createClient = options => {
    const client = fake.createClient(options);
    const createSession = client.createSession;
    let turns = 0;
    client.createSession = async config => {
      const session = await createSession(config);
      const send = session.sendAndWait;
      session.sendAndWait = async request => { if (++turns === 2) throw new Error('Provider failure with sensitive diagnostic details'); return send(request); };
      return session;
    };
    return client;
  };
  await assert.rejects(runSemanticReview({ ...await preparedReview(), record: journal.append, createClient }), /SEMANTIC_REVIEW_FAILED/);
  await journal.close();
  const records = readFileSync(journal.path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(records[0].type, 'prepared');
  assert.ok(records.some(entry => entry.type === 'turn-end' && entry.payload.response.includes('window-1')));
  assert.equal(records.at(-1).payload.code, 'SEMANTIC_REVIEW_FAILED');
  assert.deepEqual(records.at(-1).payload.completedWindows, ['window-1']);
  assert.equal(records.at(-1).payload.usage.requests, 1);
  assert.equal(JSON.stringify(records).includes('sensitive diagnostic details'), false);
});

test('missing or failed durable recording prevents credential and model execution', async () => {
  const input = await preparedReview();
  const fake = offlineReviewer();
  let credentials = 0;
  await assert.rejects(runSemanticReview({ ...input, record: undefined, createClient: fake.createClient }), /DURABLE_RECORDING_REQUIRED/);
  await assert.rejects(runSemanticReview({ ...input, record: async () => { throw new Error('DISK_WRITE_FAILED'); },
    getCredential: async () => { credentials++; return 'offline-token'; }, createClient: fake.createClient }), /DISK_WRITE_FAILED/);
  assert.equal(credentials, 0);
  assert.equal(fake.calls.client, null);
});

test('journal reserves terminal space and rejects secrets and unsafe directories', async context => {
  const fixture = await evidenceFixture(context);
  await assert.rejects(createReviewJournal({ directory: fixture.attemptRoot }), /PRIVATE_REVIEW_DIRECTORY_REQUIRED/);
  const journal = await createReviewJournal({ directory: fixture.attemptRoot, verifyPrivateDirectory: async () => true });
  context.after(() => journal.close());
  await assert.rejects(journal.append({ type: 'turn-end', payload: { text: 'Bearer do-not-record' } }), /UNSAFE_REVIEW_RECORD/);
  await assert.rejects(journal.append({ type: 'turn-end', payload: { text: 'x'.repeat(262144) } }), /REVIEW_JOURNAL_LIMIT/);
  await assert.rejects(journal.append({ type: 'prepared', sequence: 99, payload: {} }), /INVALID_REVIEW_RECORD/);
  await journal.append({ type: 'terminal', payload: { status: 'FAILED', code: 'BOUNDED_STOP' } });
  await journal.close();
  assert.equal(readFileSync(journal.path, 'utf8').includes('do-not-record'), false);
});

test('failed final acknowledgement cannot register a completed semantic review', async () => {
  const input = await preparedReview();
  const fake = offlineReviewer();
  const retained = [];
  let sequence = 0;
  await assert.rejects(runSemanticReview({ ...input, createClient: fake.createClient, record: async entry => {
    if (entry.type === 'terminal' && entry.payload.status === 'COMPLETED') throw new Error('FINAL_FLUSH_FAILED');
    retained.push(structuredClone(entry));
    return { sequence: ++sequence, recordDigest: preparationDigest(entry) };
  } }), /FINAL_FLUSH_FAILED/);
  assert.equal(retained.at(-1).payload.status, 'FAILED');
  assert.equal(retained.at(-1).payload.code, 'FINAL_FLUSH_FAILED');
  assert.ok(fake.calls.stopped >= 1);
});

test('a late prepared-record acknowledgement cannot acquire credentials after deadline', async () => {
  const input = await preparedReview({ maxDurationMs: 5 });
  const fake = offlineReviewer();
  let sequence = 0;
  let credentials = 0;
  await assert.rejects(runSemanticReview({ ...input, createClient: fake.createClient,
    getCredential: async () => { credentials++; return 'offline-token'; }, record: entry => {
      const acknowledge = () => ({ sequence: ++sequence, recordDigest: preparationDigest(entry) });
      return entry.type === 'prepared' ? new Promise(resolve => setTimeout(() => resolve(acknowledge()), 20)) : Promise.resolve(acknowledge());
    } }), /SEMANTIC_DEADLINE_EXCEEDED/);
  assert.equal(credentials, 0);
  assert.equal(fake.calls.client, null);
});

test('metadata channel admits one exact GET and disables redirects without admitting inference', async () => {
  const url = 'https://api.enterprise.githubcopilot.com/models';
  let calls = 0;
  const context = { transport: 'http', signal: new AbortController().signal };
  const guard = createSemanticMetadataGuard({ url, forward: async request => {
    calls++; assert.equal(request.redirect, 'error'); return new Response('{"models":[]}');
  } });
  for (const request of [new Request(url, { method: 'POST', body: '{}' }), new Request(`${url}?extra=1`),
    new Request('https://other.invalid/models'), new Request(url.replace('/models', '/chat/completions'))]) {
    await assert.rejects(guard.sendRequest(request, context), /METADATA_REQUEST_DENIED/);
  }
  await assert.rejects(guard.openWebSocket(), /METADATA_REQUEST_DENIED/);
  assert.equal(calls, 0);
  assert.deepEqual(await (await guard.sendRequest(new Request(url), context)).json(), { models: [] });
  await assert.rejects(guard.sendRequest(new Request(url), context), /METADATA_REQUEST_DENIED/);
  assert.equal(calls, 1);
});

test('metadata channel bounds streamed bytes, redirects and unresponsive transport', async () => {
  const url = 'https://api.enterprise.githubcopilot.com/models';
  const context = { transport: 'http' };
  const oversized = createSemanticMetadataGuard({ url, maxBytes: 2, forward: async () => new Response('123') });
  await assert.rejects(oversized.sendRequest(new Request(url), context), /METADATA_BYTE_LIMIT/);
  const redirected = createSemanticMetadataGuard({ url, forward: async () => Response.redirect(url) });
  await assert.rejects(redirected.sendRequest(new Request(url), context), /METADATA_RESPONSE_DENIED/);
  let signal;
  const stalled = createSemanticMetadataGuard({ url, timeoutMs: 5, forward: (request, options) => {
    signal = options.signal; return new Promise(() => {});
  } });
  await assert.rejects(stalled.sendRequest(new Request(url), context), /METADATA_DEADLINE/);
  assert.equal(signal.aborted, true);
});

test('dispatch guard requires matched reservations and rejects overruns before forwarding', async () => {
  const records = [];
  let forwarded = 0;
  let count = 0;
  const guard = createSemanticDispatchGuard({ profile: { ...profile, maxRequests: 1, maxUsd: 0, dispatchOrigins: ['https://model.example.invalid'] },
    active: () => true, sessionAllowed: id => id === 'session', recordDispatch: async record => records.push(record),
    reserveRequest: async binding => ({ id: `reservation-${++count}`, requestDigest: preparationDigest(binding), expiresAt: new Date(Date.now() + 10000).toISOString(),
      inputTokensUpperBound: 100, outputTokensUpperBound: 20, aiCreditsUpperBound: 0.01, usdUpperBound: 0 }),
    forward: async request => {
      assert.equal(request.redirect, 'error');
      assert.equal(request.headers.get('content-type'), 'application/json');
      assert.deepEqual(await request.json(), { model: profile.model, max_tokens: 20, messages: [] });
      forwarded++; return new Response('offline');
    } });
  const request = () => new Request('https://model.example.invalid/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: profile.model, max_tokens: 20, messages: [] }) });
  const context = { requestId: 'request-1', sessionId: 'session', transport: 'http', signal: new AbortController().signal };
  await guard.sendRequest(request(), context);
  assert.equal(forwarded, 1); assert.equal(records.length, 1);
  await assert.rejects(guard.sendRequest(request(), { ...context, requestId: 'request-2' }), /REQUEST_LIMIT/);
  assert.equal(forwarded, 1);
  await assert.rejects(guard.openWebSocket(context), /WEBSOCKET_NOT_AUTHORIZED/);
});

test('dispatch cannot forward without an explicit output cap or after reservation expiry', async () => {
  let forwarded = 0;
  const guard = createSemanticDispatchGuard({ profile: { ...profile, maxUsd: 0, dispatchOrigins: ['https://model.example.invalid'] },
    active: () => true, sessionAllowed: () => true, recordDispatch: async () => {},
    reserveRequest: async () => ({ id: 'expired', expiresAt: '2000-01-01T00:00:00Z' }), forward: async () => { forwarded++; } });
  const context = { requestId: 'request', sessionId: 'session', transport: 'http', signal: new AbortController().signal };
  const request = value => new Request('https://model.example.invalid/chat/completions', { method: 'POST', redirect: 'error', body: JSON.stringify(value) });
  await assert.rejects(guard.sendRequest(request({ model: profile.model }), context), /OUTPUT_CAP_REQUIRED/);
  await assert.rejects(guard.sendRequest(request({ model: profile.model, max_tokens: 20 }), context), /RESERVATION_UNVERIFIED/);
  assert.equal(forwarded, 0);
});

for (const defect of ['duplicate-reservation', 'input-budget', 'output-budget', 'credit-budget', 'currency-budget', 'journal-failure']) {
  test(`dispatch rejects ${defect} before upstream execution`, async () => {
    let forwarded = 0;
    let count = 0;
    const guard = createSemanticDispatchGuard({ profile: { ...profile, maxUsd: 0, dispatchOrigins: ['https://model.example.invalid'] },
      active: () => true, sessionAllowed: () => true,
      recordDispatch: async () => { if (defect === 'journal-failure') throw new Error('JOURNAL_UNAVAILABLE'); },
      reserveRequest: async binding => ({ id: defect === 'duplicate-reservation' ? 'same' : `reserve-${++count}`,
        requestDigest: preparationDigest(binding), expiresAt: new Date(Date.now() + 10000).toISOString(),
        inputTokensUpperBound: defect === 'input-budget' ? profile.maxInputTokens + 1 : 100,
        outputTokensUpperBound: defect === 'output-budget' ? profile.maxOutputTokens + 1 : 20,
        aiCreditsUpperBound: defect === 'credit-budget' ? profile.maxAiCredits + 1 : 0.01,
        usdUpperBound: defect === 'currency-budget' ? 0.01 : 0 }),
      forward: async () => { forwarded++; return new Response('offline'); } });
    const request = () => new Request('https://model.example.invalid/chat/completions', { method: 'POST', redirect: 'error',
      body: JSON.stringify({ model: profile.model, max_tokens: 20 }) });
    const context = { requestId: 'request', sessionId: 'session', transport: 'http', signal: new AbortController().signal };
    if (defect === 'duplicate-reservation') await guard.sendRequest(request(), context);
    await assert.rejects(guard.sendRequest(request(), context));
    assert.equal(forwarded, defect === 'duplicate-reservation' ? 1 : 0);
  });
}

test('unconfigured dispatch authority blocks before any semantic credentials', async () => {
  const input = await preparedReview();
  let calls = 0;
  await assert.rejects(runSemanticReview({ ...input, reserveRequest: undefined,
    getCredential: async () => { calls++; return 'offline-token'; } }), /DISPATCH_AUTHORITY_REQUIRED/);
  assert.equal(calls, 0);
});

test('semantic calibration packets are deterministic, blinded and never qualify the reviewer', () => {
  const bank = JSON.parse(readFileSync(new URL('./preparation/semantic-calibration.json', import.meta.url)));
  const packets = prepareSemanticCalibration(bank, profile, skillFile);
  assert.equal(packets.length, 6);
  assert.equal(packets.filter(packet => packet.admission === 'PREPARED_ONLY').length, 5);
  assert.equal(packets.filter(packet => packet.admission === 'INSUFFICIENT_EVIDENCE').length, 1);
  assert.deepEqual(packets, prepareSemanticCalibration(bank, profile, skillFile));
  for (const result of packets) {
    assert.equal(result.ready, false);
    assert.equal(result.releaseEligible, false);
    assert.equal('expected' in result.packet, false);
    assert.equal(JSON.stringify(result.packet).includes('private-oracle-'), false);
    assert.equal(result.inputDigest, preparationDigest(result.packet));
    assert.equal(result.profileDigest, preparationDigest(profile));
    assert.match(result.skillSha256, /^[a-f0-9]{64}$/);
  }
  const transient = packets.find(result => result.packet.id === 'c91b0f37-79e0-4ae8-9247-c85a20f53760');
  assert.equal(transient.packet.events[4].payload.nodes.length, 1);
  assert.equal(transient.packet.events[5].payload.nodes.length, 2);
  const missing = packets.find(result => result.admission === 'INSUFFICIENT_EVIDENCE');
  assert.equal(missing.blocker, 'REVIEW_CAPTURE_INCOMPLETE');
});

test('active pilot accounts for exactly five variants and defers unselected families', async () => {
  const pilot = JSON.parse(readFileSync(new URL('./five-flow-pilot.json', import.meta.url)));
  const definitions = JSON.parse(readFileSync(new URL('./flows.json', import.meta.url))).flows;
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const inventory = await preparationInventory(root, definitions, pilot);
  assert.equal(inventory.scope, 'five-flow-pilot');
  assert.equal(inventory.requiredFlows, 5);
  assert.equal(inventory.deferredFlows, 55);
  assert.deepEqual(inventory.flows.map(item => item.flowId), ['AUTH-01', 'CHAT-01', 'CHAT-02', 'CHAT-03', 'CHAT-04']);
  assert.equal(inventory.status, 'NOT_READY');
  assert.equal(inventory.releaseEligible, false);
  await assert.rejects(preparationInventory(root, definitions, { ...pilot, variants: pilot.variants.slice(0, 4) }), /INVALID_FIVE_FLOW_PILOT/);
  await assert.rejects(preparationInventory(root, definitions, { ...pilot, execution: { ...pilot.execution, order: [...pilot.execution.order].reverse() } }), /INVALID_PILOT_DEPENDENCY/);
});

test('additional pilot plans materialize complete phase/check mappings and retain execution blockers', async () => {
  const base = JSON.parse(readFileSync(new URL('./flows.json', import.meta.url))).flows.find(item => item.id === 'CHAT-01');
  for (const { flow } of pilotChatPlans(base)) {
    const pack = JSON.parse(readFileSync(new URL(`./preparation/${flow.id}.json`, import.meta.url)));
    const blockers = validatePreparation(pack, flow);
    assert.deepEqual(blockers, ['UNRESOLVED_FLOW_DETAILS']);
    assert.equal(pack.flowDigest, preparationDigest(flow));
    assert.equal(pack.variantId.startsWith(`${flow.id}.`), true);
    assert.equal(pack.semantic.required, true);
    assert.equal(pack.semantic.openEnded, true);
    assert.equal(pack.attestations.length, 0);
    assert.ok(preflight({ target: targetUrl, liveEnabled: true }, flow, { approvalValid: true }).blockers.includes('PILOT_REAL_SERVICE_CALIBRATION_REQUIRED'));
  }
});

test('lossless review records preserve all transitions, unknown fields, nulls and text history', () => {
  const common = { id: 'prompt', bounds: { x: 10.123456, y: 20, width: 300, height: 50 }, style: { opacity: '1', color: 'rgb(0, 0, 0)' } };
  const text = 'long observed content '.repeat(12);
  const events = [
    { eventId: 1, kind: 'snapshot', payload: { nodes: [common], content: text, unknown: { newValue: null, oldValue: '' } } },
    { eventId: 2, kind: 'frame', observedAtMs: 123.456789, payload: { gapMs: 16.123, visibility: 'visible' } },
    { eventId: 3, kind: 'snapshot', payload: { nodes: [{ ...common, style: { ...common.style, opacity: '0' } }], content: text + 'changed', unexpectedAnomaly: true } },
    { eventId: 4, kind: 'snapshot', payload: { nodes: [common], content: text, unknown: { newValue: null, oldValue: '' } } },
  ];
  const packet = encodeReviewEvidence(events);
  assert.deepEqual(decodeReviewEvidence(packet), events);
  assert.deepEqual(encodeReviewEvidence(events), packet);
  assert.ok(packet.records.some(record => record.type === 'prefix'));
  assert.equal(events[2].payload.nodes[0].style.opacity, '0');
});

test('unique data cannot be assumed to fit a smaller review budget', () => {
  const events = Array.from({ length: 200 }, (_, index) => ({ eventId: index + 1, kind: 'new-observation', payload: {
    unknown: createHash('sha256').update(String(index)).digest('hex').repeat(8),
  } }));
  assert.throws(() => encodeReviewEvidence(events, { maxBytes: 1024 }), /REVIEW_ENCODED_CAPACITY_INSUFFICIENT/);
  const packet = encodeReviewEvidence(events, { maxBytes: 200000 });
  assert.deepEqual(decodeReviewEvidence(packet), events);
  assert.throws(() => decodeReviewEvidence(packet, { maxBytes: 128 }), /REVIEW_DECODED_CAPACITY_INSUFFICIENT/);
});

test('codec rejects forward references, duplicate fields and non-JSON data', () => {
  assert.throws(() => decodeReviewEvidence({ format: 'lossless-json-records-v1', records: [{ type: 'array', values: [{ ref: 0 }] }], root: { ref: 0 } }), /INVALID_REVIEW_CODEC_REFERENCE/);
  assert.throws(() => decodeReviewEvidence({ format: 'lossless-json-records-v1', records: [{ type: 'object', fields: [['same', 1], ['same', 2]] }], root: { ref: 0 } }), /INVALID_REVIEW_CODEC_FIELD/);
  assert.throws(() => encodeReviewEvidence({ invalid: undefined }), /REVIEW_CODEC_REQUIRES_JSON_VALUES/);
});

test('temporal deltas preserve unknown changes, text reversal, order and document boundaries', () => {
  const stable = { bounds: { x: 12.2345, y: 7 }, style: { opacity: '1' }, text: 'baseline '.repeat(40) };
  const events = [
    { eventId: 1, kind: 'snapshot', documentId: 'first', observedAtMs: 1.123, payload: { nodes: [stable], unknown: null } },
    { eventId: 2, kind: 'frame', observedAtMs: 1.567, payload: { gap: 0.444 } },
    { eventId: 3, kind: 'snapshot', documentId: 'first', observedAtMs: 2.25, payload: { nodes: [{ ...stable, style: { opacity: '0' }, text: stable.text + 'new' }], unknown: null } },
    { eventId: 4, kind: 'snapshot', documentId: 'first', observedAtMs: 3, payload: { nodes: [stable], unknown: '' } },
    { eventId: 5, kind: 'snapshot', documentId: 'first', payload: { nodes: [{ id: 'inserted' }, stable], neverSeen: { visible: false } } },
    { eventId: 6, kind: 'snapshot', documentId: 'first', payload: { nodes: [stable, { id: 'inserted' }], neverSeen: { visible: true } } },
    { eventId: 7, kind: 'snapshot', documentId: 'second', payload: { nodes: [], missing: null } },
  ];
  for (const window of [events, events.slice(2, 6)]) {
    const encoded = encodeTimelineWindow(window);
    assert.equal(JSON.stringify(decodeTimelineWindow(encoded)), JSON.stringify(window));
    assert.ok(encoded.records[0].event);
    assert.ok(encoded.records.some(record => record.changes));
  }
  assert.ok(encodeTimelineWindow(events).records[6].event);
  assert.throws(() => encodeTimelineWindow(events, { maxBytes: 30 }), /ENCODED_CAPACITY/);
  assert.throws(() => decodeTimelineWindow(encodeTimelineWindow(events), { maxBytes: 30 }), /DECODED_CAPACITY/);
  assert.throws(() => decodeTimelineWindow({ format: 'lossless-timeline-delta-v1', records: [{ base: 0, changes: [] }] }), /INVALID_TIMELINE_BASE/);
});

test('timeline encoding rejects non-JSON observations and malicious paths without executing getters', () => {
  let getterRead = false;
  const getter = Object.defineProperty({}, 'unsafe', { enumerable: true, get() { getterRead = true; return 'value'; } });
  for (const value of [undefined, () => {}, new Date(), [,,], getter, { [Symbol('hidden')]: true }]) {
    assert.throws(() => encodeTimelineWindow([{ eventId: 1, kind: 'unknown', payload: value }]), /TIMELINE_REQUIRES_JSON/);
  }
  assert.equal(getterRead, false);
  const event = { eventId: 1, kind: 'snapshot', payload: {} };
  assert.throws(() => decodeTimelineWindow({ format: 'lossless-timeline-delta-v1', records: [{ event },
    { base: 0, changes: [['set', ['payload', '__proto__', 'polluted'], true]] }] }), /INVALID_TIMELINE_PATH/);
  assert.equal({}.polluted, undefined);
});

test('bounded timeline windows include every original event and exact independent overlap', () => {
  const events = Array.from({ length: 19 }, (_, index) => ({ eventId: index + 1, kind: 'snapshot',
    payload: { stable: 'unchanged '.repeat(30), unknown: index, visible: index !== 7 } }));
  const plan = planTimelineWindows(events, { windowEvents: 8, overlapEvents: 2, maxWindowBytes: 1200 });
  assert.deepEqual(plan.windows.map(window => [window.firstEvent, window.lastEvent]), [[1,8],[7,14],[13,19]]);
  for (const window of plan.windows) assert.deepEqual(decodeTimelineWindow(window.packet), events.slice(window.firstEvent - 1, window.lastEvent));
  assert.throws(() => planTimelineWindows(events, { windowEvents: 8, overlapEvents: 2, maxWindows: 1 }), /WINDOW_CAPACITY/);
  assert.throws(() => planTimelineWindows(events, { maxInputBytes: 10 }), /TOTAL_CAPACITY/);
  const unique = events.map(event => ({ ...event, payload: { novel: createHash('sha256').update(String(event.eventId)).digest('hex').repeat(30) } }));
  assert.throws(() => planTimelineWindows(unique, { maxWindowBytes: 100 }), /WINDOW_CAPACITY/);
});