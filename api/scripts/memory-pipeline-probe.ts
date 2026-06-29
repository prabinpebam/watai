/**
 * Isolated memory-pipeline probe (no Functions host, no Cosmos, no app).
 *
 * Runs a labeled corpus through the *real* gate functions + context service and reports whether
 * each prompt traverses the expected path: RETRIEVE / EXTRACT / IGNORE. Captures per-step timing.
 *
 * Run gates-only (no creds):   npx tsx scripts/memory-pipeline-probe.ts
 * Run with live LLM extractor:  set WATAI_PROBE_BASEURL, WATAI_PROBE_KEY, WATAI_PROBE_MODEL first.
 *
 * Output: console table + documentation/memory-system/pipeline-probe-report.md (+ .json).
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MemoryContextService,
  shouldConsiderMemory,
  broadProfileQuery,
  candidateQuery,
  memoryQueryTokens,
} from '../src/application/memoryContextService';
import { hasExtractionSignal } from '../src/application/memoryExtractionService';
import { extractMemories } from '../src/ai/memoryExtractor';
import { InMemoryMemoryStore } from '../src/adapters/memory/memoryStore';
import { parseMemoryRecord } from '../src/domain/memory';

type Label = 'extract' | 'retrieve' | 'ignore';
interface Case { prompt: string; expect: Label; why: string }

// expect = the *primary* expected path. extract = should write memory; retrieve = should pull
// memory into the prompt; ignore = neither. Mixed cases are labeled by their dominant intent.
const CORPUS: Case[] = [
  // ---- EXTRACT: durable facts/preferences/instructions ----
  { prompt: 'Remember that my dog is called Chopper.', expect: 'extract', why: 'explicit remember + pet' },
  { prompt: 'My daughter Laija just turned 9.', expect: 'extract', why: 'profile fact' },
  { prompt: 'From now on always reply in British English.', expect: 'extract', why: 'standing instruction' },
  { prompt: 'I prefer concise answers without preamble.', expect: 'extract', why: 'preference' },
  { prompt: 'We deploy watai to resource group rg-watai-dev.', expect: 'extract', why: 'project context' },
  { prompt: 'Never use emojis in your responses.', expect: 'extract', why: 'avoidance' },
  { prompt: 'I work as a staff engineer at a fintech.', expect: 'extract', why: 'profile fact, no my-keyword' },
  { prompt: 'Going forward, default Python examples to 3.12.', expect: 'extract', why: 'standing pref, no regex hit' },
  { prompt: "Call me Sam, not Samuel.", expect: 'extract', why: 'naming pref, no regex hit' },
  { prompt: 'I am allergic to peanuts, keep that in mind.', expect: 'extract', why: 'durable fact, no regex hit' },
  // ---- RETRIEVE: should pull existing memory ----
  { prompt: "What's my dog's name?", expect: 'retrieve', why: 'asks stored pet' },
  { prompt: 'What do you know about me?', expect: 'retrieve', why: 'broad profile' },
  { prompt: 'Which resource group do we deploy watai to?', expect: 'retrieve', why: 'stored project fact' },
  { prompt: 'How old is my daughter?', expect: 'retrieve', why: 'stored family fact' },
  { prompt: 'Use my usual writing style for this email.', expect: 'retrieve', why: 'stored preference' },
  { prompt: 'What was the deploy target again?', expect: 'retrieve', why: 'deploy keyword, no my' },
  { prompt: 'Summarize me in one line.', expect: 'retrieve', why: 'profile recall, no regex hit' },
  // ---- IGNORE: transient, no memory action ----
  { prompt: 'What is the capital of France?', expect: 'ignore', why: 'general knowledge' },
  { prompt: 'Translate "good morning" to Japanese.', expect: 'ignore', why: 'one-off task' },
  { prompt: 'Write a haiku about rain.', expect: 'ignore', why: 'creative one-off' },
  { prompt: 'Fix this bug: TypeError on line 4.', expect: 'ignore', why: 'transient task' },
  { prompt: 'I prefer the second option for this layout.', expect: 'ignore', why: 'has prefer but transient' },
  { prompt: 'Always sort this list alphabetically.', expect: 'ignore', why: 'always but one-off scope' },
];

const SEED = [
  { kind: 'fact', text: 'User has a dog named Chopper.', entities: ['Chopper'], salience: 0.8 },
  { kind: 'fact', text: 'User has a daughter named Laija who is 9.', entities: ['Laija'], salience: 0.85 },
  { kind: 'project_context', text: 'Watai deploys to resource group rg-watai-dev.', entities: ['watai'], salience: 0.7 },
  { kind: 'preference', text: 'User prefers concise answers.', entities: [], salience: 0.6 },
] as const;

function ms(start: bigint): number { return Number(process.hrtime.bigint() - start) / 1e6; }

async function main() {
  const store = new InMemoryMemoryStore();
  const now = new Date().toISOString();
  for (let i = 0; i < SEED.length; i++) {
    await store.put(parseMemoryRecord({
      id: `m${i}`, userId: 'u', kind: SEED[i].kind, status: 'active', text: SEED[i].text,
      entities: [...SEED[i].entities], sourceRefs: [{ type: 'manual', createdAt: now }],
      confidence: 0.9, salience: SEED[i].salience, pinned: false, sensitive: false,
      visibility: 'normal', createdAt: now, updatedAt: now, useCount: 0,
    }));
  }
  const ctx = new MemoryContextService(store, { get: async () => { throw new Error('no settings'); } });
  const live = process.env.WATAI_PROBE_BASEURL && process.env.WATAI_PROBE_KEY;
  const creds = { baseUrl: process.env.WATAI_PROBE_BASEURL ?? '', key: process.env.WATAI_PROBE_KEY ?? '', models: { chat: process.env.WATAI_PROBE_MODEL ?? 'gpt-5.4' } };

  const rows = [] as Array<Record<string, unknown>>;
  for (const c of CORPUS) {
    const t0 = process.hrtime.bigint(); const q = memoryQueryTokens(c.prompt); const tok = ms(t0);
    const t1 = process.hrtime.bigint(); const ext = hasExtractionSignal(c.prompt); const extMs = ms(t1);
    const t2 = process.hrtime.bigint(); const ret = shouldConsiderMemory(c.prompt, q); const retMs = ms(t2);
    candidateQuery(c.prompt, q); broadProfileQuery(c.prompt);
    const t3 = process.hrtime.bigint();
    const block = await ctx.buildForRun({ userId: 'u', threadId: 't', latestUserText: c.prompt, now });
    const buildMs = ms(t3);
    const path = ext ? 'extract' : ret ? 'retrieve' : 'ignore';
    let llm = ''; let llmMs = 0;
    if (live) {
      const t4 = process.hrtime.bigint();
      try {
        const out = await extractMemories(creds, { mode: 'turn', now, threadId: 't', messages: [{ id: 'x', role: 'user', content: c.prompt, createdAt: now }], existingMemories: [] }, { model: creds.models.chat });
        llm = out.operations.map((o) => o.op).join(',');
      } catch (e) { llm = `err:${e instanceof Error ? e.message.slice(0, 30) : 'x'}`; }
      llmMs = ms(t4);
    }
    rows.push({ prompt: c.prompt, expect: c.expect, path, ok: path === c.expect, extGate: ext, retGate: ret, mems: block.memories.length, tok: tok.toFixed(3), extMs: extMs.toFixed(3), retMs: retMs.toFixed(3), buildMs: buildMs.toFixed(2), llm, llmMs: llmMs.toFixed(0) });
  }

  const ok = rows.filter((r) => r.ok).length;
  console.table(rows.map((r) => ({ expect: r.expect, path: r.path, ok: r.ok, mems: r.mems, prompt: String(r.prompt).slice(0, 42) })));
  console.log(`Regex gate accuracy: ${ok}/${rows.length}`);

  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../documentation/memory-system');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'pipeline-probe-report.json'), JSON.stringify({ ranAt: now, live: !!live, accuracy: `${ok}/${rows.length}`, rows }, null, 2));
  const md = ['# Memory pipeline probe', '', `Run: ${now} — live LLM: ${!!live} — gate accuracy ${ok}/${rows.length}`, '', 'Gates are independent in the app: extraction (`hasExtractionSignal`) and retrieval (`shouldConsiderMemory`) both fire. `path` shows extract-first only for a single label.', '', '| expect | path | ok | extGate | retGate | mems | tok(ms) | ext(ms) | ret(ms) | build(ms) | llm | llm(ms) | prompt |', '|--|--|--|--|--|--|--|--|--|--|--|--|--|', ...rows.map((r) => `| ${r.expect} | ${r.path} | ${r.ok ? 'Y' : 'N'} | ${r.extGate ? 'Y' : 'N'} | ${r.retGate ? 'Y' : 'N'} | ${r.mems} | ${r.tok} | ${r.extMs} | ${r.retMs} | ${r.buildMs} | ${r.llm} | ${r.llmMs} | ${String(r.prompt).replace(/\|/g, '/')} |`)].join('\n');
  writeFileSync(resolve(dir, 'pipeline-probe-report.md'), md + '\n');
  console.log('Wrote report to documentation/memory-system/pipeline-probe-report.{md,json}');
}

main().catch((e) => { console.error(e); process.exit(1); });
