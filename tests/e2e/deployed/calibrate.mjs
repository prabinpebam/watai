import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { buildCaptureRuntime } from './capture-bootstrap.mjs';
import { evaluate } from './core.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = `<style>
body{margin:0;background:rgb(245,245,245)}
.onboard{position:absolute;left:80px;top:80px;width:360px;padding:24px;background:white}
.onboard__actions{padding:12px}
button{display:block;width:280px;height:48px;border:0;border-radius:4px;background:rgb(36,36,36);color:white}
button:focus{outline:none;box-shadow:0 0 0 2px white,0 0 0 4px rgb(230,0,126)}
</style><div class="onboard"><h1 class="onboard__title">Welcome to Watai</h1>
<span id="sign-in-name" hidden>Continue securely</span><div class="onboard__actions"><button>Sign in</button></div></div>`;

async function calibrate() {
  const startedAt = new Date().toISOString();
  const { flows } = JSON.parse(await readFile(new URL('./flows.json', import.meta.url), 'utf8'));
  const decisionPath = join(root, '.harness-state/deployed-eval/recorder-calibration-decision.json');
  const decision = JSON.parse(await readFile(decisionPath, 'utf8').catch(() => '{}'));
  const available = existsSync(chromium.executablePath());
  const authorized = decision.status === 'APPROVED' && decision.oneShot === true &&
    decision.commandSha256 === sha('edd-recorder-calibration-local') && Date.parse(decision.expiresAt) > Date.now();
  const captureRuntime = await buildCaptureRuntime();
  if (process.argv.includes('--check')) {
    console.log(JSON.stringify({ static: available && authorized ? 'PASSED' : 'BLOCKED', installedChromium: available,
      freshDecision: authorized, fixtureSha256: sha(fixture), bundleSha256: sha(captureRuntime), browserStarted: false }, null, 2));
    if (!available || !authorized) process.exitCode = 1;
    return;
  }
  assert.ok(available && authorized, 'Installed browser and fresh calibration decision required');
  await rename(decisionPath, join(root, `.harness-state/deployed-eval/recorder-calibration-used-${randomUUID()}.json`));
  const output = join(root, 'test-results/deployed-eval/calibration', `${startedAt.replaceAll(':', '-')}-${randomUUID()}`);
  await mkdir(output, { recursive: true });
  const publicEvents = [];
  const chatEvents = [];
  const screenshots = [];
  const outcomes = {};
  let requests = 0;
  let browser;
  let failure;
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; void browser?.close().catch(() => {}); }, 45000);
  const append = (events, event) => events.push({ ...event, eventId: events.length + 1 });
  const frames = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const connect = async (page, flow, events) => {
    await page.exposeFunction('__wataiEvidence', batch => batch.forEach(event => append(events, event)));
    await page.evaluate(`${captureRuntime}\nWataiCaptureRuntime.install(${JSON.stringify({ ...flow, captureOrigins: ['null'] })});`);
    await frames(page);
  };
  const buttonState = async page => {
    await page.evaluate(() => window.__wataiEvalCapture.checkpoint());
    const snapshot = publicEvents.findLast(event => event.kind === 'snapshot');
    return snapshot.payload.nodes.find(node => node.role === 'button');
  };
  const ringPixels = async (page, id) => {
    const rect = await page.locator('button').boundingBox();
    assert.ok(rect);
    const before = await page.evaluate(() => window.__wataiEvalCapture.checkpoint());
    const png = await page.screenshot();
    assert.ok(png.length <= 4194304, 'Screenshot byte ceiling');
    const after = await page.evaluate(() => window.__wataiEvalCapture.checkpoint());
    await writeFile(join(output, `${id}.png`), png, { flag: 'wx', mode: 0o600 });
    const count = await page.evaluate(async ({ base64, rect }) => {
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      const left = Math.max(0, Math.floor(rect.x - 6));
      const top = Math.max(0, Math.floor(rect.y - 6));
      const width = Math.min(bitmap.width - left, Math.ceil(rect.width + 12));
      const height = Math.min(bitmap.height - top, Math.ceil(rect.height + 12));
      const pixels = context.getImageData(left, top, width, height).data;
      let count = 0;
      for (let row = 0; row < height; row++) for (let column = 0; column < width; column++) {
        const positionX = left + column;
        const positionY = top + row;
        if (positionX >= rect.x && positionX < rect.x + rect.width && positionY >= rect.y && positionY < rect.y + rect.height) continue;
        const index = (row * width + column) * 4;
        if (Math.abs(pixels[index] - 230) <= 2 && pixels[index + 1] <= 2 && Math.abs(pixels[index + 2] - 126) <= 2 && pixels[index + 3] === 255) count++;
      }
      bitmap.close();
      return count;
    }, { base64: png.toString('base64'), rect });
    screenshots.push({ id, sha256: sha(png), bytes: png.length, rect, count, before, after });
    assert.equal(before.documentId, after.documentId);
    assert.equal(before.snapshotSequence, after.snapshotSequence, 'Stable local fixture changed during screenshot');
    return count;
  };
  let browserVersion;
  try {
    browser = await chromium.launch({ headless: true, timeout: 15000 });
    if (timedOut) throw new Error('CALIBRATION_DEADLINE_EXCEEDED');
    browserVersion = browser.version();
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, deviceScaleFactor: 1 });
    await context.route('**/*', async route => { requests++; await route.abort(); void context.close(); });
    const page = await context.newPage();
    await page.setContent(fixture);
    await connect(page, flows.find(flow => flow.id === 'AUTH-01'), publicEvents);
    const initial = await buttonState(page);
    assert.equal(initial.regionId, 'welcome'); assert.equal(initial.accessibleName, 'Sign in');
    assert.equal(initial.ancestorVisible, true); assert.equal(initial.hitWithinElement, true);
    assert.equal(initial.bounds.width, 280); assert.equal(initial.bounds.height, 48);
    assert.ok(initial.clipBounds.width >= 280 && initial.clipBounds.height >= 48);
    outcomes.publicCanary = true;
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('button').evaluate(element => document.activeElement === element), true);
    outcomes.focusedPixels = await ringPixels(page, 'focused'); assert.ok(outcomes.focusedPixels >= 100);
    await page.mouse.click(20, 20);
    outcomes.unfocusedPixels = await ringPixels(page, 'unfocused'); assert.equal(outcomes.unfocusedPixels, 0);
    await page.locator('button').evaluate(element => element.setAttribute('aria-labelledby', 'sign-in-name'));
    assert.equal((await buttonState(page)).accessibleName, 'Continue securely');
    await page.locator('button').evaluate(element => element.removeAttribute('aria-labelledby'));
    assert.equal((await buttonState(page)).accessibleName, 'Sign in'); outcomes.labelledName = true;
    await page.locator('button').evaluate(element => {
      const bounds = element.getBoundingClientRect(); const overlay = document.createElement('div'); overlay.id = 'cover';
      Object.assign(overlay.style, { position: 'fixed', left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, background: 'white', zIndex: '99' });
      document.body.append(overlay);
    });
    assert.equal((await buttonState(page)).hitWithinElement, false); outcomes.overlayDetected = true;
    await page.locator('#cover').evaluate(element => element.remove());
    await page.locator('.onboard').evaluate(element => { element.style.opacity = '0'; });
    assert.equal((await buttonState(page)).ancestorVisible, false); outcomes.hiddenAncestorDetected = true;
    await page.locator('.onboard').evaluate(element => { element.style.opacity = '1'; });
    await buttonState(page);
    await page.locator('.onboard__actions').evaluate(element => Object.assign(element.style, { padding: '0px', width: '280px', height: '48px', overflow: 'hidden' }));
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('button').evaluate(element => document.activeElement === element), true);
    const clipped = await buttonState(page);
    assert.equal(clipped.clipBounds.width, 280); assert.equal(clipped.clipBounds.height, 48);
    outcomes.clippedPixels = await ringPixels(page, 'clipped'); assert.equal(outcomes.clippedPixels, 0);
    await page.evaluate(() => window.__wataiEvalCapture.stop());
    assert.equal(publicEvents.some(event => event.kind === 'capture-gap'), false, 'Public recorder reported a gap');
    await page.close();

    const chatPage = await context.newPage();
    const flow = flows.find(item => item.id === 'CHAT-01');
    await chatPage.setContent('<main><div class="chat__column"><div class="msg-group--user" data-message-id="prompt"><div class="bubble-user">Test prompt</div></div></div><aside>Unrelated subtree</aside><input type="password" value="DO_NOT_CAPTURE"></main>');
    await connect(chatPage, flow, chatEvents);
    for (const phase of flow.phases) append(chatEvents, { kind: 'phase', payload: { phase } });
    await chatPage.evaluate(() => {
      const reply = document.createElement('div'); reply.className = 'msg-group--assistant'; reply.dataset.messageId = 'reply';
      reply.innerHTML = '<div class="md">46</div>'; document.querySelector('.chat__column').prepend(reply);
    });
    await frames(chatPage);
    await chatPage.evaluate(() => document.querySelector('.chat__column').append(document.querySelector('[data-message-id=reply]')));
    await frames(chatPage);
    await chatPage.evaluate(() => { document.querySelector('[data-message-id=prompt]').style.visibility = 'hidden'; });
    await frames(chatPage);
    await chatPage.evaluate(() => { document.querySelector('[data-message-id=prompt]').style.visibility = ''; });
    await frames(chatPage);
    await chatPage.evaluate(() => window.__wataiEvalCapture.stop());
    const result = evaluate(flow, chatEvents, { evidenceClass: 'calibration' });
    assert.ok(result.findings.some(item => item.code === 'RESPONSE_BEFORE_PROMPT'));
    assert.ok(result.findings.some(item => item.code === 'MESSAGE_HIDDEN'));
    assert.equal(chatEvents.some(event => event.kind === 'capture-gap'), false, 'Chat recorder reported a gap');
    assert.equal(JSON.stringify(chatEvents).includes('DO_NOT_CAPTURE'), false);
    assert.ok(chatEvents.some(event => event.kind === 'mutation' && Number.isFinite(event.observedAtMs)));
    outcomes.chatExpectedDefects = ['RESPONSE_BEFORE_PROMPT', 'MESSAGE_HIDDEN'];
    assert.equal(requests, 0); assert.equal(timedOut, false);
    await context.close();
  } catch (error) { failure = String(error.message).slice(0, 2000); throw error; }
  finally {
    clearTimeout(deadline); await browser?.close().catch(() => {});
    const report = { status: failure || timedOut ? 'FAILED' : 'PASSED', evidenceClass: 'local-recorder-calibration',
      startedAt, finishedAt: new Date().toISOString(), browserVersion, requests, timedOut, failure, outcomes, screenshots,
      sourceSha256: sha(await readFile(new URL('./calibrate.mjs', import.meta.url))), bundleSha256: sha(captureRuntime),
      procedureSha256: sha(await readFile(join(root, 'documentation/quality-gate/flows/recorder-calibration.md'))),
      publicEvents, chatEvents, releaseEligible: false, independentApproval: 'NOT_OBTAINED', semanticCalibration: 'NOT_PERFORMED' };
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ output, status: report.status, requests, outcomes, failure, releaseEligible: false }, null, 2));
  }
}

await calibrate();