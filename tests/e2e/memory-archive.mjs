import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, 'test-results/memory-archive');
const stamp = new Date().toISOString().replaceAll(':', '-');
await mkdir(output, { recursive: true });
const archive = { version: 2, scope: 'active-records', exportedAt: '2026-01-01T00:00:00Z', summary: null,
  memories: Array.from({ length: 21 }, (_, index) => ({ id: `record-${index}`, userId: 'synthetic-owner',
    kind: 'preference', status: 'active', text: index === 0 ? '<img src=x onerror=alert(1)>' : `Archive preference ${index}: use detailed implementation examples.`,
    sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }], confirmation: 'approved', origin: 'manual',
    confidence: 1, salience: 0.7, pinned: false, sensitive: false, visibility: 'normal', revision: 1,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', useCount: 0,
  })) };
const evidence = { startedAt: new Date().toISOString(), scenarios: [], external: [], errors: [], passed: false,
  qualification: 'synthetic-structural-only',
  limitations: ['External fonts are intentionally blocked; icon glyph paint and fallback-text overlap are not visually qualified.',
    'No authenticated service, user storage, physical mobile device or OS download presentation is exercised.'],
};
const dataPath = resolve(root, 'src/data').replaceAll('\\', '/');
const fixtureId = '\0archive-data';
const entryId = '\0archive-entry';
const server = await createServer({ root, configFile: false, esbuild: { jsx: 'automatic' },
  optimizeDeps: { entries: ['src/features/settings/Settings.tsx'], include: ['react', 'react-dom/client'] },
  plugins: [{ name: 'archive-isolated-fixture', enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'virtual:archive-entry') return entryId;
      if (importer && source.startsWith('.')) {
        const target = resolve(dirname(importer.split('?')[0]), source).replaceAll('\\', '/');
        if ([dataPath, `${dataPath}/index`, `${dataPath}/index.ts`].includes(target)) return fixtureId;
      }
    },
    load(id) {
      if (id === entryId) return `import React from 'react'; import {createRoot} from 'react-dom/client';
        import {MemoryArchiveTools} from '/src/features/settings/Settings.tsx';
        import '/src/design/tokens.css'; import '/src/design/global.css'; import '/src/design/components.css';
        createRoot(document.getElementById('root')).render(React.createElement(MemoryArchiveTools));`;
      if (id === fixtureId) return `const archive=${JSON.stringify(archive)}; const scope={};
        window.__archiveCalls=[];
        export const cloudApi={exportMemoryArchive:async()=>{window.__archiveCalls.push('export');return structuredClone(archive)},
          previewMemoryArchive:async(payload)=>{window.__archiveCalls.push('preview');return {added:0,skipped:0,rejected:[],archive:payload}}};
        export const currentAccountKvStore=()=>scope; export const accountLocalStorageKey=key=>key;
        export const repo={}; export const skillsApi={}; export const realtime={};
        export const syncNow=async()=>new Set(); export const saveServerMessage=async()=>{};
        export const loadAccountSettings=async()=>{}; export const backfillSync=async()=>{};
        export const seedMockDataIfEmpty=async()=>{}; export const purgeDemoData=async()=>{};`;
    },
    transform(code, id) {
      if (id.endsWith('.css')) return code.replace(/@import\s+(?:url\()?['"]https?:[^;]+;/g, '');
    },
    configureServer(instance) {
      instance.middlewares.use((request, response, next) => {
        if (request.url !== '/archive') return next();
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="root" style="padding:16px;min-height:100dvh"></main><script type="module" src="/@id/__x00__archive-entry"></script></body></html>');
      });
    },
  }], server: { host: '127.0.0.1', port: 4178, strictPort: true } });
let browser;
let deadline;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  deadline = setTimeout(() => { void browser.close(); }, 60_000);
  for (const viewport of [{ name: 'desktop', width: 1280, height: 850 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://127.0.0.1:4178') { evidence.external.push(url.origin); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => evidence.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') evidence.errors.push(message.text()); });
    const scenario = { name: viewport.name, frames: [], passed: false };
    evidence.scenarios.push(scenario);
    await page.goto('http://127.0.0.1:4178/archive', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.getByRole('button', { name: 'Export archive', exact: true }).waitFor({ timeout: 15000 });
    await page.evaluate(() => {
      window.__archiveFrames = [];
      const capture = () => {
        const dialog = document.querySelector('[role="dialog"]');
        const bounds = dialog?.getBoundingClientRect();
        window.__archiveFrames.push({ width: innerWidth, documentWidth: document.documentElement.scrollWidth,
          ...(bounds ? { dialog: { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height } } : {}),
        });
        window.__archiveFrame = requestAnimationFrame(capture);
      };
      capture();
    });
    await page.getByRole('button', { name: 'Export archive', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Memory archive' });
    await dialog.waitFor();
    await dialog.getByText('Export ready', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Next archive page' }).click();
    await dialog.getByText(archive.memories[20].text, { exact: true }).waitFor();
    assert.equal(await dialog.getByText(archive.memories[0].text, { exact: true }).count(), 0);
    await dialog.getByRole('button', { name: 'Previous archive page' }).click();
    const downloadEvent = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download archive' }).click();
    const download = await downloadEvent;
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString('utf8')), archive);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.textContent.trim().endsWith('Export archive'));
    assert.equal(await page.getByRole('button', { name: 'Export archive', exact: true }).evaluate(element => document.activeElement === element), true);
    await page.locator('input[type="file"]').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive)) });
    await dialog.getByText('Preview only. No records imported.', { exact: true }).waitFor();
    assert.equal(await dialog.locator('img').count(), 0);
    await dialog.evaluate(async element => {
      await Promise.allSettled(element.getAnimations({ subtree: true })
        .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime))
        .map(animation => animation.finished));
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    scenario.controls = await dialog.locator('button:not(:disabled)').evaluateAll(buttons => buttons.map(button => {
      const bounds = button.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return { label: button.getAttribute('aria-label') ?? button.textContent.trim(), visible: button.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
        hit: hit === button || button.contains(hit), hitTag: hit?.tagName, left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
    }));
      scenario.frames = await page.evaluate(() => { cancelAnimationFrame(window.__archiveFrame); return window.__archiveFrames; });
    assert.ok(scenario.controls.every(control => control.visible && control.hit), 'Archive control is not visible and hit-testable');
    await page.screenshot({ path: resolve(output, `${stamp}-${viewport.name}.png`), fullPage: true });
    assert.ok(scenario.frames.every(frame => frame.documentWidth <= frame.width + 1), 'Archive caused horizontal overflow');
    assert.ok(scenario.frames.filter(frame => frame.dialog).every(frame => frame.dialog.left >= -1 && frame.dialog.right <= frame.width + 1), 'Archive dialog exceeds viewport width');
    assert.deepEqual(await page.evaluate(() => window.__archiveCalls), ['export', 'preview']);
    assert.deepEqual(evidence.external, []);
    assert.deepEqual(evidence.errors, []);
    scenario.passed = true;
    await context.close();
  }
  evidence.passed = true;
} catch (error) {
  evidence.failure = error.message;
  throw error;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await server.close();
  await writeFile(resolve(output, `${stamp}.json`), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ startedAt: evidence.startedAt, passed: evidence.passed, scenarios: evidence.scenarios.map(scenario => ({ name: scenario.name, passed: scenario.passed, frames: scenario.frames.length })), external: evidence.external, errors: evidence.errors, failure: evidence.failure }));
}