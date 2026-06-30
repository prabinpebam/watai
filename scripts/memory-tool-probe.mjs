/**
 * Memory + tool-calling behavior probe for Watai — drives YOUR signed-in Edge via CDP and reports,
 * per prompt, whether the response triggered web_search (citations), pulled memory (the relevance
 * "memory used" card), or wrote memory ("memory updated"). No timing — this is about CORRECTNESS:
 * is web_search firing on prompts the model already knows, and is memory surfacing when irrelevant?
 *
 * Setup is identical to scripts/ttft-bench.mjs (CDP attach to Edge on :9222, signed in).
 *   node scripts/memory-tool-probe.mjs
 *
 * Config:
 *   PROBE_CDP      CDP endpoint          (default http://127.0.0.1:9222)
 *   PROBE_URL      app URL               (default https://prabinpebam.github.io/watai/)
 *   PROBE_PROMPTS  '|'-separated prompts (default: 3 known-answer + 1 genuinely-current + 1 self-ref)
 *
 * Each created thread is deleted at the end (same as the bench harness).
 */
import { chromium } from 'playwright';

const CDP = process.env.PROBE_CDP || 'http://127.0.0.1:9222';
const APP_URL = process.env.PROBE_URL || 'https://prabinpebam.github.io/watai/';
const PROMPTS = (process.env.PROBE_PROMPTS
  ? process.env.PROBE_PROMPTS.split('|')
  : [
      'What is the capital of France?', // known fact — should NOT need web_search
      'Explain how DNS resolution works in 3 sentences.', // known — should NOT need web_search
      'What is 17 * 23?', // arithmetic — should NOT need web_search
      'What are the most significant AI model releases announced this week?', // genuinely current — SHOULD web_search
      'What do you know about me?', // self-referential — memory/profile may surface (gate should open)
    ])
  .map((p) => p.trim())
  .filter(Boolean);

const SEL = { composer: 'textarea.composer__textarea', send: 'button[aria-label="Send"]', newChat: 'New chat' };

function instrument() {
  if (window.__probeInstalled) return;
  window.__probeInstalled = true;
  window.__probe = { token: '', apiBase: '' };
  const of = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const req = args[0];
    const url = typeof req === 'string' ? req : (req && req.url) || '';
    const init = args[1] || {};
    try {
      const h = init.headers;
      const auth = h && (typeof h.get === 'function' ? h.get('authorization') : h.Authorization || h.authorization);
      if (/\/api\//.test(url) && auth) {
        window.__probe.token = String(auth).replace(/^Bearer\s+/i, '');
        const m = url.match(/^(.*\/api)\//);
        if (m) window.__probe.apiBase = m[1];
      }
    } catch {
      /* noop */
    }
    return of(...args);
  };
}

async function freshChat(page) {
  const nc = page.getByRole('button', { name: SEL.newChat });
  if (await nc.count()) await nc.first().click({ timeout: 5000 }).catch(() => {});
  else await page.evaluate(() => (location.hash = '#/'));
  await page.locator(SEL.composer).first().waitFor({ state: 'visible', timeout: 10000 });
}

async function probeOne(page, prompt) {
  await freshChat(page);
  const threadId = (page.url().match(/#\/c\/([^/?]+)/) || [])[1] || null;
  const before = await page.locator('.msg-group--assistant').count();
  await page.fill(SEL.composer, prompt);
  await page.waitForFunction(() => {
    const b = document.querySelector('button[aria-label="Send"]');
    return b && !b.disabled;
  }, null, { timeout: 5000 });
  await page.locator(SEL.send).first().click();
  // Wait for a NEW assistant group with content, then for the run to finish (button reverts to Send).
  await page.waitForFunction((n) => {
    const g = document.querySelectorAll('.msg-group--assistant');
    if (g.length <= n) return false;
    const md = g[g.length - 1].querySelector('.md');
    return !!md && md.textContent.trim().length > 0;
  }, before, { timeout: 90000 });
  await page.waitForFunction(() => {
    const b = document.querySelector('button.composer__primary');
    return b && b.getAttribute('aria-label') === 'Send';
  }, null, { timeout: 180000 });
  // Give the post-run reconcile a moment to attach citations/memoryRefs to the rendered message.
  await page.waitForTimeout(1200);
  const signals = await page.evaluate(() => {
    const groups = document.querySelectorAll('.msg-group--assistant');
    const g = groups[groups.length - 1];
    if (!g) return { webSearch: false, memoryUsed: false, memoryUpdated: false, text: '' };
    const labels = [...g.querySelectorAll('.sources__toggle-label')].map((e) => e.textContent.trim());
    const memoryUsed = labels.some((t) => /memor(y|ies)\s+used/i.test(t)) || !!g.querySelector('.source-chip--memory');
    const webSearch =
      labels.some((t) => /source/i.test(t)) ||
      !!g.querySelector('.source-chip--bing') ||
      /searched the web/i.test(g.textContent || '');
    const memoryUpdated = !!g.querySelector('.assistant__memory-note');
    const text = (g.querySelector('.md')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    return { webSearch, memoryUsed, memoryUpdated, text };
  });
  return { threadId, ...signals };
}

async function main() {
  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP, { timeout: 6000 });
  } catch (e) {
    console.error(`Could not attach to Edge at ${CDP}. Launch Edge with --remote-debugging-port=9222 (signed in) and re-run. (${e.message})`);
    process.exit(2);
  }
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => p.url().includes('/watai')) || (await ctx.newPage());
  await page.bringToFront().catch(() => {});
  await page.addInitScript(instrument);
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.evaluate(instrument);
  const signedIn = await page
    .locator(SEL.composer)
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!signedIn) {
    console.error(`Composer not found at ${page.url()} — sign in and open the chat screen, then re-run.`);
    process.exit(3);
  }

  console.log(`Probing memory + tool behavior against ${page.url()}\n`);
  console.log('prompt'.padEnd(58) + 'web_search  memory_used  memory_updated');
  const createdIds = [];
  const rows = [];
  for (const prompt of PROMPTS) {
    try {
      const r = await probeOne(page, prompt);
      if (r.threadId) createdIds.push(r.threadId);
      rows.push({ prompt, ...r });
      const yn = (b) => (b ? 'YES' : ' . ');
      console.log(prompt.slice(0, 56).padEnd(58) + `   ${yn(r.webSearch)}        ${yn(r.memoryUsed)}         ${yn(r.memoryUpdated)}`);
      console.log('    -> ' + r.text);
    } catch (e) {
      console.log(prompt.slice(0, 56).padEnd(58) + `   FAILED: ${String(e.message || e).slice(0, 60)}`);
    }
  }

  const cleanup = await page
    .evaluate(async (ids) => {
      const b = window.__probe || {};
      if (!b.apiBase || !b.token) return { ok: 0, fail: ids.length };
      let ok = 0, fail = 0;
      for (const id of ids) {
        try {
          const r = await fetch(b.apiBase + '/threads/' + encodeURIComponent(id), { method: 'DELETE', headers: { Authorization: 'Bearer ' + b.token } });
          if (r.ok || r.status === 204 || r.status === 404) ok++; else fail++;
        } catch { fail++; }
      }
      return { ok, fail };
    }, createdIds)
    .catch(() => ({ ok: 0, fail: createdIds.length }));
  console.log(`\nCleanup: deleted ${cleanup.ok}/${createdIds.length} probe threads.`);
  await browser.close().catch(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
