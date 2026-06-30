/**
 * Real-browser TTFT benchmark for Watai — drives YOUR logged-in Edge via CDP and measures
 * actual time-to-first-token (send -> first assistant token in the DOM) plus total completion
 * and the POST /runs ack latency. No prod changes: instrumentation is injected at runtime.
 *
 * ── One-time setup (reuses your real login) ─────────────────────────────────────────────────
 *   1. Fully QUIT Edge (close every window — check the tray).
 *   2. Relaunch Edge with the debug port (uses your default profile, so your watai login persists):
 *
 *        & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222
 *
 *   3. In that Edge, open https://prabinpebam.github.io/watai/ and confirm you're signed in.
 *   4. Run the bench:
 *
 *        node scripts/ttft-bench.mjs
 *
 * ── Alternative (don't want to quit your main Edge) ─────────────────────────────────────────
 *   Run with BENCH_LAUNCH=1 to open a SEPARATE automation Edge profile (.bench-edge/, gitignored).
 *   Sign in once in that window; the profile persists for future runs:
 *
 *        $env:BENCH_LAUNCH=1; node scripts/ttft-bench.mjs
 *
 * ── Config (env vars) ───────────────────────────────────────────────────────────────────────
 *   BENCH_CDP      CDP endpoint           (default http://127.0.0.1:9222)
 *   BENCH_URL      app URL                (default https://prabinpebam.github.io/watai/)
 *   BENCH_REPS     repetitions per prompt (default 5)
 *   BENCH_PROMPTS  '|'-separated prompts  (default: short / factual / medium / code)
 *
 * Output: documentation/ttft-browser-bench.{md,json} + a console table.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP = process.env.BENCH_CDP || 'http://127.0.0.1:9222';
const APP_URL = process.env.BENCH_URL || 'https://prabinpebam.github.io/watai/';
const REPS = Number(process.env.BENCH_REPS || 5);
const PROMPTS = (process.env.BENCH_PROMPTS
  ? process.env.BENCH_PROMPTS.split('|')
  : [
      'Hi',
      'What is the capital of France?',
      'Explain how DNS resolution works in 3 sentences.',
      'Write a TypeScript debounce function.',
    ])
  .map((p) => p.trim())
  .filter(Boolean);

const SEL = {
  composer: 'textarea.composer__textarea',
  send: 'button[aria-label="Send"]',
  newChat: 'New chat',
};

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const p95 = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
};
const r0 = (n) => Math.round(n);

// Injected in-page (before app code via addInitScript + reload): hooks fetch to time every API
// call, normalize its path, and capture the bearer token + api base for post-run thread cleanup.
function instrument() {
  if (window.__benchInstalled) return;
  window.__benchInstalled = true;
  window.__bench = { calls: [], token: '', apiBase: '' };
  const norm = (p) => p.replace(/\/[0-9A-Za-z_-]{16,}/g, '/:id').replace(/\?.*$/, '');
  const authOf = (h) => {
    if (!h) return '';
    if (typeof h.get === 'function') return h.get('authorization') || '';
    return h.Authorization || h.authorization || '';
  };
  const of = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const req = args[0];
    const url = typeof req === 'string' ? req : (req && req.url) || '';
    const init = args[1] || {};
    const method = (init.method || (req && req.method) || 'GET').toUpperCase();
    const isApi = /\/api\//.test(url);
    try {
      const auth = authOf(init.headers);
      if (isApi && auth) {
        window.__bench.token = String(auth).replace(/^Bearer\s+/i, '');
        const m = url.match(/^(.*\/api)\//);
        if (m) window.__bench.apiBase = m[1];
      }
    } catch {
      /* noop */
    }
    const t = performance.now();
    const res = await of(...args);
    try {
      if (isApi) {
        const u = new URL(url, location.href);
        window.__bench.calls.push({ label: method + ' ' + norm(u.pathname), ms: performance.now() - t });
      }
    } catch {
      /* noop */
    }
    return res;
  };
  console.log('[bench] instrumentation installed');
}

