import { CopilotClient, CopilotRequestHandler, RuntimeConnection } from '@github/copilot-sdk';
import { ensureRuntimeBundle } from '../node_modules/@github/copilot-sdk/dist/runtimeArtifacts.js';
import { readFile, writeFile, mkdir, open, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildSemanticSession, createSemanticDispatchGuard, createSemanticMetadataGuard, prepareEvidence, validateSemanticResult } from '../tests/e2e/deployed/semantic.mjs';
import { preparationDigest } from '../tests/e2e/deployed/preparation.mjs';
import { encode } from '../api/node_modules/gpt-tokenizer/esm/encoding/o200k_base.js';

process.stderr.write = () => true;
const sessionProbe = process.argv.includes('--session-probe');
const root = fileURLToPath(new URL('../', import.meta.url));
const state = `${root}.harness-state/deployed-eval/`;
const sha = value => createHash('sha256').update(value).digest('hex');
const permitPath = `${state}semantic-roundtrip-decision.json`;
const permit = JSON.parse(await readFile(permitPath, 'utf8'));
const userAuthorization = JSON.parse(await readFile(`${state}poc-user-authorization.json`, 'utf8'));
if (permit.status !== 'APPROVED' || permit.oneShot !== true || Date.parse(permit.expiresAt) <= Date.now() ||
  Date.parse(permit.approvedAt) + permit.ceilings?.wallClockMinutes * 60000 <= Date.now() || permit.commandSha256 !== sha('semantic-synthetic-roundtrip') ||
  userAuthorization.scope !== 'five-flow-poc' || userAuthorization.copilotPaidOverageApproved !== true ||
  userAuthorization.maxCopilotAiCredits !== 100 || permit.ceilings?.aiCredits !== 7 || permit.ceilings?.requests !== 2) throw new Error('CANARY_DECISION_REQUIRED');
await rename(permitPath, `${state}semantic-roundtrip-decision-used-${randomUUID()}.json`);
const directory = `${state}semantic-roundtrip-${randomUUID()}`;
await mkdir(directory);
await mkdir(`${directory}/scratch`);
const journal = await open(`${directory}/events.jsonl`, 'wx', 0o600);
let sequence = 0;
const record = async (type, payload) => {
  await journal.writeFile(`${JSON.stringify({ sequence: ++sequence, type, payload, at: new Date().toISOString() })}\n`);
  await journal.sync();
};
const skill = await readFile(`${root}.github/skills/edd-semantic-review/SKILL.md`, 'utf8');
const sourceProfile = JSON.parse(await readFile(`${root}tests/e2e/deployed/semantic-agent.json`, 'utf8'));
const metadata = JSON.parse(await readFile(`${state}semantic-canary-2f0b8aec-50e5-4049-84a6-23aa24869942/metadata.json`, 'utf8'));
const blind = JSON.parse(await readFile(`${state}semantic-canary-82088c34-d3aa-48c9-a7b5-a01b6c060af0/blind-inputs.json`, 'utf8'));
const selected = blind.packets[0];
if (selected.skillSha256 !== sha(skill) || selected.inputDigest !== preparationDigest(selected.packet) || metadata.model.id !== sourceProfile.model ||
    metadata.model.policy !== 'enabled') throw new Error('CANARY_BINDING_CHANGED');
const prices = metadata.model.billing.tokenPrices;
if (prices.inputPrice !== 250 || prices.outputPrice !== 1500 || prices.batchSize !== 1000000) throw new Error('CANARY_PRICING_CHANGED');
const profile = { ...sourceProfile, maxRequests: 2, maxInputTokens: 16000, maxOutputTokens: 2000, maxAiCredits: 7, maxUsd: 0,
  dispatchOrigins: ['https://api.enterprise.githubcopilot.com', 'https://api.githubcopilot.com'], maxInputBytes: 32000 };
const evidence = prepareEvidence(selected.packet.events, [], profile);
const allowedSessions = new Set();
const dispatchedSessions = new Set();
let active = true;
let client;
let quotaSafe = false;
let currentSession;
let calls = 0;
let result;
let stage = 'startup';
const usage = [];
let usageFailed = false;
const metadataGuard = createSemanticMetadataGuard({ url: 'https://api.enterprise.githubcopilot.com/models' });
let runtimeMetadata;
const tokenBounds = new Map();
const dispatch = createSemanticDispatchGuard({ profile, active: () => active && quotaSafe,
  sessionAllowed: id => allowedSessions.has(id),
  reserveRequest: async binding => {
    const inputTokensUpperBound = tokenBounds.get(binding.bodySha256);
    const aiCreditsUpperBound = (inputTokensUpperBound * prices.inputPrice + binding.outputLimit * prices.outputPrice) / prices.batchSize;
    if (!Number.isSafeInteger(inputTokensUpperBound) || inputTokensUpperBound > 8000 || aiCreditsUpperBound > 3.5) throw new Error('CANARY_INPUT_RESERVATION_EXCEEDED');
    return { id: randomUUID(), requestDigest: preparationDigest(binding), expiresAt: new Date(Date.now() + 10000).toISOString(),
      inputTokensUpperBound, outputTokensUpperBound: binding.outputLimit, aiCreditsUpperBound, usdUpperBound: 0 };
  }, recordDispatch: async binding => record('dispatch', binding) });
