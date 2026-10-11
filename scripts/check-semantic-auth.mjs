import { CopilotClient, CopilotRequestHandler, RuntimeConnection } from '@github/copilot-sdk';
import { ensureRuntimeBundle } from '../node_modules/@github/copilot-sdk/dist/runtimeArtifacts.js';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

process.stderr.write = () => true;
const state = fileURLToPath(new URL('../.harness-state/deployed-eval/', import.meta.url));
const permitPath = `${state}sdk-auth-decision.json`;
const permit = JSON.parse(await readFile(permitPath, 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
if (permit.status !== 'APPROVED' || permit.oneShot !== true || Date.parse(permit.expiresAt) <= Date.now() ||
    permit.commandSha256 !== digest('semantic-sdk-auth-status-only')) throw new Error('SDK_AUTH_DECISION_REQUIRED');
await rename(permitPath, `${state}sdk-auth-decision-used-${randomUUID()}.json`);
const metadata = JSON.parse(await readFile(new URL('../node_modules/@github/copilot-sdk/package.json', import.meta.url), 'utf8'));
let modelAttempts = 0;
class DenyInference extends CopilotRequestHandler {
  async sendRequest() { modelAttempts++; throw new Error('INFERENCE_FORBIDDEN_DURING_AUTH_CHECK'); }
  async openWebSocket() { modelAttempts++; throw new Error('INFERENCE_FORBIDDEN_DURING_AUTH_CHECK'); }
}
let client;
let result;
try {
  const runtime = await ensureRuntimeBundle(metadata.copilotCliVersion);
  client = new CopilotClient({ connection: RuntimeConnection.forStdio({ path: runtime }), mode: 'copilot-cli',
    useLoggedInUser: true, requestHandler: new DenyInference(), logLevel: 'error' });
  await client.start();
  const auth = await client.getAuthStatus();
  result = { status: auth.isAuthenticated === true && modelAttempts === 0 ? 'AUTHENTICATED' : 'UNAVAILABLE',
    isAuthenticated: auth.isAuthenticated === true, authType: typeof auth.authType === 'string' && /^[a-zA-Z_-]{1,40}$/.test(auth.authType) ? auth.authType : null,
    runtimeVersion: metadata.copilotCliVersion, modelAttempts, sessionsCreated: 0, observedAt: new Date().toISOString() };
} catch {
  result = { status: 'SDK_AUTH_CHECK_BLOCKED', isAuthenticated: false, runtimeVersion: metadata.copilotCliVersion,
    modelAttempts, sessionsCreated: 0, observedAt: new Date().toISOString() };
} finally { await client?.forceStop().catch(() => {}); }
await writeFile(`${state}sdk-auth-status-${randomUUID()}.json`, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(result, null, 2));