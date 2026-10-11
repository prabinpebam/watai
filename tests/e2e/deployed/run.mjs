import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir, stat, rename, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readPreparation, preparationInventory, preparationDigest, preparedActionSteps } from './preparation.mjs';
import { buildCaptureRuntime } from './capture-bootstrap.mjs';
import { observeChatHttp } from './chat-http.mjs';
import { pilotChatPlans } from './pilot-chat-plans.mjs';
import { createPilotMonitor, drivePilotChat } from './pilot-chat-driver.mjs';
import { createCapturePolicy, createPhaseBudget, budgetViolation, digest, preflight, evaluatePreparedHeuristics, replay, safeLocation, targetUrl,
  validateExistingBrowserReceipt, attachExistingBrowser, closeOwnedBrowserResources, pilotWorkCommand, runPilotOnce } from './core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const state = resolve(root, '.harness-state/deployed-eval');
const results = resolve(root, 'test-results/deployed-eval');
const definitions = JSON.parse(await readFile(new URL('./flows.json', import.meta.url), 'utf8'));
const additionalPlans = pilotChatPlans(definitions.flows.find(flow => flow.id === 'CHAT-01'));
definitions.flows.push(...additionalPlans.map(plan => plan.flow));
const pilot = JSON.parse(await readFile(new URL('./five-flow-pilot.json', import.meta.url), 'utf8'));
const command = process.argv[2] ?? 'preflight';
const configPath = resolve(state, 'config.json');
const defaultConfig = { target: targetUrl, liveEnabled: false, authStateFile: null,
  useExistingBrowser: true,
  dedicatedAccountAcknowledged: false, expectedTestEmailSha256: null,
  maxRunSubmissions: 0, providerBudgetVerified: false };
let attachedTransportUsed = false;