async function freshChat(page) {
  const nc = page.getByRole('button', { name: SEL.newChat });
  if (await nc.count()) {
    await nc.first().click({ timeout: 5000 }).catch(() => {});
  } else {
    await page.evaluate(() => {
      location.hash = '#/';
    });
  }
  await page.locator(SEL.composer).first().waitFor({ state: 'visible', timeout: 10000 });
}

async function runOne(page, prompt) {
  await freshChat(page);
  const threadId = (page.url().match(/#\/c\/([^/?]+)/) || [])[1] || null;
  await page.evaluate(() => {
    if (window.__bench) window.__bench.calls = [];
  });
  const before = await page.locator('.msg-group--assistant').count();
  await page.fill(SEL.composer, prompt);
  await page.waitForFunction(
    () => {
      const b = document.querySelector('button[aria-label="Send"]');
      return b && !b.disabled;
    },
    null,
    { timeout: 5000 },
  );
  const t0 = performance.now();
  await page.locator(SEL.send).first().click();
  // Wait for a NEW assistant group with non-empty content (avoids reading a stale prior bubble).
  await page.waitForFunction(
    (n) => {
      const g = document.querySelectorAll('.msg-group--assistant');
      if (g.length <= n) return false;
      const md = g[g.length - 1].querySelector('.md');
      return !!md && md.textContent.trim().length > 0;
    },
    before,
    { timeout: 90000 },
  );
  const ttftMs = performance.now() - t0;
  // done = the primary composer button reverts from "Stop generating" to "Send"
  await page.waitForFunction(
    () => {
      const b = document.querySelector('button.composer__primary');
      return b && b.getAttribute('aria-label') === 'Send';
    },
    null,
    { timeout: 180000 },
  );
  const totalMs = performance.now() - t0;
  const calls = await page.evaluate(() => (window.__bench && window.__bench.calls) || []);
  return { ttftMs: r0(ttftMs), totalMs: r0(totalMs), threadId, calls };
}

async function acquire() {
  if (process.env.BENCH_LAUNCH === '1') {
    const userDataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../.bench-edge');
    const ctx = await chromium.launchPersistentContext(userDataDir, {
      channel: 'msedge',
      headless: false,
      viewport: null,
      args: ['--start-maximized'],
    });
    let page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    return { closable: ctx, ctx, page };
  }
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP, { timeout: 6000 });
  } catch (e) {
    console.error(
      `\nCould not attach to Edge at ${CDP}.\nEither (A) quit Edge fully and relaunch with:\n  & "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --remote-debugging-port=9222\n  then open ${APP_URL} (signed in) and re-run; or (B) run with a separate profile:\n  $env:BENCH_LAUNCH=1; node scripts/ttft-bench.mjs\n(${e.message})`,
    );
    process.exit(2);
  }
  const ctx = browser.contexts()[0];
  if (!ctx) {
    console.error('No browser context found over CDP.');
    process.exit(2);
  }
  let page = ctx.pages().find((p) => p.url().includes('/watai'));
  if (!page) {
    page = await ctx.newPage();
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  }
  return { closable: browser, ctx, page };
}

