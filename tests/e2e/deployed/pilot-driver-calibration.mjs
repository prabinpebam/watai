import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { buildCaptureRuntime } from './capture-bootstrap.mjs';
import { pilotChatPlans } from './pilot-chat-plans.mjs';
import { createPilotMonitor, drivePilotChat } from './pilot-chat-driver.mjs';
import { evaluatePilotChat } from './pilot-chat-heuristics.mjs';
import { createPhaseBudget } from './core.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = `<style>body{margin:20px;font-family:sans-serif}.chat__scroll{width:600px;height:240px;overflow:auto;overflow-anchor:none;border:1px solid black}.msg-group{padding:8px}.md,.bubble-user{white-space:pre-wrap;font:16px/20px sans-serif}.composer{display:flex;margin-top:12px}textarea{width:480px;height:60px}button{width:100px}</style>
<div class="chat__scroll"><div class="chat__column"></div></div><div class="composer"><textarea aria-label="Message"></textarea><button aria-label="Send">Send</button></div>`;

function installFixture(flow) {
  const scroll = document.querySelector('.chat__scroll');
  const column = document.querySelector('.chat__column');
  const input = document.querySelector('textarea');
  const button = document.querySelector('button');
  const counts = { sends: 0, stops: 0, wheels: 0 };
  let active;
  let follow = true;
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const emit = (kind, payload) => window.__calibrationEvent({ kind, payload });
  const control = running => { button.setAttribute('aria-label', running ? 'Stop generating' : 'Send'); button.textContent = running ? 'Stop' : 'Send'; };
  scroll.addEventListener('wheel', () => { counts.wheels++; follow = false; });
  button.addEventListener('click', () => { void (async () => {
    if (active?.running) {
      counts.stops++; active.running = false;
      await emit('cancel-request', { ...active.ids, method: 'DELETE' });
      await emit('run-status', { ...active.ids, status: 'cancel_requested' });
      await frames();
      await emit('run-status', { ...active.ids, status: 'canceled' }); control(false);
      return;
    }
    const index = counts.sends++;
    const ids = { threadId: 'calibration-thread', runId: `run-${index}`, clientMessageId: `prompt-${index}`, assistantMessageId: `reply-${index}` };
    const text = input.value; input.value = ''; follow = true;
    await emit('submitted-run', { threadId: ids.threadId, clientMessageId: ids.clientMessageId, text });
    await emit('run-accepted', ids);
    const prompt = document.createElement('div'); prompt.className = 'msg-group msg-group--user'; prompt.dataset.messageId = ids.clientMessageId;
    const promptBody = document.createElement('div'); promptBody.className = 'bubble-user'; promptBody.textContent = text; prompt.append(promptBody);
    const reply = document.createElement('div'); reply.className = 'msg-group msg-group--assistant'; reply.dataset.messageId = ids.assistantMessageId;
    const body = document.createElement('div'); body.className = 'md'; reply.append(body); column.append(prompt, reply);
    const generation = { ids, running: true }; active = generation; control(true);
    await emit('run-status', { ...ids, status: 'running' });
    if (flow.id === 'CHAT-02' || index > 0) {
      await frames(); body.textContent = flow.answers[index];
      if (follow) scroll.scrollTop = scroll.scrollHeight;
    } else {
      const target = flow.id === 'CHAT-03' ? 200 : 2000;
      for (let count = 50; count <= target && generation.running; count++) {
        body.textContent = Array.from({ length: count }, (_, line) => String(line + 1)).join('\n');
        if (follow) scroll.scrollTop = scroll.scrollHeight;
        await frames();
      }
    }
    if (generation.running) {
      generation.running = false; await emit('run-status', { ...ids, status: 'complete' }); control(false);
    }
  })().catch(() => emit('runner-error', { code: 'CALIBRATION_FIXTURE_ERROR' })); });
  window.__calibrationCounts = counts;
}

const decisionPath = join(root, '.harness-state/deployed-eval/pilot-driver-calibration-decision.json');
const decision = JSON.parse(await readFile(decisionPath, 'utf8').catch(() => '{}'));
const fresh = decision.status === 'APPROVED' && decision.oneShot === true && Date.parse(decision.expiresAt) > Date.now() &&
  decision.commandSha256 === sha('edd-pilot-driver-calibration-local');
const runtime = await buildCaptureRuntime();
const identities = { fixtureSha256: sha(fixture + installFixture.toString()), bundleSha256: sha(runtime),
  driverSha256: sha(await readFile(new URL('./pilot-chat-driver.mjs', import.meta.url))),
  procedureSha256: sha(await readFile(join(root, 'documentation/quality-gate/flows/pilot-driver-calibration.md'))) };
if (process.argv.includes('--check')) {
  console.log(JSON.stringify({ status: fresh && existsSync(chromium.executablePath()) ? 'PASSED' : 'BLOCKED', ...identities, browserStarted: false }, null, 2));
  if (!fresh || !existsSync(chromium.executablePath())) process.exitCode = 1;
} else {
  assert.ok(fresh && existsSync(chromium.executablePath()), 'Fresh decision and installed Chromium required');
  await rename(decisionPath, join(root, `.harness-state/deployed-eval/pilot-driver-calibration-used-${randomUUID()}.json`));
  const startedAt = new Date().toISOString();
  const output = join(root, 'test-results/deployed-eval/pilot-driver-calibration', `${startedAt.replaceAll(':', '-')}-${randomUUID()}`);
  await mkdir(output, { recursive: true });
  const results = [];
  let browser;
  let requests = 0;
  let failure;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void browser?.close().catch(() => {}); }, 60000);
  try {
    browser = await chromium.launch({ headless: true, timeout: 15000 });
    if (timedOut) throw new Error('CALIBRATION_DEADLINE_EXCEEDED');
    const definitions = JSON.parse(await readFile(new URL('./flows.json', import.meta.url), 'utf8'));
    for (const { flow, pack } of pilotChatPlans(definitions.flows.find(item => item.id === 'CHAT-01'))) {
      const events = [];
      const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, deviceScaleFactor: 1 });
      let pageTimedOut = false;
      const pageTimeout = setTimeout(() => { pageTimedOut = true; void context.close(); }, 45000);
      const monitor = createPilotMonitor();
      let result = { flowId: flow.id, status: 'INCOMPLETE', events };
      results.push(result);
      const emit = event => {
        const entry = { ...event, eventId: events.length + 1, evidenceClass: 'synthetic-driver-calibration' };
        events.push(entry); monitor.observe(entry);
      };
      const budget = createPhaseBudget(pack.steps);
      const phase = name => { budget.enter(name); emit({ kind: 'phase', payload: { phase: name } }); };
      try {
        await context.route('**/*', async route => { requests++; await route.abort(); void context.close(); });
        const page = await context.newPage(); page.setDefaultTimeout(5000);
        await page.exposeFunction('__wataiEvidence', batch => batch.forEach(emit));
        await page.exposeFunction('__calibrationEvent', event => {
          if (event.kind === 'submitted-run') {
            event.payload.promptSha256 = sha(event.payload.text); delete event.payload.text;
          }
          emit(event);
          if (event.kind === 'run-status') return page.evaluate(payload => window.__wataiEvalCapture.observeRunState(payload), event.payload);
        });
        await page.setContent(fixture);
        await page.evaluate(installFixture, flow);
        await page.evaluate(`${runtime}\nWataiCaptureRuntime.install(${JSON.stringify({ ...flow, captureOrigins: ['null'] })});`);
        phase('ready');
        const http = { status: runId => monitor.state.statuses.get(runId),
          waitForTerminal: (milliseconds, runId) => monitor.wait(state => {
            const status = state.statuses.get(runId);
            return ['complete', 'error', 'canceled'].includes(status) ? { runId, status } : false;
          }, milliseconds) };
        const screenshots = [];
        const screenshot = async name => {
          const png = await page.screenshot(); assert.ok(png.length <= 4194304);
          const filename = `${flow.id}-${name}`;
          await writeFile(join(output, filename), png, { flag: 'wx' });
          screenshots.push({ filename, sha256: sha(png) });
        };
        await drivePilotChat({ flow, page, phase, budget, monitor, http, emit, screenshot,
          assertActive: () => { assert.equal(monitor.state.closed, false); assert.equal(pageTimedOut, false); },
          observeWindow: async (page, milliseconds) => page.evaluate(duration => new Promise(resolve => {
            const start = performance.now(); const frame = () => performance.now() - start >= duration ? resolve() : requestAnimationFrame(frame); requestAnimationFrame(frame);
          }), milliseconds) });
        await page.evaluate(() => window.__wataiEvalCapture.stop());
        const counts = await page.evaluate(() => window.__calibrationCounts);
        assert.equal(counts.sends, flow.id === 'CHAT-03' ? 1 : 2);
        assert.equal(counts.stops, flow.id === 'CHAT-04' ? 1 : 0);
        assert.equal(counts.wheels, flow.id === 'CHAT-03' ? 1 : 0);
        const report = evaluatePilotChat(flow, events);
        result.report = report; result.counts = counts; result.screenshots = screenshots;
        assert.equal(report.status, 'DIAGNOSTIC_PASS', JSON.stringify(report.findings));
        assert.equal(events.some(event => event.kind === 'capture-gap'), false);
        assert.equal(requests, 0); assert.equal(pageTimedOut, false);
        result.status = 'PASSED';
      } finally { clearTimeout(pageTimeout); monitor.close(); await context.close().catch(() => {}); }
    }
    assert.equal(timedOut, false);
  } catch (error) { failure = String(error.message).slice(0, 4000); process.exitCode = 1; }
  finally {
    clearTimeout(timeout);
    const browserVersion = browser?.version(); await browser?.close().catch(() => {});
    await writeFile(join(output, 'report.json'), JSON.stringify({ status: failure || timedOut ? 'FAILED' : 'PASSED', evidenceClass: 'synthetic-driver-calibration',
      startedAt, finishedAt: new Date().toISOString(), browserVersion, requests, timedOut, failure, ...identities, results, releaseEligible: false }, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ output, status: failure || timedOut ? 'FAILED' : 'PASSED', requests, failure,
      results: results.map(({ flowId, status, counts, report }) => ({ flowId, status, counts, findings: report?.findings })), releaseEligible: false }, null, 2));
  }
}