async function initialize() {
  await mkdir(state, { recursive: true });
  try { await writeFile(configPath, JSON.stringify(defaultConfig, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
async function config() {
  if (!(await stat(configPath).catch(() => null))) return defaultConfig;
  return JSON.parse(await readFile(configPath, 'utf8'));
}
async function existingBrowserReceipt() {
  try { return validateExistingBrowserReceipt(JSON.parse((await readFile(resolve(state, 'fresh-edge-launch.json'), 'utf8')).replace(/^\uFEFF/, ''))); }
  catch { return null; }
}
function verifyExistingProcess(receipt) {
  if (process.platform !== 'win32') return false;
  const script = "$ErrorActionPreference='Stop'; $browser=Get-Process -Id ([int]$env:WATAI_EDGE_PID); if($browser.ProcessName -ne 'msedge' -or $browser.StartTime.ToUniversalTime().ToString('o') -ne $env:WATAI_EDGE_STARTED){exit 2}; $listeners=@(Get-NetTCPConnection -State Listen | Where-Object {$_.LocalPort -eq 9222}); if(-not $listeners.Count){exit 3}; foreach($listener in $listeners){if($listener.OwningProcess -ne $browser.Id -or $listener.LocalAddress -notin @('127.0.0.1','::1')){exit 4}}; $native=Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $browser.Id); if(-not $native.CommandLine.Contains($env:WATAI_EDGE_PROFILE)){exit 5}; 'verified'";
  try {
    return execFileSync(resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, encoding: 'utf8', timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WATAI_EDGE_PID: String(receipt.processId),
          WATAI_EDGE_STARTED: receipt.processStartedAt, WATAI_EDGE_PROFILE: receipt.userDataDirectory } }).trim() === 'verified';
  } catch { return false; }
}
async function approval(flow) {
  const path = resolve(state, `${flow.mode}-decision.json`);
  const permit = JSON.parse(await readFile(path, 'utf8').catch(() => '{}'));
  const valid = permit.status === 'APPROVED' && permit.oneShot === true &&
    Date.parse(permit.approvedAt) <= Date.now() && Date.parse(permit.expiresAt) > Date.now() &&
    permit.commandSha256 === digest(`deployed-eval-${flow.mode}-${flow.id}`);
  return { valid, path, permit };
}
async function inspect(settings, flow, programDecision) {
  const decision = programDecision ?? await approval(flow);
  const preparation = await readPreparation(root, flow);
  const receipt = flow.mode === 'authenticated' ? await existingBrowserReceipt() : null;
  const status = preflight(settings, flow, { existingBrowserVerified: Boolean(receipt),
    approvalValid: decision.valid && Date.parse(decision.permit.expiresAt) > Date.now() &&
      (!programDecision || programDecision.deadline > Date.now()), preparation: preparation.handle });
  status.blockers.push(...preparation.blockers);
  if (flow.mode === 'public' && !existsSync(chromium.executablePath())) status.blockers.push('INSTALLED_CHROMIUM_REQUIRED');
  if (flow.mode === 'authenticated' && !/^[a-f0-9]{64}$/.test(settings.expectedTestEmailSha256 ?? '')) status.blockers.push('EXPECTED_TEST_EMAIL_HASH_REQUIRED');
  status.ready = status.blockers.length === 0;
  return Object.defineProperty({ ...status, flowId: flow.id, planSha256: digest(JSON.stringify(flow)), configPath,
    preparationDetails: preparation.unresolved ?? [],
    evidenceClass: 'real-deployed-diagnostic', limitations: flow.unqualified }, 'preparedHandle', { value: preparation.handle });
}
async function run(flow, settings, programDecision) {
  const status = await inspect(settings, flow, programDecision);
  if (!status.ready) { console.log(JSON.stringify({ status: 'BLOCKED', ...status }, null, 2)); return { status: 'BLOCKED' }; }
  const phaseBudget = createPhaseBudget(preparedActionSteps(status.preparedHandle, flow));
  const captureRuntime = await buildCaptureRuntime();
  const decision = programDecision ?? await approval(flow);
  if (!programDecision) await rename(decision.path, resolve(state, `${flow.mode}-decision-used-${randomUUID()}.json`));
  const runId = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`;
  const directory = resolve(results, runId);
  await mkdir(directory, { recursive: true });
  const events = [];
  const monitor = createPilotMonitor({ stopOnViolation: (code, event) => {
    emit({ kind: 'observed-product-failure', payload: { code, sourceEventId: event.eventId } });
    policyStop(code);
  } });
  let writes = Promise.resolve();
  let writerError = false;
  let eventBytes = 0;
  let accepting = true;
  let captureStatusQueue = Promise.resolve();
  const emit = event => {
    if (!accepting) return;
    const entry = { ...event, eventId: events.length + 1, receivedAt: new Date().toISOString() };
    const line = JSON.stringify(entry) + '\n';
    eventBytes += Buffer.byteLength(line);
    if (budgetViolation(flow, { eventBytes })) {
      accepting = false; writerError = true;
      const gap = { eventId: entry.eventId, kind: 'capture-gap', payload: { code: 'RUNNER_EVIDENCE_LIMIT' } };
      events.push(gap);
      writes = writes.then(() => appendFile(resolve(directory, 'events.jsonl'), JSON.stringify(gap) + '\n'));
      policyStop('RUNNER_EVIDENCE_LIMIT');
      return;
    }
    events.push(entry);
    writes = writes.then(() => appendFile(resolve(directory, 'events.jsonl'), line)).catch(() => { writerError = true; });
    capturePolicy.observe(entry);
    monitor.observe(entry);
    if (entry.kind === 'run-status' && page && !page.isClosed()) {
      captureStatusQueue = captureStatusQueue.then(() => page.evaluate(payload => window.__wataiEvalCapture.observeRunState(payload), entry.payload))
        .catch(() => { policyStop('RUN_STATUS_CAPTURE_BOUNDARY_FAILED'); });
      pendingResponses.add(captureStatusQueue);
      const current = captureStatusQueue; void current.finally(() => pendingResponses.delete(current));
    }
  };
  let currentPhase = null;
  let phaseDeadline;
  const phase = name => {
    capturePolicy.assertActive(); if (stoppedByPolicy) throw new Error('FLOW_POLICY_STOPPED');
    const remaining = phaseBudget.enter(name);
    clearTimeout(phaseDeadline); phaseDeadline = setTimeout(() => policyStop('PHASE_DEADLINE_EXCEEDED'), remaining);
    page?.setDefaultTimeout(Math.min(15000, remaining));
    currentPhase = name; emit({ kind: 'phase', payload: { phase: name } });
  };
  const metadata = { runId, flowId: flow.id, planSha256: status.planSha256, target: targetUrl,
    flowDefinition: structuredClone(flow),
    evidenceClass: 'real-deployed-diagnostic', startedAt: new Date().toISOString(), releaseEligible: false,
    recorderSha256: digest(await readFile(new URL('./capture.mjs', import.meta.url))),
    recorderBundleSha256: digest(captureRuntime),
    evaluatorSha256: digest(await readFile(new URL('./core.mjs', import.meta.url))),
    driverSha256: digest(await readFile(new URL('./run.mjs', import.meta.url))),
    browserVersion: null, accountAlias: flow.mode === 'public' ? 'signed-out-fresh-context' : 'dedicated-test-account',
    knownGaps: flow.unqualified, artifactIdentities: [] };
  let browser;
  let context;
  let page;
  let cdp;
  const ownsResources = flow.mode === 'public';
  const disposables = [];
  const listeners = [];
  let deadline;
  let chatHttp;
  let requests = 0;
  let networkBytes = 0;
  let submitted = 0;
  let verifiedAccount = false;
  const pendingResponses = new Set();
  let stoppedByPolicy = false;
  const policyStop = code => {
    if (stoppedByPolicy) return;
    stoppedByPolicy = true;
    emit({ kind: 'policy-stop', payload: { code } });
    if (ownsResources) void context?.close().catch(() => {});
  };
  const capturePolicy = createCapturePolicy(policyStop);
  const screenshot = async name => {
    capturePolicy.assertActive();
    if (stoppedByPolicy) throw new Error('FLOW_POLICY_STOPPED');
    phaseBudget.remaining(flow.deadlineMs);
    if (new URL(page.url()).origin !== new URL(targetUrl).origin ||
        await page.locator('input[type=password], [autocomplete=current-password], [autocomplete=new-password]').count() ||
        (flow.mode === 'public' && await page.locator('[data-message-id], .chat__column').count()) ||
        (flow.mode === 'authenticated' && !verifiedAccount)) throw new Error('SCREENSHOT_PRIVACY_PRECONDITION_FAILED');
    const before = await page.evaluate(() => window.__wataiEvalCapture?.checkpoint());
    if (!before?.snapshotSequence) throw new Error('SCREENSHOT_CHECKPOINT_REQUIRED');
    const content = await page.screenshot({ path: resolve(directory, name) });
    const after = await page.evaluate(() => window.__wataiEvalCapture?.checkpoint());
    if (!after || before.documentId !== after.documentId || before.sequence > after.sequence) throw new Error('SCREENSHOT_DOCUMENT_CHANGED');
    if (budgetViolation(flow, { artifactBytes: content.length })) throw new Error('SCREENSHOT_BYTE_LIMIT');
    emit({ kind: 'screenshot', payload: { id: name, sha256: digest(content), bytes: content.length, before, after,
      correspondence: before.snapshotSequence === after.snapshotSequence ? 'unchanged-semantic-state-during-capture' : 'state-changed-during-capture' } });
  };
  try {
    if (ownsResources) {
      browser = await chromium.launch({ headless: true, timeout: 15000 });
      context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
      page = await context.newPage();
    } else {
      const attached = await attachExistingBrowser({ receipt: await existingBrowserReceipt(),
        assertReady: async () => {
          const current = await readPreparation(root, flow);
          if (!current.ready || current.packDigest !== status.preparedHandle.packDigest ||
              Date.parse(decision.permit.expiresAt) <= Date.now() || digest(JSON.stringify(await config())) !== digest(JSON.stringify(settings))) {
            throw new Error('FLOW_PREPARATION_CHANGED');
          }
        },
        verifyProcess: verifyExistingProcess,
        connect: async (...args) => { attachedTransportUsed = true; return chromium.connectOverCDP(...args); } });
      ({ browser, context, page } = attached);
      metadata.browserOwnership = 'borrowed-existing-page';
    }
    metadata.browserVersion = browser.version();
    deadline = setTimeout(() => policyStop('FLOW_DEADLINE_EXCEEDED'),
      programDecision ? Math.min(flow.deadlineMs, Math.max(0, programDecision.deadline - Date.now())) : flow.deadlineMs);
    disposables.push(await page.exposeBinding('__wataiEvidence', (_source, batch) => {
      if (!Array.isArray(batch)) { policyStop('INVALID_CAPTURE_BATCH'); return; }
      for (const event of batch) {
        emit(event);
        const violation = budgetViolation(flow, { eventKind: event.kind });
        if (violation) { policyStop(violation); break; }
      }
    }));
    disposables.push(await page.addInitScript({ content: `${captureRuntime}\nWataiCaptureRuntime.install(${JSON.stringify({ ...flow, captureOrigins: [new URL(targetUrl).origin] })});` }));
    disposables.push(await page.route('**/*', async route => {
      if (stoppedByPolicy) { await route.abort(); return; }
      if (programDecision) {
        programDecision.requests++;
        if (Date.now() >= programDecision.deadline || programDecision.requests > programDecision.permit.ceilings.requests) {
          await route.abort(); policyStop('PILOT_BUDGET_EXCEEDED'); return;
        }
      }
      const request = route.request();
      const url = new URL(request.url());
      requests++;
      if (requests > flow.maxRequests || !flow.origins.includes(url.origin) ||
          (flow.mode === 'public' && !['GET', 'HEAD'].includes(request.method()))) {
        await route.abort(); policyStop('UNDECLARED_OR_OVER_BUDGET_REQUEST'); return;
      }
      if (request.method() === 'POST' && /\/runs$/.test(url.pathname)) {
        if (flow.mode !== 'authenticated' || !verifiedAccount || ++submitted > (flow.maxRunSubmissions ?? 1)) {
          await route.abort(); policyStop('RUN_SUBMISSION_NOT_AUTHORIZED'); return;
        }
      }
      emit({ kind: 'request', payload: { method: request.method(), resourceType: request.resourceType(), ...safeLocation(url.href) } });
      await route.continue();
    }));
    page.setDefaultTimeout(15000);
    cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    if (flow.mode === 'authenticated') chatHttp = observeChatHttp({ cdp, emit, stop: policyStop,
      phase: () => currentPhase, pending: pendingResponses, maxSubmissions: flow.maxRunSubmissions ?? 1 });
    cdp.on('Network.dataReceived', event => { networkBytes += event.dataLength; if (networkBytes > flow.maxNetworkBytes) policyStop('NETWORK_BYTE_LIMIT'); });
    const onPageError = () => emit({ kind: 'page-error', payload: { code: 'UNHANDLED_PAGE_ERROR' } });
    page.on('pageerror', onPageError); listeners.push(['pageerror', onPageError]);
    const onResponse = response => {
      const job = (async () => {
        const url = new URL(response.url());
        emit({ kind: 'response', payload: { status: response.status(), ...safeLocation(url.href) } });
        if (flow.mode === 'authenticated' && url.origin === 'https://func-watai-cbroocyg3omrk.azurewebsites.net' && url.pathname === '/api/me' && response.ok()) {
          const result = await response.json();
          verifiedAccount = result.isInvited === true && result.isAdmin === false && typeof result.email === 'string' &&
            digest(result.email.trim().toLowerCase()) === settings.expectedTestEmailSha256;
          if (!verifiedAccount) policyStop('TEST_ACCOUNT_ID_MISMATCH');
        }
        if (url.origin === new URL(targetUrl).origin && ['script', 'stylesheet', 'document'].includes(response.request().resourceType()) && response.ok()) {
          const size = Number(response.headers()['content-length'] ?? 0);
          if (size > 4194304) { policyStop('ARTIFACT_IDENTITY_BYTE_LIMIT'); return; }
          const content = await response.body();
          const violation = budgetViolation(flow, { artifactBytes: content.length });
          if (violation) { policyStop(violation); return; }
          metadata.artifactIdentities.push({ ...safeLocation(url.href), bytes: content.length, sha256: digest(content) });
        }
      })().catch(() => emit({ kind: 'capture-gap', payload: { code: 'RESPONSE_OBSERVATION_FAILED' } }));
      pendingResponses.add(job); void job.finally(() => pendingResponses.delete(job));
    };
    page.on('response', onResponse); listeners.push(['response', onResponse]);
    const additionalPilot = ['CHAT-02', 'CHAT-03', 'CHAT-04'].includes(flow.id);
    phase(additionalPilot ? 'ready' : 'navigate');
    if (!ownsResources) await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: phaseBudget.remaining(10000) });
    await page.goto(flow.mode === 'public' ? targetUrl : `${targetUrl}#/new`, { waitUntil: 'domcontentloaded', timeout: phaseBudget.remaining(20000) });
    await page.locator(flow.readySelector).waitFor({ state: 'visible' });
    if (!additionalPilot) phase('ready');
    if (flow.mode === 'public') {
      const heading = await page.locator(flow.readySelector).innerText();
      const action = page.getByRole('button', { name: flow.expectedAction, exact: true });
      const operable = await action.evaluate(element => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return !element.disabled && box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= innerWidth && (hit === element || element.contains(hit));
      });
      phase('inspect');
      let focused = false;
      for (let attempt = 0; attempt < 8 && !focused; attempt++) {
        capturePolicy.assertActive();
        emit({ kind: 'action', payload: { name: 'Tab', attempt } });
        const keyboardDeadline = setTimeout(() => policyStop('KEYBOARD_DEADLINE_EXCEEDED'), phaseBudget.remaining(3000));
        try { await page.keyboard.press('Tab'); }
        finally { clearTimeout(keyboardDeadline); }
        if (stoppedByPolicy) throw new Error('FLOW_POLICY_STOPPED');
        focused = await action.evaluate(element => document.activeElement === element);
      }
      await observeWindow(page, flow.reconciliationMs);
      await screenshot('public-ready.png');
      emit({ kind: 'outcome', payload: { heading: heading === flow.expectedHeading, signInOperable: operable, keyboardFocus: focused } });
    } else if (additionalPilot) {
      if (await page.locator('[data-message-id]').count()) throw new Error('NEW_EMPTY_TEST_THREAD_REQUIRED');
      await Promise.all([...pendingResponses]);
      if (!verifiedAccount) throw new Error('VERIFIED_TEST_ACCOUNT_REQUIRED');
      await drivePilotChat({ flow, page, phase, budget: phaseBudget, monitor, http: chatHttp, emit, screenshot, observeWindow,
        assertActive: () => { capturePolicy.assertActive(); phaseBudget.remaining(flow.deadlineMs); if (stoppedByPolicy) throw new Error('FLOW_POLICY_STOPPED'); } });
      metadata.createdConversation = safeLocation(page.url());
    } else {
      if (await page.locator('[data-message-id]').count()) throw new Error('NEW_EMPTY_TEST_THREAD_REQUIRED');
      await Promise.all([...pendingResponses]);
      if (!verifiedAccount) throw new Error('VERIFIED_TEST_ACCOUNT_REQUIRED');
      phase('compose'); await page.locator(flow.readySelector).fill(flow.prompt);
      phase('submit'); emit({ kind: 'action', payload: { name: 'Send', promptSha256: digest(flow.prompt) } });
      await page.locator(flow.actionSelector).click();
      await page.locator('.msg-group--assistant').waitFor(); phase('response');
      const terminal = await chatHttp.waitForTerminal(phaseBudget.remaining(60000));
      emit({ kind: 'terminal-run', payload: terminal });
      if (terminal.status !== 'complete') emit({ kind: 'page-error', payload: { code: `RUN_${terminal.status.toUpperCase()}` } });
      await page.locator(flow.stopSelector).waitFor({ state: 'detached', timeout: 5000 });
      phase('complete'); await observeWindow(page, flow.reconciliationMs);
      const answer = await page.locator(flow.answerSelector).innerText();
      await screenshot('chat-complete.png');
      metadata.createdConversation = safeLocation(page.url());
      await page.evaluate(() => window.__wataiEvalCapture?.stop());
      phase('reload'); await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator(flow.answerSelector).waitFor(); await observeWindow(page, flow.reconciliationMs);
      const restored = await page.locator(flow.answerSelector).innerText();
      const prompt = await page.locator('.msg-group--user').innerText();
      await screenshot('chat-reloaded.png');
      emit({ kind: 'outcome', payload: { answer: answer.trim() === flow.expectedAnswer, restored: restored.trim() === flow.expectedAnswer, prompt: prompt.includes(flow.prompt), oneSubmission: submitted === 1 } });
    }
  } catch {
    emit({ kind: 'runner-error', payload: { code: stoppedByPolicy ? 'STOPPED_BY_POLICY' : 'FLOW_DID_NOT_COMPLETE' } });
  } finally {
    clearTimeout(deadline);
    clearTimeout(phaseDeadline);
    chatHttp?.stop();
    monitor.close();
    if (page && !page.isClosed()) await page.evaluate(() => window.__wataiEvalCapture?.stop()).catch(() => emit({ kind: 'capture-gap', payload: { code: 'FINAL_CAPTURE_UNAVAILABLE' } }));
    for (const [event, handler] of listeners) page.off(event, handler);
    for (const disposable of disposables.reverse()) await disposable.dispose().catch(() => emit({ kind: 'capture-gap', payload: { code: 'INSTRUMENTATION_CLEANUP_FAILED' } }));
    await cdp?.detach().catch(() => {});
    await closeOwnedBrowserResources({ browser, context, ownsResources }).catch(() => {});
    await Promise.all([...pendingResponses]);
    await writes;
    if (writerError) events.push({ eventId: events.length + 1, kind: 'capture-gap', payload: { code: 'WRITER_FAILURE' } });
    metadata.finishedAt = new Date().toISOString(); metadata.requests = requests; metadata.networkBytes = networkBytes;
    await writeFile(resolve(directory, 'metadata.json'), JSON.stringify(metadata, null, 2));
    const report = evaluatePreparedHeuristics(flow, events, metadata);
    await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2));
    await writeFile(resolve(directory, 'replay.json'), JSON.stringify(replay(events), null, 2));
    await writeFile(resolve(directory, 'manifest.json'), JSON.stringify({ runId, planSha256: status.planSha256,
      eventsSha256: digest(await readFile(resolve(directory, 'events.jsonl')).catch(() => Buffer.from(''))), releaseEligible: false }, null, 2));
    await writeFile(resolve(state, 'latest.json'), JSON.stringify({ directory, report: report.status }, null, 2));
    console.log(JSON.stringify({ directory, ...report }, null, 2));
    if (report.status !== 'DIAGNOSTIC_PASS') process.exitCode = 1;
    return { status: report.status, directory };
  }
}
async function observeWindow(page, milliseconds) {
  await page.evaluate(duration => new Promise(resolve => {
    const start = performance.now();
    const next = () => performance.now() - start >= duration ? resolve() : requestAnimationFrame(next);
    requestAnimationFrame(next);
  }), milliseconds);
}
await initialize();
const settings = await config();
if (command === 'init' || command === 'preflight') {
  console.log(JSON.stringify({ configPath, flows: await Promise.all(definitions.flows.map(flow => inspect(settings, flow))),
    preparation: await preparationInventory(root, definitions.flows, pilot) }, null, 2));
} else if (['public', 'chat'].includes(command)) {
  await run(definitions.flows.find(flow => flow.id === (command === 'public' ? 'AUTH-01' : 'CHAT-01')), settings);
} else if (command === 'pilot') {
  const requested = process.argv[3];
  if (requested && !pilot.execution.order.includes(requested)) throw new Error('FLOW_OUTSIDE_PILOT');
  if (requested) await run(definitions.flows.find(flow => flow.id === requested), settings);
  else {
    const selected = pilot.execution.order.map(id => definitions.flows.find(flow => flow.id === id));
    const path = resolve(state, 'pilot-decision.json');
    const permit = JSON.parse(await readFile(path, 'utf8').catch(() => '{}'));
    const expectedCommand = pilotWorkCommand(pilot, selected, settings);
    const deadline = Math.min(Date.parse(permit.expiresAt), Date.parse(permit.approvedAt) + permit.ceilings?.wallClockMinutes * 60000);
    const valid = permit.status === 'APPROVED' && permit.oneShot === true && Date.parse(permit.approvedAt) <= Date.now() &&
      deadline > Date.now() && permit.commandSha256 === digest(expectedCommand) &&
      Number.isSafeInteger(permit.ceilings?.requests) && permit.ceilings.requests > 0;
    const decision = { valid, path, permit, deadline, requests: 0 };
    const result = await runPilotOnce({ flows: selected, inspect: flow => inspect(settings, flow, decision),
      consumePermit: () => rename(path, resolve(state, `pilot-decision-used-${randomUUID()}.json`)),
      run: flow => run(flow, settings, decision) });
    console.log(JSON.stringify({ ...result, expectedCommand, scope: 'five-flow-pilot' }, null, 2));
    if (result.status !== 'OBSERVATIONS_COLLECTED') process.exitCode = 1;
  }
} else if (command === 'prepare-five-flow-pilot') {
  const sourcePaths = ['capture.mjs', 'capture-entry.mjs', 'capture-bootstrap.mjs', 'core.mjs', 'semantic.mjs',
    'run.mjs', 'preparation.mjs', 'evidence.mjs', 'auth-heuristics.mjs', 'chat-heuristics.mjs', 'chat-http.mjs',
    'pilot-chat-plans.mjs', 'pilot-chat-heuristics.mjs', 'pilot-chat-driver.mjs', 'five-flow-pilot.json'].map(name => `tests/e2e/deployed/${name}`);
  const artifacts = await Promise.all(sourcePaths.map(async path => ({ path, sha256: digest(await readFile(resolve(root, path))) })));
  const authored = [];
  for (const { flow, pack } of additionalPlans) {
    pack.flowDefinition = flow;
    pack.flowDigest = preparationDigest(flow);
    pack.artifacts = artifacts;
    pack.semantic.skillSha256 = digest(await readFile(resolve(root, pack.semantic.skillPath)));
    pack.semantic.agentSha256 = digest(await readFile(resolve(root, pack.semantic.agentPath)));
    pack.bindingStatus = 'BOUND_DRAFT_NOT_READY';
    const path = resolve(root, `tests/e2e/deployed/preparation/${flow.id}.json`);
    try {
      await writeFile(path, JSON.stringify(pack, null, 2) + '\n', { flag: 'wx' });
      authored.push({ flowId: flow.id, status: 'AUTHORED_NOT_READY' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = JSON.parse(await readFile(path, 'utf8'));
      if (existing.flowId !== flow.id || existing.variantId !== pack.variantId || existing.flowVersion !== flow.version ||
          preparationDigest(existing.flowDefinition) !== preparationDigest(flow) || existing.attestations?.length !== 0 ||
          !existing.unresolved?.length || existing.artifacts?.length !== sourcePaths.length ||
          new Set(existing.artifacts.map(item => item.path)).size !== sourcePaths.length ||
          existing.artifacts.some(item => !sourcePaths.includes(item.path)) ||
          existing.semantic?.skillPath !== pack.semantic.skillPath || existing.semantic?.agentPath !== pack.semantic.agentPath) throw new Error('EXISTING_PILOT_DRAFT_BINDING_MISMATCH');
      existing.flowDigest = pack.flowDigest;
      existing.artifacts = artifacts;
      existing.semantic.skillSha256 = pack.semantic.skillSha256;
      existing.semantic.agentSha256 = pack.semantic.agentSha256;
      existing.bindingStatus = 'BOUND_DRAFT_NOT_READY';
      await writeFile(path, JSON.stringify(existing, null, 2) + '\n');
      authored.push({ flowId: flow.id, status: 'EXISTING_DESIGN_PRESERVED_BINDINGS_REFRESHED' });
    }
  }
  console.log(JSON.stringify({ scope: 'five-flow-pilot', authored, preparation: await preparationInventory(root, definitions.flows, pilot) }, null, 2));
} else if (['bind-auth-preparation', 'bind-chat-preparation'].includes(command)) {
  const flowId = command === 'bind-auth-preparation' ? 'AUTH-01' : 'CHAT-01';
  const path = resolve(root, `tests/e2e/deployed/preparation/${flowId}.json`);
  const pack = JSON.parse(await readFile(path, 'utf8'));
  const flow = definitions.flows.find(item => item.id === flowId);
  const allowed = new Set(['tests/e2e/deployed/capture.mjs', 'tests/e2e/deployed/capture-entry.mjs',
    'tests/e2e/deployed/capture-bootstrap.mjs', 'tests/e2e/deployed/core.mjs',
    'tests/e2e/deployed/semantic.mjs', 'tests/e2e/deployed/run.mjs', 'tests/e2e/deployed/preparation.mjs',
    'tests/e2e/deployed/evidence.mjs', 'tests/e2e/deployed/auth-heuristics.mjs', 'tests/e2e/deployed/chat-heuristics.mjs', 'tests/e2e/deployed/chat-http.mjs',
    'tests/e2e/deployed/pilot-chat-plans.mjs', 'tests/e2e/deployed/pilot-chat-heuristics.mjs', 'tests/e2e/deployed/pilot-chat-driver.mjs', 'tests/e2e/deployed/five-flow-pilot.json',
    ...(flowId === 'AUTH-01' ? ['src/features/onboarding/Onboarding.tsx']
      : ['src/features/chat/Message.tsx', 'api/src/application/runService.ts']),
    'src/design/global.css',
    'documentation/quality-gate/flows/AUTH-01-CHAT-01.md']);
  if (pack.flowId !== flow.id || pack.flowVersion !== flow.version || pack.attestations?.length !== 0 ||
      pack.unresolved?.length < 1 || pack.artifacts?.length !== allowed.size ||
      new Set(pack.artifacts.map(item => item.path)).size !== allowed.size ||
      pack.artifacts.some(item => !allowed.has(item.path)) ||
      pack.semantic.skillPath !== '.github/skills/edd-semantic-review/SKILL.md' ||
      pack.semantic.agentPath !== 'tests/e2e/deployed/semantic-agent.json') throw new Error('ONLY_UNSIGNED_FLOW_DRAFT_BINDING_ALLOWED');
  pack.flowDigest = preparationDigest(flow);
  for (const artifact of pack.artifacts) artifact.sha256 = digest(await readFile(resolve(root, artifact.path)));
  pack.semantic.skillSha256 = digest(await readFile(resolve(root, pack.semantic.skillPath)));
  pack.semantic.agentSha256 = digest(await readFile(resolve(root, pack.semantic.agentPath)));
  pack.bindingStatus = 'BOUND_DRAFT_NOT_READY';
  await writeFile(path, JSON.stringify(pack, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'BOUND_NOT_READY', flowId: pack.flowId, unresolved: pack.unresolved, packDigest: preparationDigest(pack) }, null, 2));
} else if (['evaluate', 'replay'].includes(command)) {
  const latest = JSON.parse(await readFile(resolve(state, 'latest.json'), 'utf8'));
  const directory = resolve(latest.directory);
  if (!directory.startsWith(results + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('EVIDENCE_PATH_OUTSIDE_RESULTS');
  const metadata = JSON.parse(await readFile(resolve(directory, 'metadata.json'), 'utf8'));
  const events = (await readFile(resolve(directory, 'events.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const flow = metadata.flowDefinition ?? definitions.flows.find(flow => flow.id === metadata.flowId);
  if (command === 'evaluate' && digest(JSON.stringify(flow)) !== metadata.planSha256) throw new Error('FLOW_CHANGED_SINCE_CAPTURE');
  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  if (digest(await readFile(resolve(directory, 'events.jsonl'))) !== manifest.eventsSha256) throw new Error('EVIDENCE_DIGEST_MISMATCH');
  const result = command === 'evaluate' ? evaluatePreparedHeuristics(flow, events, metadata) : replay(events, process.argv[3] === undefined ? Infinity : Number(process.argv[3]));
  console.log(JSON.stringify(result, null, 2));
  if (command === 'evaluate' && result.status !== 'DIAGNOSTIC_PASS') process.exitCode = 1;
} else { throw new Error('UNKNOWN_EVAL_COMMAND'); }
if (attachedTransportUsed) process.stdout.write('', () => process.exit(process.exitCode ?? 0));