async function main() {
  const { closable, page } = await acquire();
  await page.bringToFront().catch(() => {});
  await page.addInitScript(instrument);
  // Reload so the fetch hook installs BEFORE app code (captures submit/negotiate/poll timings).
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.evaluate(instrument);
  page.on('console', (m) => {
    const t = m.text();
    if (t.startsWith('[bench]')) console.log('  page> ' + t);
  });

  const signedIn = await page
    .locator(SEL.composer)
    .first()
    .waitFor({ state: 'visible', timeout: process.env.BENCH_LAUNCH === '1' ? 120000 : 15000 })
    .then(() => true)
    .catch(() => false);
  if (!signedIn) {
    console.error(`Composer not found at ${page.url()} — sign in and open the chat screen, then re-run.`);
    process.exit(3);
  }

  console.log(`Benchmarking ${PROMPTS.length} prompts x ${REPS} reps against ${page.url()}\n`);
  const rows = [];
  const createdIds = [];
  for (const prompt of PROMPTS) {
    for (let i = 0; i < REPS; i++) {
      try {
        const m = await runOne(page, prompt);
        if (m.threadId) createdIds.push(m.threadId);
        rows.push({ prompt, rep: i + 1, ttftMs: m.ttftMs, totalMs: m.totalMs, calls: m.calls, ok: true });
        console.log(`${prompt.slice(0, 30).padEnd(30)} rep${i + 1}  TTFT ${m.ttftMs}ms  total ${m.totalMs}ms`);
      } catch (e) {
        rows.push({ prompt, rep: i + 1, ttftMs: 0, totalMs: 0, calls: [], ok: false, error: String(e.message || e).slice(0, 140) });
        console.log(`${prompt.slice(0, 30).padEnd(30)} rep${i + 1}  FAILED: ${String(e.message || e).slice(0, 90)}`);
      }
      await page.waitForTimeout(800);
    }
  }

  // Clean up the throwaway benchmark threads via the app's authenticated context.
  const cleanup = await page
    .evaluate(async (ids) => {
      const b = window.__bench || {};
      if (!b.apiBase || !b.token) return { ok: 0, fail: ids.length, reason: 'no token/base captured' };
      let ok = 0, fail = 0;
      for (const id of ids) {
        try {
          const r = await fetch(b.apiBase + '/threads/' + encodeURIComponent(id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + b.token } });
          if (r.ok || r.status === 204 || r.status === 404) ok++; else fail++;
        } catch { fail++; }
      }
      return { ok, fail };
    }, createdIds)
    .catch((e) => ({ ok: 0, fail: createdIds.length, reason: String(e.message || e) }));
  console.log(`\nCleanup: deleted ${cleanup.ok}/${createdIds.length} benchmark threads${cleanup.fail ? ` (${cleanup.fail} failed${cleanup.reason ? ': ' + cleanup.reason : ''})` : ''}.`);

  await closable.close().catch(() => {}); // detaches CDP (leaves your Edge open) / closes the launched profile

  const byPrompt = [...new Set(rows.map((r) => r.prompt))].map((prompt) => {
    const ok = rows.filter((r) => r.prompt === prompt && r.ok);
    const ttft = ok.map((r) => r.ttftMs);
    return {
      prompt,
      n: ok.length,
      ttftMin: Math.min(...(ttft.length ? ttft : [0])),
      ttftMed: r0(median(ttft)),
      ttftP95: r0(p95(ttft)),
      totalMed: r0(median(ok.map((r) => r.totalMs))),
    };
  });

  // Per-endpoint client-side timing across all reps (which API calls dominate the critical path).
  const callAgg = new Map();
  for (const r of rows) for (const c of r.calls || []) {
    if (!callAgg.has(c.label)) callAgg.set(c.label, []);
    callAgg.get(c.label).push(c.ms);
  }
  const endpoints = [...callAgg.entries()]
    .map(([label, xs]) => ({ label, n: xs.length, medMs: r0(median(xs)), p95Ms: r0(p95(xs)) }))
    .sort((a, b) => b.medMs - a.medMs);

  const now = new Date().toISOString();
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../documentation');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'ttft-browser-bench.json'), JSON.stringify({ ranAt: now, url: APP_URL, reps: REPS, byPrompt, endpoints, rows }, null, 2));
  const md = [
    '# TTFT browser benchmark (real Edge session)',
    '',
    `Run: ${now} — ${APP_URL} — ${REPS} reps/prompt. TTFT = send → first assistant token in the DOM.`,
    '',
    '| prompt | n | TTFT min | TTFT median | TTFT p95 | total median |',
    '|--|--|--|--|--|--|',
    ...byPrompt.map((b) => `| ${b.prompt.replace(/\|/g, '/')} | ${b.n} | ${b.ttftMin} | ${b.ttftMed} | ${b.ttftP95} | ${b.totalMed} |`),
    '',
    '### Client-side API calls (median across reps)',
    '',
    '| endpoint | calls | median ms | p95 ms |',
    '|--|--|--|--|',
    ...endpoints.map((e) => `| ${e.label} | ${e.n} | ${e.medMs} | ${e.p95Ms} |`),
    '',
    '_ms unless noted. Per-rep raw data in the sibling .json._',
  ].join('\n');
  writeFileSync(resolve(dir, 'ttft-browser-bench.md'), md + '\n');
  console.log('\nWrote documentation/ttft-browser-bench.{md,json}');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
