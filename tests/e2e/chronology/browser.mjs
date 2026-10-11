import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = resolve(root, 'test-results/chronology');
await mkdir(output, { recursive: true });
const dataPath = resolve(root, 'src/data').replaceAll('\\', '/');
const fixture = resolve(root, 'tests/e2e/chronology/data.ts');
const server = await createServer({ root, configFile: false,
  optimizeDeps: { entries: ['tests/e2e/chronology/entry.tsx'] },
  plugins: [{
    name: 'chronology-isolated-data', enforce: 'pre',
    resolveId(source, importer) {
      if (importer && source.startsWith('.')) {
        const target = resolve(dirname(importer.split('?')[0]), source).replaceAll('\\', '/');
        if (target === dataPath || target === `${dataPath}/index` || target === `${dataPath}/index.ts`) return fixture;
      }
    },
    transform(code, id) {
      if (id.endsWith('.css')) return code.replace(/@import\s+(?:url\()?['"]https?:[^;]+;/g, '');
    },
    configureServer(instance) {
      instance.middlewares.use((request, response, next) => {
        if (request.url !== '/chronology') return next();
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root" style="height:100dvh;display:flex;flex-direction:column"></div><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/tests/e2e/chronology/entry.tsx"></script></body></html>');
      });
    },
  }, react()], server: { host: '127.0.0.1', port: 4176, strictPort: true } });
let browser;
const evidence = [];
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const scenario of [
    { name: 'desktop-behind', width: 1280, height: 850, skew: -5000 },
    { name: 'mobile-ahead', width: 390, height: 844, skew: 5000 },
    { name: 'negative-inversion-control', width: 1280, height: 850, skew: -5000, negative: true, expectedViolation: 'response-before-prompt' },
    { name: 'negative-hidden-prompt-control', width: 390, height: 844, skew: 5000, hidePrompt: true, expectedViolation: 'prompt-hidden' },
  ]) {
    const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    const external = [];
    const record = { scenario: scenario.name, external, errors, passed: false };
    evidence.push(record);
    page.on('pageerror', error => errors.push(error.message));
    const pendingRequests = new Map();
    page.on('request', request => pendingRequests.set(request, new URL(request.url()).pathname));
    page.on('requestfinished', request => pendingRequests.delete(request));
    page.on('requestfailed', request => pendingRequests.delete(request));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://127.0.0.1:4176') { external.push(url.origin); return route.abort(); }
      return route.continue();
    });
    const readinessDeadline = Date.now() + 15000;
    record.readinessStage = 'domcontentloaded';
    try {
      await page.goto('http://127.0.0.1:4176/chronology', { waitUntil: 'domcontentloaded', timeout: 15000 });
      record.readinessStage = 'composer-and-fixture';
      const remaining = readinessDeadline - Date.now();
      assert.ok(remaining > 0, 'Chronology readiness deadline exceeded');
      await page.waitForFunction(() => !!document.querySelector('textarea') && !!window.__chronology, undefined, { timeout: remaining });
      record.readinessStage = 'ready';
    } catch (error) {
      record.pendingRequestPaths = [...pendingRequests.values()];
      throw error;
    }
    await page.evaluate(({ skew, negative }) => {
      window.__chronology.configure(skew, negative);
      const samples = [];
      let promptSeen = false;
      let replySeen = false;
      const violations = [];
      const previouslyVisible = new WeakSet();
      const capture = source => {
        const elements = [...document.querySelectorAll('.chat__column [data-message-id]')];
        const rows = elements.map(element => {
          const visible = element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
          const initialEntrance = !visible && !previouslyVisible.has(element) &&
            element.checkVisibility({ checkVisibilityCSS: true }) &&
            element.getAnimations().some(animation => animation.animationName === 'msg-in' &&
              animation.playState === 'running' && animation.effect?.getComputedTiming().progress === 0);
          if (visible) previouslyVisible.add(element);
          return { id: element.dataset.messageId, top: element.getBoundingClientRect().top,
            height: element.getBoundingClientRect().height, visible, initialEntrance };
        });
        const promptId = window.__chronology.promptId;
        const prompt = rows.findIndex(row => row.id === promptId);
        const reply = rows.findIndex(row => row.id.startsWith('pending-') || row.id === 'chronology-reply');
        const peer = rows.findIndex(row => row.id === 'peer-prompt');
        promptSeen ||= prompt >= 0;
        replySeen ||= reply >= 0;
        if (promptSeen && prompt < 0) violations.push('prompt-disappeared');
        if (replySeen && reply < 0) violations.push('reply-disappeared');
        if (prompt >= 0 && ((!rows[prompt].visible && !rows[prompt].initialEntrance) || rows[prompt].height <= 0)) violations.push('prompt-hidden');
        if (reply >= 0 && ((!rows[reply].visible && !rows[reply].initialEntrance) || rows[reply].height <= 0)) violations.push('reply-hidden');
        if (reply >= 0 && (prompt < 0 || reply < prompt || rows[reply].top < rows[prompt].top)) violations.push('response-before-prompt');
        if (reply >= 0 && peer >= 0 && reply > peer) violations.push('response-moved-after-peer');
        samples.push({ source, rows, scrollTop: document.querySelector('.chat__scroll')?.scrollTop });
      };
      const observer = new MutationObserver(() => capture('mutation'));
      observer.observe(document.querySelector('#root'), { subtree: true, childList: true, attributes: true, characterData: true });
      let active = true;
      const frame = () => { if (active) { capture('frame'); requestAnimationFrame(frame); } };
      requestAnimationFrame(frame);
      window.__capture = { samples, violations, stop: () => { active = false; observer.disconnect(); } };
    }, scenario);
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.locator('textarea').fill('A chronology-sensitive prompt');
    await page.locator('textarea').press('Enter');
    await page.waitForFunction(() => !!window.__chronology.promptId);
    await frames();
    if (scenario.hidePrompt) {
      const prompt = page.locator('[data-message-id]').filter({ hasText: 'A chronology-sensitive prompt' });
      await prompt.evaluate(element => { element.style.visibility = 'hidden'; });
      await frames();
      await prompt.evaluate(element => { element.style.removeProperty('visibility'); });
      await frames();
    }
    await page.evaluate(() => window.__chronology.staleRead());
    await frames();
    await page.evaluate(() => window.__chronology.releaseAppend());
    await page.waitForFunction(() => !!window.__chronology.submitted);
    await frames();
    await page.evaluate(() => window.__chronology.pushOld());
    await frames();
    await page.evaluate(() => window.__chronology.releaseAck());
    await page.waitForFunction(() => window.__chronology.acknowledged);
    await page.evaluate(() => window.__chronology.releaseStale());
    await frames();
    await page.evaluate(() => window.__chronology.addPeer());
    await page.locator('[data-message-id="peer-prompt"]').waitFor();
    await page.evaluate(() => window.__chronology.push('First streamed response.'));
    await frames();
    await page.evaluate(() => window.__chronology.releaseCancelledPreparation());
    await frames();
    await page.evaluate(() => window.__chronology.pushOld());
    await frames();
    await page.locator('.chat__scroll').hover();
    await page.mouse.wheel(0, -400);
    await frames();
    const historyAnchor = await page.locator('[data-message-id="history-8"]').evaluate(element => element.getBoundingClientRect().top);
    const readerScroll = await page.locator('.chat__scroll').evaluate(element => element.scrollTop);
    const finalContent = 'First streamed response. ' + 'More content follows. '.repeat(40);
    await page.evaluate(content => window.__chronology.push(content), finalContent);
    await frames();
    assert.ok(Math.abs((await page.locator('[data-message-id="history-8"]').evaluate(element => element.getBoundingClientRect().top)) - historyAnchor) <= 1, 'Streaming moved the reading-history anchor');
    await page.evaluate(content => window.__chronology.push(content, true), finalContent);
    await page.waitForFunction(() => !window.__chronology.running, undefined, { timeout: 5000 });
    await frames();
    await page.evaluate(() => window.__chronology.releaseReads());
    await frames();
    assert.ok(Math.abs((await page.locator('.chat__scroll').evaluate(element => element.scrollTop)) - readerScroll) <= 1, 'Completion moved the reading-history scroll position');
    Object.assign(record, await page.evaluate(() => {
      window.__capture.stop();
      return { samples: window.__capture.samples, violations: window.__capture.violations, pair: window.__chronology.submitted.messageOrder };
    }));
    await page.screenshot({ path: resolve(output, `${scenario.name}.png`), fullPage: true });
    assert.equal(external.length, 0, 'Unexpected external traffic');
    assert.deepEqual(errors, []);
    assert.ok(record.samples.some(sample => sample.source === 'frame'));
    if (scenario.expectedViolation) assert.ok(record.violations.includes(scenario.expectedViolation), `Negative control did not detect ${scenario.expectedViolation}`);
    else assert.deepEqual(record.violations, [], `Transient chronology defect in ${scenario.name}`);
    record.passed = true;
    await context.close();
  }
  console.log(JSON.stringify(evidence.map(({ scenario, samples, violations }) => ({ scenario, observations: samples.length, violations: [...new Set(violations)] })), null, 2));
} finally {
  try { await writeFile(resolve(output, 'evidence.json'), JSON.stringify(evidence, null, 2)); }
  finally { await browser?.close(); await server.close(); }
}