import { CopilotClient, CopilotRequestHandler, RuntimeConnection } from '@github/copilot-sdk';
import { ensureRuntimeBundle } from '../node_modules/@github/copilot-sdk/dist/runtimeArtifacts.js';
import { readFile, writeFile, mkdir, rename, readdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prepareSemanticCalibration, createSemanticMetadataGuard } from '../tests/e2e/deployed/semantic.mjs';

process.stderr.write = () => true;
const state = fileURLToPath(new URL('../.harness-state/deployed-eval/', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const metadataOnly = process.argv.includes('--metadata');
let permitPath = `${state}semantic-canary-decision.json`;
if (metadataOnly) {
  const candidates = await Promise.all((await readdir(state)).filter(name => /^semantic-canary-decision-used-.*\.json$/.test(name))
    .map(async name => ({ path: `${state}${name}`, value: JSON.parse(await readFile(`${state}${name}`, 'utf8')) })));
  const matching = candidates.filter(item => item.value.decisionId === '1e78072b-4ce8-40c2-9cfc-764b13403f15');
  if (matching.length !== 1) throw new Error('METADATA_STAGE_REQUIRED');
  permitPath = matching[0].path;
}
const permit = JSON.parse(await readFile(permitPath, 'utf8'));
if (permit.status !== 'APPROVED' || permit.oneShot !== true || Date.parse(permit.expiresAt) <= Date.now() ||
    Date.parse(permit.approvedAt) + 300000 <= Date.now() ||
    permit.commandSha256 !== digest('semantic-metadata-route-diagnostic')) throw new Error('SEMANTIC_CANARY_DECISION_REQUIRED');
if (metadataOnly) await writeFile(`${state}metadata-forward-reservation-${permit.decisionId}.json`, JSON.stringify({
  decisionId: permit.decisionId, reservedAt: new Date().toISOString(), maxRequests: 1, maxAiCredits: 0,
}), { flag: 'wx', mode: 0o600 });
else await rename(permitPath, `${state}semantic-canary-decision-used-${randomUUID()}.json`);
const profile = JSON.parse(await readFile(new URL('../tests/e2e/deployed/semantic-agent.json', import.meta.url), 'utf8'));
const bank = JSON.parse(await readFile(new URL('../tests/e2e/deployed/preparation/semantic-calibration.json', import.meta.url), 'utf8'));
const skill = await readFile(new URL('../.github/skills/edd-semantic-review/SKILL.md', import.meta.url), 'utf8');
const packets = prepareSemanticCalibration(bank, profile, skill);
const directory = `${state}semantic-canary-${randomUUID()}`;
await mkdir(directory);
await writeFile(`${directory}/blind-inputs.json`, JSON.stringify({ packets: packets.map(({ packet, inputDigest, profileDigest, skillSha256 }) =>
  ({ packet, inputDigest, profileDigest, skillSha256 })) }, null, 2), { flag: 'wx', mode: 0o600 });
let client;
let result;
const deniedRequests = [];
let forwardedRequests = 0;
class DenyInference extends CopilotRequestHandler {
  async sendRequest(request) {
    if (deniedRequests.length) throw new Error('NETWORK_NOT_ADMITTED');
    const url = new URL(request.url);
    deniedRequests.push({ transport: 'http', method: request.method, origin: url.origin,
      path: /^\/[a-z0-9/_-]{0,100}$/i.test(url.pathname) ? url.pathname : 'REDACTED' });
    void client?.forceStop().catch(() => {});
    throw new Error('NETWORK_NOT_ADMITTED');
  }
  async openWebSocket() { deniedRequests.push({ transport: 'websocket' }); throw new Error('NETWORK_NOT_ADMITTED'); }
}
try {
  const metadata = JSON.parse(await readFile(new URL('../node_modules/@github/copilot-sdk/package.json', import.meta.url), 'utf8'));
  const runtime = await ensureRuntimeBundle(metadata.copilotCliVersion);
  let handler = new DenyInference();
  if (metadataOnly) {
    const observed = JSON.parse(await readFile(`${state}semantic-canary-8756e6d6-6be4-48b8-9be8-760aa3af7564/metadata.json`, 'utf8'));
    const route = observed.deniedRequests?.[0];
    if (observed.status !== 'DENIED_ROUTE_OBSERVED' || observed.forwardedRequests !== 0 || route?.method !== 'GET' ||
        route.origin !== 'https://api.enterprise.githubcopilot.com' || route.path !== '/models') throw new Error('METADATA_ROUTE_UNVERIFIED');
    handler = createSemanticMetadataGuard({ url: `${route.origin}${route.path}`, forward: async (request, options) => {
      forwardedRequests++; return fetch(request, options);
    } });
  }
  client = new CopilotClient({ connection: RuntimeConnection.forStdio({ path: runtime }), mode: 'copilot-cli', useLoggedInUser: true,
    logLevel: 'error', requestHandler: handler });
  await client.start();
  const models = await client.listModels();
  const model = models.find(model => model.id === profile.model);
  result = { status: model ? 'MODEL_METADATA_AVAILABLE' : 'CONFIGURED_MODEL_UNAVAILABLE', model: model ? {
    id: model.id, capabilities: model.capabilities, policy: model.policy?.state ?? null, billing: model.billing ?? null,
  } : null, runtimeVersion: metadata.copilotCliVersion, deniedRequests, forwardedRequests, sessionsCreated: 0,
    blindInputs: `${directory}/blind-inputs.json`, observedAt: new Date().toISOString(), calibrationPassed: false };
} catch {
  result = { status: deniedRequests.length ? 'DENIED_ROUTE_OBSERVED' : 'MODEL_METADATA_UNAVAILABLE', deniedRequests, forwardedRequests, sessionsCreated: 0,
    blindInputs: `${directory}/blind-inputs.json`, calibrationPassed: false };
} finally { await client?.forceStop().catch(() => {}); }
await writeFile(`${directory}/metadata.json`, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(result, null, 2));