class CanaryTransport extends CopilotRequestHandler {
  async sendRequest(request, context) {
    const url = new URL(request.url);
    await record('route', { method: request.method, origin: url.origin, path: /^\/[a-z0-9/_-]{0,80}$/i.test(url.pathname) ? url.pathname : 'REDACTED' });
    if (sessionProbe) throw new Error('SESSION_PROBE_FORBIDS_INFERENCE');
    if (request.method === 'GET' && request.url === 'https://api.enterprise.githubcopilot.com/models') {
      runtimeMetadata ??= metadataGuard.sendRequest(request, context);
      return (await runtimeMetadata).clone();
    }
    if (!quotaSafe || request.method !== 'POST' || !profile.dispatchOrigins.includes(url.origin) || !allowedSessions.has(context.sessionId) ||
        dispatchedSessions.has(context.sessionId) || calls >= 2) throw new Error('CANARY_DISPATCH_DENIED');
    const body = await request.clone().text();
    if (Buffer.byteLength(body) > 32000) throw new Error('CANARY_BODY_LIMIT');
    const value = JSON.parse(body);
    const field = url.pathname === '/responses' && Array.isArray(value.input) ? 'max_output_tokens' :
      url.pathname === '/chat/completions' && Array.isArray(value.messages) ?
        (Object.hasOwn(value, 'max_completion_tokens') ? 'max_completion_tokens' : 'max_tokens') : null;
    await record('shape', { bytes: Buffer.byteLength(body), fields: Object.keys(value), sessionCorrelated: allowedSessions.has(context.sessionId), outputField: field,
      outputLimit: field ? value[field] ?? null : null });
    if (field !== 'max_output_tokens' || value.model !== profile.model || typeof value.instructions !== 'string' ||
        value.input.some(item => !['message', undefined].includes(item.type) ||
          !(typeof item.content === 'string' || Array.isArray(item.content) && item.content.every(part => part.type === 'input_text' && typeof part.text === 'string')))) throw new Error('CANARY_SCHEMA_UNVERIFIED');
    value.max_output_tokens = 1000;
    value.reasoning = { ...value.reasoning, effort: 'low' };
    const boundedBody = JSON.stringify(value);
    const inputTokensUpperBound = encode(boundedBody).length + 2048;
    tokenBounds.set(sha(boundedBody), inputTokensUpperBound);
    await record('token-bound', { tokenizer: 'o200k_base', inputTokensUpperBound, framingReserve: 2048, outputCap: 1000 });
    calls++; dispatchedSessions.add(context.sessionId);
    const headers = new Headers(request.headers); headers.delete('content-length');
    const bounded = new Request(request.url, { method: 'POST', headers, body: boundedBody, redirect: 'error', signal: context.signal });
    return dispatch.sendRequest(bounded, context);
  }
  async openWebSocket() { throw new Error('CANARY_WEBSOCKET_DENIED'); }
}
const tools = profile.tools.map(name => ({ name, description: name === 'read_evidence_window' ? 'Read the original synthetic evidence window.' : 'No assets exist for this synthetic canary.',
  parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  handler: async args => {
    if (name !== 'read_evidence_window' || args.id !== evidence.windows[0].id) throw new Error('UNKNOWN_EVIDENCE');
    await record('tool', { name, id: args.id }); return structuredClone(evidence.windows[0]);
  } }));
const config = buildSemanticSession({ profile: { ...profile, maxAiCredits: 3.5 }, skill,
  skillDirectory: `${root}.github/skills`, scratchDirectory: `${directory}/scratch`, tools });
