import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(root, 'test-results/local-persistence');
await mkdir(output, { recursive: true });
const evidence = { startedAt: new Date().toISOString(), stages: [], external: [], errors: [], passed: false };
const server = await createServer({ root, configFile: false,
  optimizeDeps: { entries: ['src/data/local/localRepository.ts'] },
  plugins: [{ name: 'isolated-local-persistence', configureServer(instance) {
    instance.middlewares.use((request, response, next) => {
      if (request.url !== '/persistence') return next();
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><head><title>Local persistence canary</title></head><body></body></html>');
    });
  } }], server: { host: '127.0.0.1', port: 4177, strictPort: true } });
let browser;
let deadline;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  deadline = setTimeout(() => { void browser.close(); }, 60_000);
  const context = await browser.newContext();
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4177') { evidence.external.push(url.origin); return route.abort(); }
    return route.continue();
  });
  const first = await context.newPage();
  const second = await context.newPage();
  for (const page of [first, second]) {
    page.on('pageerror', error => evidence.errors.push(error.name));
    await page.goto('http://127.0.0.1:4177/persistence', { waitUntil: 'domcontentloaded', timeout: 15_000 });
    await page.evaluate(async () => {
      const { LocalRepository } = await import('/src/data/local/localRepository.ts');
      window.localCanary = new LocalRepository('isolated-persistence-canary');
    });
  }
  const snapshot = (page, threadId) => page.evaluate(async id => {
    const thread = await window.localCanary.getThread(id);
    const messages = await window.localCanary.listMessages(id);
    const operations = await window.localCanary.listOutbox();
    return { count: thread?.messageCount, messageIds: messages.map(message => message.id).sort(),
      operationIds: operations.filter(operation => operation.threadId === id).map(operation => operation.operationId).sort() };
  }, threadId);
  const append = (page, threadId, id, operationId) => page.evaluate(async input => {
    await window.localCanary.appendMessageWithOutbox({ id: input.id, threadId: input.threadId, role: 'user',
      content: 'Synthetic persistence fixture', createdAt: '2026-01-01T00:00:00Z', status: 'complete' },
    { operationId: input.operationId, threadId: input.threadId, id: input.id, kind: 'message.append' });
  }, { threadId, id, operationId });
  await first.evaluate(() => window.localCanary.createThread({ id: 'baseline', title: 'Baseline' }));
  await append(first, 'baseline', 'baseline-message', 'baseline-operation');
  const baseline = await snapshot(second, 'baseline');
  evidence.stages.push({ name: 'baseline-cross-page', ...baseline });
  assert.deepEqual(baseline, { count: 1, messageIds: ['baseline-message'], operationIds: ['baseline-operation'] });
  await first.evaluate(() => window.localCanary.createThread({ id: 'concurrent', title: 'Concurrent' }));
  await Promise.all([append(first, 'concurrent', 'one', 'one-op'), append(second, 'concurrent', 'two', 'two-op')]);
  const concurrent = await snapshot(first, 'concurrent');
  evidence.stages.push({ name: 'concurrent-distinct', ...concurrent });
  assert.deepEqual(concurrent, { count: 2, messageIds: ['one', 'two'], operationIds: ['one-op', 'two-op'] });
  await first.evaluate(() => window.localCanary.createThread({ id: 'replay', title: 'Replay' }));
  await Promise.all([append(first, 'replay', 'same', 'replay-one'), append(second, 'replay', 'same', 'replay-two')]);
  const replay = await snapshot(second, 'replay');
  evidence.stages.push({ name: 'same-id-replay', ...replay });
  assert.deepEqual(replay, { count: 1, messageIds: ['same'], operationIds: ['replay-one', 'replay-two'] });
  await first.evaluate(() => window.localCanary.createThread({ id: 'rollback', title: 'Rollback' }));
  const failure = await first.evaluate(async () => {
    try {
      await window.localCanary.appendMessageWithOutbox({ id: 'must-not-exist', threadId: 'rollback', role: 'user',
        content: 'Synthetic failed write', createdAt: '2026-01-01T00:00:00Z', status: 'complete' },
      { operationId: 'uncloneable', threadId: 'rollback', kind: 'message.append', invalid: () => {} });
      return 'unexpected-success';
    } catch (error) { return error.name; }
  });
  const rollback = await snapshot(second, 'rollback');
  evidence.stages.push({ name: 'synchronous-clone-failure', failure, ...rollback });
  assert.equal(failure, 'DataCloneError');
  assert.deepEqual(rollback, { count: 0, messageIds: [], operationIds: [] });
  const rollbackCases = [];
  for (const action of ['create', 'update', 'settings', 'mutate', 'delete']) {
    const observed = await first.evaluate(async operation => {
      const { LocalRepository } = await import('/src/data/local/localRepository.ts');
      const local = new LocalRepository(`isolated-rollback-${operation}`);
      await local.createThread({ id: 'thread', title: 'Original' });
      await local.appendMessage({ id: 'retained-message', threadId: 'thread', role: 'user', content: 'Synthetic retained fixture',
        createdAt: '2026-01-01T00:00:00Z', status: 'complete' });
      const settings = await local.getSettings();
      await local.saveSettings({ ...settings, appearance: { ...settings.appearance, theme: 'light' } });
      await local.mutateOutbox(() => [{ operationId: 'retained', kind: 'thread.update', id: 'thread' }]);
      const invalid = { operationId: 'invalid', kind: 'thread.update', id: 'thread', uncloneable: () => {} };
      let failure = 'unexpected-success';
      try {
        if (operation === 'create') await local.createThreadWithOutbox({ id: 'new-thread', title: 'New' }, invalid);
        if (operation === 'update') await local.updateThreadWithOutbox('thread', { title: 'Changed' }, invalid);
        if (operation === 'settings') await local.saveSettingsWithOutbox({ ...settings, appearance: { ...settings.appearance, theme: 'dark' } }, invalid);
        if (operation === 'mutate') await local.mutateOutbox(() => [{ operationId: 'replacement', kind: 'thread.update', id: 'thread' }, invalid]);
        if (operation === 'delete') await local.deleteThreadWithOutbox('thread', { ...invalid, kind: 'thread.delete' });
      } catch (error) { failure = error.name; }
      return { failure, title: (await local.getThread('thread'))?.title,
        count: (await local.getThread('thread'))?.messageCount, newThread: !!(await local.getThread('new-thread')),
        messageIds: (await local.listMessages('thread')).map(message => message.id),
        operationIds: (await local.listOutbox()).map(record => record.operationId), theme: (await local.getSettings()).appearance.theme };
    }, action);
    const expected = { failure: 'DataCloneError', title: 'Original', count: 1, newThread: false,
      messageIds: ['retained-message'], operationIds: ['retained'], theme: 'light' };
    rollbackCases.push({ action, observed, expected });
    evidence.stages.push({ name: `rollback-${action}`, ...observed });
  }
  const mismatches = rollbackCases.filter(({ observed, expected }) => JSON.stringify(observed) !== JSON.stringify(expected));
  assert.deepEqual(mismatches, [], 'Local transactional helpers committed partial state after failure');
  assert.deepEqual(evidence.external, []);
  assert.deepEqual(evidence.errors, []);
  evidence.passed = true;
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  clearTimeout(deadline);
  try { await writeFile(resolve(output, `evidence-${Date.now()}.json`), JSON.stringify(evidence, null, 2)); }
  finally { await browser?.close(); await server.close(); }
}