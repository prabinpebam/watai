// Audit-only diagnostic. Uses synthetic records and stubs; never contacts a provider or datastore.
const path = require('node:path');

const findings = ['MEM-01', 'MEM-02', 'MEM-04', 'MEM-06', 'MEM-08', 'MEM-11'];
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node memory-probe.cjs [--finding MEM-01]');
  console.log(`Supported findings: ${findings.join(', ')}`);
  console.log('Exit 0 means the diagnostic ran, not that the expected contracts passed.');
  process.exit(0);
}
const findingIndex = args.indexOf('--finding');
const selectedFinding = findingIndex >= 0 ? args[findingIndex + 1] : undefined;
if ((selectedFinding && !findings.includes(selectedFinding)) || (findingIndex >= 0 && !selectedFinding)) {
  console.error(`Choose one of: ${findings.join(', ')}`);
  process.exit(2);
}

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const { buildSync } = require(require.resolve('esbuild', { paths: [path.join(repoRoot, 'api')] }));

const source = `
import { InMemoryMemoryStore } from './api/src/adapters/memory/memoryStore';
import { InProcessRetriever } from './api/src/adapters/memory/inProcessRetriever';
import { MemoryService } from './api/src/application/memoryService';
import { MemoryContextService } from './api/src/application/memoryContextService';
import { MemoryExtractionService } from './api/src/application/memoryExtractionService';
import { buildMemoryProfile } from './api/src/domain/memoryProfile';
import { DEFAULT_SETTINGS } from './api/src/domain/settings';
import { parseMemoryRecord, parseMemoryImport, isRetrievableMemory } from './api/src/domain/memory';
import type { MemoryRetriever } from './api/src/ports/memoryRetriever';

const selectedFinding = ${JSON.stringify(selectedFinding ?? null)};
const now = '2026-09-10T00:00:00Z';
let nextId = 0;
const clock = { now: () => now, newId: () => String(++nextId) };
const input = {
  userId: 'audit-user', threadId: 'audit-thread', latestUserText: 'tea?', now,
  creds: { baseUrl: 'not-used', key: 'synthetic-placeholder' },
};
const settingsReader = { get: async () => DEFAULT_SETTINGS };
const embedder = { model: 'stub-model', embed: async () => [1, 0] };
const record = (over: any = {}) => parseMemoryRecord({
  id: 'm', userId: 'audit-user', text: 'User likes tea.', kind: 'fact', status: 'active',
  confidence: 0.9, salience: 0.7, pinned: false, sensitive: false, visibility: 'normal',
  sourceRefs: [{ type: 'manual', createdAt: now }],
  embedding: [1, 0], embeddingModel: 'stub-model',
  createdAt: now, updatedAt: now, useCount: 0, ...over,
});

const results: Array<Record<string, unknown>> = [];
function report(finding: string, caseId: string, actual: unknown, expected: unknown) {
  results.push({ finding, caseId, actual, expected, contractMet: JSON.stringify(actual) === JSON.stringify(expected) });
}
const enabled = (finding: string) => !selectedFinding || selectedFinding === finding;

async function main() {
  if (enabled('MEM-01')) {
    const store = new InMemoryMemoryStore();
    await store.put(record());
    const paused = {
      ...DEFAULT_SETTINGS,
      personalization: {
        ...DEFAULT_SETTINGS.personalization,
        memory: { ...DEFAULT_SETTINGS.personalization.memory!, paused: true },
      },
    };
    const pausedBlock = await new MemoryContextService(store, { get: async () => paused }, { profile: true }).buildForRun(input);
    report('MEM-01', 'pause-learning-preserves-read', !!pausedBlock.profile, true);
    const failedPolicy = { get: async () => { throw Error('synthetic policy failure'); } };
    const failureBlock = await new MemoryContextService(store, failedPolicy, { profile: true }).buildForRun(input);
    report('MEM-01', 'unknown-policy-prevents-read', !!failureBlock.profile, false);
  }

  if (enabled('MEM-02')) {
    const store = new InMemoryMemoryStore();
    await store.put(record());
    await new MemoryService(store, clock).delete('audit-user', 'm');
    const deleted = await store.get('audit-user', 'm');
    report('MEM-02', 'permanent-delete-removes-payload',
      { textRetained: !!deleted?.text, vectorRetained: !!deleted?.embedding?.length },
      { textRetained: false, vectorRetained: false });
  }

  if (enabled('MEM-04')) {
    const store = new InMemoryMemoryStore();
    const service = new MemoryExtractionService({ memoryStore: store, clock } as any);
    const messages = [{ id: 'u1', role: 'user', content: 'I like tea.', createdAt: now }];
    const add = {
      op: 'add', kind: 'fact', text: 'User prefers tea.', confidence: 0.95, salience: 0.8,
      sourceMessageIds: ['u1'], reason: 'Synthetic duplicate-operation probe.',
    };
    await (service as any).applyOperations('audit-user', 'audit-thread', 'turn', messages, [], { operations: [add, add] });
    report('MEM-04', 'same-batch-add-is-idempotent',
      (await store.list('audit-user')).memories.filter(m => m.text === 'User prefers tea.').length, 1);
    const prior = record({ id: 'changed', text: 'Old tea preference.', embeddingModel: 'old-model' });
    await store.put(prior);
    await (service as any).mergeMemory(prior, [], 0.9, 0.8, 'New coffee preference.', undefined, undefined, undefined,
      { model: 'new-model', embed: async () => { throw Error('synthetic embedding failure'); } });
    const merged = await store.get('audit-user', 'changed');
    report('MEM-04', 'changed-text-does-not-retain-stale-vector',
      !!merged?.embedding?.length && merged.embeddingModel === 'old-model', false);
  }

  if (enabled('MEM-06')) {
    const pinStore = new InMemoryMemoryStore();
    await pinStore.put(record({
      id: 'pinned', pinned: true, embedding: [0.95, Math.sqrt(1 - 0.95 ** 2)],
      salience: 1, confidence: 1, visibility: 'top_of_mind',
    }));
    for (let i = 0; i < 3; i++) await pinStore.put(record({ id: 'relevant-' + i }));
    const retriever = new InProcessRetriever(pinStore);
    const pinBlock = await new MemoryContextService(pinStore, settingsReader, {
      embedder, retriever,
    }).buildForRun(input);
    const broaderCandidates: MemoryRetriever = {
      retrieve: (userId, query, options) => retriever.retrieve(userId, query, { ...options, limit: 4 }),
    };
    const broadBlock = await new MemoryContextService(pinStore, settingsReader, {
      embedder, retriever: broaderCandidates,
    }).buildForRun(input);
    report('MEM-06', 'composite-best-candidate-survives-preselection', {
      currentSelection: pinBlock.memories.some(m => m.id === 'pinned'),
      broaderCandidateControl: broadBlock.memories.some(m => m.id === 'pinned'),
    }, { currentSelection: true, broaderCandidateControl: true });

    const modelStore = new InMemoryMemoryStore();
    await modelStore.put(record({ embeddingModel: 'different-model' }));
    const modelBlock = await new MemoryContextService(modelStore, settingsReader, {
      embedder, retriever: new InProcessRetriever(modelStore),
    }).buildForRun(input);
    report('MEM-06', 'different-model-vectors-are-not-compared', modelBlock.memories.length, 0);

    const manualStore = new InMemoryMemoryStore();
    await new MemoryService(manualStore, clock).createManual('audit-user', { text: 'I like tea.' });
    const learningOff = {
      ...DEFAULT_SETTINGS,
      personalization: {
        ...DEFAULT_SETTINGS.personalization,
        memory: { ...DEFAULT_SETTINGS.personalization.memory!, autoExtract: false, referenceHistory: false },
      },
    };
    const manualBlock = await new MemoryContextService(manualStore, { get: async () => learningOff }, {
      embedder, retriever: new InProcessRetriever(manualStore), profile: true,
    }).buildForRun(input);
    report('MEM-06', 'manual-save-available-with-learning-off',
      !!manualBlock.profile || manualBlock.memories.length > 0, true);
  }

  if (enabled('MEM-08')) {
    const store = new InMemoryMemoryStore();
    await store.put(record());
    const service = new MemoryService(store, clock);
    await service.patch('audit-user', 'm', { status: 'invalidated' });
    const restored = await service.patch('audit-user', 'm', { status: 'active' });
    report('MEM-08', 'restored-memory-is-retrievable', isRetrievableMemory(restored, now), true);
    const profile = buildMemoryProfile('audit-user', now, [record({
      text: 'User name is Maya.',
      route: { layer: 'long_term_profile', profilePath: 'user.details.name', entity: { type: 'user', name: 'Maya' } },
    })]);
    report('MEM-08', 'declared-name-route-is-visible', Object.keys(profile.profile.user.details).length > 0, true);
  }

  if (enabled('MEM-11')) {
    const service = new MemoryService(new InMemoryMemoryStore(), clock);
    await service.createManual('audit-user', { text: 'I like tea.' });
    let accepted = true;
    try { parseMemoryImport({ ...await service.export('audit-user'), mode: 'preview' }); }
    catch { accepted = false; }
    report('MEM-11', 'export-can-be-preview-imported', accepted, true);
  }

  console.log(JSON.stringify({
    auditOnly: true, selectedFinding, results,
    observationCount: results.length,
    unmetContracts: results.filter(r => !r.contractMet).length,
    note: 'Expected values describe recommended/user-facing contracts, not assertions that current code satisfies them.',
  }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
`;

const bundled = buildSync({
  stdin: { contents: source, resolveDir: repoRoot, loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  logLevel: 'silent',
});
new Function('require', bundled.outputFiles[0].text)(require);