const send = async prompt => {
  await record('turn-start', { prompt });
  stage = 'create-session';
  currentSession = await client.createSession(config);
  allowedSessions.add(currentSession.sessionId);
  const off = currentSession.on('assistant.usage', event => {
    const data = event.data;
    if (data.model !== profile.model || ![data.inputTokens, data.outputTokens, data.copilotUsage?.totalNanoAiu].every(value => Number.isFinite(value) && value >= 0)) usageFailed = true;
    usage.push({ model: data.model, inputTokens: data.inputTokens, outputTokens: data.outputTokens, nanoAiu: data.copilotUsage?.totalNanoAiu });
  });
  try {
    stage = 'send-review';
    const answer = await currentSession.sendAndWait({ prompt }, 45000);
    if (!answer?.data?.content) throw new Error('CANARY_RESPONSE_MISSING');
    await record('turn-end', { response: answer.data.content, usage });
    if (usageFailed || usage.length !== calls || usage.reduce((sum, item) => sum + item.nanoAiu, 0) > 7e9) throw new Error('CANARY_USAGE_UNCONFIRMED');
    return JSON.parse(answer.data.content);
  } finally {
    allowedSessions.delete(currentSession.sessionId); off(); await currentSession.disconnect(); currentSession = undefined;
  }
};
let timer;
try {
  await record('prepared', { evidenceClass: 'synthetic-semantic-calibration', input: selected, profile, skillSha256: sha(skill), calibrationPassed: false });
  const installed = JSON.parse(await readFile(`${root}node_modules/@github/copilot-sdk/package.json`, 'utf8'));
  const runtime = await ensureRuntimeBundle(installed.copilotCliVersion);
  client = new CopilotClient({ connection: RuntimeConnection.forStdio({ path: runtime }), mode: 'copilot-cli', useLoggedInUser: true,
    logLevel: 'error', requestHandler: new CanaryTransport(), onListModels: () => [metadata.model] });
  timer = setTimeout(() => { active = false; void client?.forceStop().catch(() => {}); }, 110000);
  await client.start();
  const quota = await client.rpc.account.getQuota({});
  const premium = quota.quotaSnapshots?.premium_interactions;
  const paidOverageDisabled = premium?.overageAllowedWithExhaustedQuota === false;
  quotaSafe = paidOverageDisabled || userAuthorization.copilotPaidOverageApproved === true;
  await record('quota', { paidOverageDisabled, quotaKnown: Boolean(premium),
    paidOverageAuthorized: userAuthorization.copilotPaidOverageApproved, allowanceCredits: 7,
    authorizationSha256: preparationDigest(userAuthorization) });
  if (!quotaSafe) throw new Error('CANARY_ADDITIONAL_CHARGE_NOT_EXCLUDED');
  if (sessionProbe) {
    stage = 'create-session';
    currentSession = await client.createSession(config);
    await currentSession.disconnect(); currentSession = undefined;
    throw new Error('SESSION_PROBE_COMPLETED_NO_INFERENCE');
  }
  const note = await send(JSON.stringify({ stage: 'open-ended-window-review', expectation: selected.packet.expectation,
    context: selected.packet.context, scope: selected.packet.scope, window: evidence.windows[0], assets: [],
    instruction: 'Review every event for any unexpected anomaly. Return JSON {windowId, observations, unresolvedConcerns}; cite events. No real-paint claim. Maximum180words.' }));
  if (note.windowId !== evidence.windows[0].id || !Array.isArray(note.observations) || !Array.isArray(note.unresolvedConcerns)) throw new Error('CANARY_WINDOW_INVALID');
  const report = await send(JSON.stringify({ stage: 'complete-cross-phase-synthesis', expectation: selected.packet.expectation,
    context: selected.packet.context, scope: selected.packet.scope, originalWindow: evidence.windows[0], windowReviews: [note], assets: [],
    instruction: 'Perform separate synthesis across all events. Return JSON outcome,assessment,crossPhaseSynthesis,reviewedWindowIds,reviewedAssetIds,coverageGaps,findings[{category,observation,expectation,impact,severity,evidenceIds}]. Cite event:<id>. Maximum180words.' }));
  result = { status: 'SYNTHETIC_ROUNDTRIP_COMPLETED', report: validateSemanticResult(report, evidence), usage, calibrationPassed: false, releaseEligible: false };
} catch (error) {
  const detail = String(error?.message ?? '').replace(/Bearer\s+\S+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:password|secret|(?:api[_-]?key)|(?:access|refresh|github)[_-]?token)\s*["']?\s*[:=]\s*[^\s,}]+/gi, '[REDACTED]').slice(0, 1000);
  result = { status: 'SYNTHETIC_ROUNDTRIP_BLOCKED', code: /^[A-Z_]{3,100}$/.test(error?.message ?? '') ? error.message : 'SDK_OPERATION_FAILED',
    stage, detail, reservedAttempts: calls, usage, calibrationPassed: false, releaseEligible: false };
} finally {
  active = false; clearTimeout(timer); await client?.forceStop().catch(() => {});
  await record('terminal', result); await journal.close();
}
await writeFile(`${directory}/result.json`, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ ...result, evidenceDirectory: directory }, null, 2));