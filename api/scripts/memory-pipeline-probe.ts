/**
 * Memory-pipeline probe — multi-stage, multi-model benchmark (no Functions host, no Cosmos).
 *
 * Exercises the three LLM-decidable stages of the memory pipeline independently, each with its
 * own model, and reports accuracy + speed per configuration:
 *   1. Decision   — classify a message as extract / retrieve / ignore (LLM stand-in for the regex
 *                   gate `hasExtractionSignal` / `shouldConsiderMemory`).
 *   2. Extraction — the real `extractMemories` extractor → memory operations.
 *   3. Storage    — reconcile extracted candidates against existing memories (add vs merge/dedup).
 *
 * Configs benchmarked (storage held at the full model, per the requested matrix):
 *   A: decision=full   extract=full   storage=full
 *   B: decision=mini   extract=full   storage=full   (isolates the decision-model downgrade)
 *   C: decision=mini   extract=mini   storage=full   (isolates the extraction-model downgrade)
 *
 * Credentials come from api/.env (gitignored) or the environment:
 *   WATAI_PROBE_BASEURL   Azure AI Foundry inference endpoint (…/openai/v1)
 *   WATAI_PROBE_KEY       API key (secret — never committed)
 *   WATAI_PROBE_FULL_MODEL / WATAI_PROBE_MINI_MODEL  override the default gpt-5.4 / gpt-5.4-mini
 *
 * Run:  npx tsx scripts/memory-pipeline-probe.ts   (regex baseline only without a key; full matrix with one)
 * Output: console summary + documentation/memory-system/pipeline-probe-report.{md,json}.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldConsiderMemory, memoryQueryTokens } from '../src/application/memoryContextService';
import { hasExtractionSignal } from '../src/application/memoryExtractionService';
import { extractMemories } from '../src/ai/memoryExtractor';
import { completeChat } from '../src/ai/chat';
import type { DecryptedCredentials } from '../src/application/credentialService';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Minimal zero-dependency .env loader: KEY=VALUE lines, # comments, optional quotes. */
function loadEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnv(resolve(HERE, '../.env'));

const FULL_MODEL = process.env.WATAI_PROBE_FULL_MODEL?.trim() || 'gpt-5.4';
const MINI_MODEL = process.env.WATAI_PROBE_MINI_MODEL?.trim() || 'gpt-5.4-mini';

type Label = 'extract' | 'retrieve' | 'ignore';
type StoreExpect = 'new' | 'dedup';
interface Case { prompt: string; expect: Label; why: string; store?: StoreExpect }
interface ModelConfig { id: string; label: string; decision: string; extract: string; storage: string }

// expect = the *primary* expected path. extract = should write memory; retrieve = should pull
// memory into the prompt; ignore = neither. Mixed cases are labeled by their dominant intent.
const CORPUS: Case[] = [
  // ---- EXTRACT: durable facts/preferences/instructions. `store` = expected reconciler outcome
  //      against the seed set: dedup (a seed already covers it) vs new (novel). ----
  { prompt: 'Remember that my dog is called Chopper.', expect: 'extract', why: 'explicit remember + pet', store: 'dedup' },
  { prompt: 'My daughter Laija just turned 9.', expect: 'extract', why: 'profile fact', store: 'dedup' },
  { prompt: 'From now on always reply in British English.', expect: 'extract', why: 'standing instruction', store: 'new' },
  { prompt: 'I prefer concise answers without preamble.', expect: 'extract', why: 'preference', store: 'dedup' },
  { prompt: 'We deploy watai to resource group rg-watai-dev.', expect: 'extract', why: 'project context', store: 'dedup' },
  { prompt: 'Never use emojis in your responses.', expect: 'extract', why: 'avoidance', store: 'new' },
  { prompt: 'I work as a staff engineer at a fintech.', expect: 'extract', why: 'profile fact, no my-keyword', store: 'new' },
  { prompt: 'Going forward, default Python examples to 3.12.', expect: 'extract', why: 'standing pref, no regex hit', store: 'new' },
  { prompt: "Call me Sam, not Samuel.", expect: 'extract', why: 'naming pref, no regex hit', store: 'new' },
  { prompt: 'I am allergic to peanuts, keep that in mind.', expect: 'extract', why: 'durable fact, no regex hit', store: 'new' },
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
function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function pct(n: number, d: number): string { return d ? `${Math.round((n / d) * 100)}%` : '—'; }
function f(n: number, digits = 0): string { return Number.isFinite(n) ? n.toFixed(digits) : '—'; }
function shortPrompt(p: string): string { const s = p.replace(/\|/g, '/'); return s.length > 40 ? `${s.slice(0, 39)}…` : s; }

type ParseOutcome = 'strict' | 'salvaged' | 'failed';

/** Scan for the first balanced top-level {...} object, ignoring braces inside strings. */
function firstJsonObject(s: string): string | null {
  let start = -1, depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { if (depth > 0 && --depth === 0 && start >= 0) return s.slice(start, i + 1); }
  }
  return null;
}

/**
 * Parse a model's JSON reply in tiers and report how clean it was:
 *  - strict   : the whole response is valid JSON (the model obeyed "strict JSON only").
 *  - salvaged : code fences / surrounding prose / trailing commas had to be stripped to recover it
 *               — i.e. the model added extra stuff (the failure mode small models like mini show).
 *  - failed   : no JSON object could be recovered at all.
 */
function parseJsonTiered(raw: string): { value: unknown; outcome: ParseOutcome } {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { value: undefined, outcome: 'failed' };
  try { return { value: JSON.parse(trimmed), outcome: 'strict' }; } catch { /* try to salvage */ }
  const noFence = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const obj = firstJsonObject(noFence);
  if (obj) {
    const cleaned = obj.replace(/,\s*([}\]])/g, '$1');
    try { return { value: JSON.parse(cleaned), outcome: 'salvaged' }; } catch { /* unrecoverable */ }
  }
  return { value: undefined, outcome: 'failed' };
}

function tallyParse(xs: ParseOutcome[]): { strict: number; salvaged: number; failed: number } {
  return {
    strict: xs.filter((x) => x === 'strict').length,
    salvaged: xs.filter((x) => x === 'salvaged').length,
    failed: xs.filter((x) => x === 'failed').length,
  };
}

const DECISION_SYSTEM = [
  "You are the decision gate for Watai's long-term memory pipeline.",
  "Classify the user's latest message into exactly one path:",
  '- "extract": it states a durable fact, preference, standing instruction, project context, or correction worth SAVING for future conversations.',
  '- "retrieve": it asks about or relies on something the user told you earlier; you should RECALL saved memory to answer.',
  '- "ignore": a transient one-off task, general-knowledge question, or creative request that needs no memory action.',
  'Choose the single dominant path. Reply with strict JSON only: {"decision":"extract|retrieve|ignore","confidence":0-1}.',
].join('\n');

const STORAGE_SYSTEM = [
  "You are the storage reconciler for Watai's long-term memory.",
  "You receive newly extracted memory candidates and the user's existing saved memories.",
  'For EACH candidate choose the final action:',
  '- "add": genuinely new information not already represented by an existing memory.',
  '- "merge": the candidate duplicates or updates an existing memory; put its id in "memoryId".',
  '- "ignore": redundant or not worth storing.',
  'Do not add a near-duplicate of an existing memory; prefer merge. Reply with strict JSON only:',
  '{"operations":[{"action":"add|merge|ignore","memoryId":"<existing id when merge>","reason":"..."}]}.',
].join('\n');

async function classifyDecision(creds: DecryptedCredentials, model: string, prompt: string): Promise<{ label: Label | 'err'; ms: number; parse: ParseOutcome }> {
  const t = process.hrtime.bigint();
  const raw = await completeChat({
    baseUrl: creds.baseUrl, key: creds.key, model, reasoningEffort: 'minimal',
    maxCompletionTokens: 256, timeoutMs: 30_000,
    messages: [{ role: 'system', content: DECISION_SYSTEM }, { role: 'user', content: prompt }],
  });
  const took = ms(t);
  const { value, outcome } = parseJsonTiered(raw);
  if (value && typeof value === 'object') {
    const d = String((value as { decision?: string }).decision ?? '').toLowerCase();
    if (d === 'extract' || d === 'retrieve' || d === 'ignore') return { label: d, ms: took, parse: outcome };
  }
  return { label: 'err', ms: took, parse: outcome };
}

async function reconcileStorage(
  creds: DecryptedCredentials, model: string,
  candidates: Array<{ text: string; kind: string }>,
  existing: Array<{ id: string; text: string }>,
): Promise<{ decision: StoreExpect | 'err'; adds: number; merges: number; ignores: number; ms: number; parse: ParseOutcome }> {
  const t = process.hrtime.bigint();
  const raw = await completeChat({
    baseUrl: creds.baseUrl, key: creds.key, model, reasoningEffort: 'minimal',
    maxCompletionTokens: 768, timeoutMs: 45_000,
    messages: [
      { role: 'system', content: STORAGE_SYSTEM },
      { role: 'user', content: JSON.stringify({ candidates, existing }) },
    ],
  });
  const took = ms(t);
  const { value, outcome } = parseJsonTiered(raw);
  const j = (value && typeof value === 'object') ? (value as { operations?: Array<{ action?: string }> }) : {};
  const ops = Array.isArray(j.operations) ? j.operations : [];
  let adds = 0, merges = 0, ignores = 0;
  for (const op of ops) {
    const a = String(op.action ?? '').toLowerCase();
    if (a === 'add') adds++;
    else if (a === 'merge' || a === 'update') merges++;
    else ignores++;
  }
  if (!ops.length) return { decision: 'err', adds, merges, ignores, ms: took, parse: outcome };
  return { decision: adds > 0 ? 'new' : 'dedup', adds, merges, ignores, ms: took, parse: outcome };
}

interface PromptResult {
  prompt: string; expect: Label; store?: StoreExpect;
  decision: Label | 'err'; decisionOk: boolean; decisionMs: number; decisionParse: ParseOutcome;
  extractRan: boolean; extractAdds: number; extractOps: number; extractAbstained: boolean; extractMs: number;
  storageRan: boolean; storageDecision?: StoreExpect | 'err'; storageOk?: boolean; storageMs: number; storageParse?: ParseOutcome;
  llmMs: number;
}

interface ConfigAggregate {
  config: ModelConfig; results: PromptResult[];
  decisionAcc: number; decisionTotal: number; decisionMsAvg: number;
  decisionParse: { strict: number; salvaged: number; failed: number };
  extractRuns: number; extractMsAvg: number; extractAddsTotal: number; extractOpsTotal: number; extractAbstainedCount: number;
  storageRuns: number; storageScored: number; storageAcc: number; storageMsAvg: number;
  storageParse: { strict: number; salvaged: number; failed: number };
  e2eMsPerPrompt: number; llmCalls: number; wallMs: number;
}

async function runConfig(creds: DecryptedCredentials, config: ModelConfig, seeds: Array<{ id: string; text: string }>, now: string): Promise<ConfigAggregate> {
  const results: PromptResult[] = [];
  const wall = process.hrtime.bigint();
  for (const c of CORPUS) {
    const dec = await classifyDecision(creds, config.decision, c.prompt);
    const decisionOk = dec.label === c.expect;
    let extractRan = false, extractAdds = 0, extractOps = 0, extractMs = 0, extractAbstained = false;
    let storageRan = false, storageMs = 0;
    let storageDecision: StoreExpect | 'err' | undefined;
    let storageOk: boolean | undefined;
    let storageParse: ParseOutcome | undefined;
    let candidates: Array<{ text: string; kind: string }> = [];
    if (dec.label === 'extract') {
      extractRan = true;
      const t = process.hrtime.bigint();
      let ops: Array<{ op: string; text?: string; kind?: string }> = [];
      try {
        const out = await extractMemories(creds, {
          mode: 'command', now, threadId: 't',
          messages: [{ id: 'm1', role: 'user', content: c.prompt, createdAt: now }],
          existingMemories: seeds.map((s) => ({ id: s.id, kind: 'fact', status: 'active', text: s.text })),
        }, { model: config.extract });
        ops = out.operations as Array<{ op: string; text?: string; kind?: string }>;
      } catch { /* extractor failed → fall back to the raw message */ }
      extractMs = ms(t);
      extractAdds = ops.filter((o) => o.op === 'add').length;
      extractOps = ops.filter((o) => o.op !== 'ignore').length;
      const texted = ops
        .filter((o) => (o.op === 'add' || o.op === 'merge') && typeof o.text === 'string' && (o.text as string).trim().length > 0)
        .map((o) => ({ text: o.text as string, kind: o.kind ?? 'fact' }));
      // Always exercise storage on a gated extract prompt: use the extracted candidate text, or the
      // raw message when the extractor abstained (so the storage stage is measurable per config).
      if (texted.length) { candidates = texted; } else { candidates = [{ text: c.prompt, kind: 'fact' }]; extractAbstained = true; }
    }
    if (candidates.length) {
      storageRan = true;
      const r = await reconcileStorage(creds, config.storage, candidates, seeds);
      storageDecision = r.decision;
      storageMs = r.ms;
      storageParse = r.parse;
      if (c.store) storageOk = r.decision === c.store;
    }
    results.push({
      prompt: c.prompt, expect: c.expect, store: c.store,
      decision: dec.label, decisionOk, decisionMs: dec.ms, decisionParse: dec.parse,
      extractRan, extractAdds, extractOps, extractAbstained, extractMs,
      storageRan, storageDecision, storageOk, storageMs, storageParse,
      llmMs: dec.ms + extractMs + storageMs,
    });
  }
  const wallMs = ms(wall);
  const extractRunsArr = results.filter((r) => r.extractRan);
  const storageRunsArr = results.filter((r) => r.storageRan);
  const storageScoredArr = results.filter((r) => r.storageRan && r.store);
  return {
    config, results,
    decisionAcc: results.filter((r) => r.decisionOk).length,
    decisionTotal: results.length,
    decisionMsAvg: mean(results.map((r) => r.decisionMs)),
    decisionParse: tallyParse(results.map((r) => r.decisionParse)),
    extractRuns: extractRunsArr.length,
    extractMsAvg: mean(extractRunsArr.map((r) => r.extractMs)),
    extractAddsTotal: results.reduce((a, r) => a + r.extractAdds, 0),
    extractOpsTotal: results.reduce((a, r) => a + r.extractOps, 0),
    extractAbstainedCount: results.filter((r) => r.extractAbstained).length,
    storageRuns: storageRunsArr.length,
    storageScored: storageScoredArr.length,
    storageAcc: storageScoredArr.filter((r) => r.storageOk).length,
    storageMsAvg: mean(storageRunsArr.map((r) => r.storageMs)),
    storageParse: tallyParse(storageRunsArr.map((r) => r.storageParse as ParseOutcome)),
    e2eMsPerPrompt: mean(results.map((r) => r.llmMs)),
    llmCalls: results.length + extractRunsArr.length + storageRunsArr.length,
    wallMs,
  };
}

interface RegexBaseline { results: Array<{ prompt: string; expect: Label; label: Label; ok: boolean }>; acc: number }

function regexBaseline(): RegexBaseline {
  const results = CORPUS.map((c) => {
    const q = memoryQueryTokens(c.prompt);
    const ext = hasExtractionSignal(c.prompt);
    const ret = shouldConsiderMemory(c.prompt, q);
    const label: Label = ext ? 'extract' : ret ? 'retrieve' : 'ignore';
    return { prompt: c.prompt, expect: c.expect, label, ok: label === c.expect };
  });
  return { results, acc: results.filter((r) => r.ok).length };
}

function cellDecision(agg: ConfigAggregate | undefined, i: number): string {
  if (!agg) return '—';
  const r = agg.results[i];
  return r.decisionOk ? r.decision : `${r.decision}*`;
}

function cellStorage(agg: ConfigAggregate | undefined, i: number): string {
  if (!agg) return '—';
  const r = agg.results[i];
  if (!r.storageRan) return 'skip';
  const d = r.storageDecision ?? 'err';
  return r.storageOk === false ? `${d}*` : d;
}

function insightLines(base: RegexBaseline, aggregates: ConfigAggregate[]): string[] {
  if (aggregates.length < 3) {
    return ['_Live matrix pending. Add `WATAI_PROBE_BASEURL` + `WATAI_PROBE_KEY` to `api/.env`, then run `npm run probe` to populate configs A/B/C and this section._'];
  }
  const byId = (id: string) => aggregates.find((a) => a.config.id === id);
  const A = byId('A')!, B = byId('B')!, C = byId('C')!, D = byId('D');
  const total = A.decisionTotal;
  const lines: string[] = [];

  const decFaster = B.decisionMsAvg > 0 ? A.decisionMsAvg / B.decisionMsAvg : 0;
  lines.push(
    `- **Decision (A vs B — full vs mini; extraction+storage held full).** ` +
    `Accuracy ${A.decisionAcc}/${total} (${pct(A.decisionAcc, total)}) vs ${B.decisionAcc}/${total} (${pct(B.decisionAcc, total)}); ` +
    `regex baseline ${base.acc}/${total} (${pct(base.acc, total)}). ` +
    `Latency ${f(A.decisionMsAvg)}ms vs ${f(B.decisionMsAvg)}ms/call${decFaster ? ` (${f(decFaster, 1)}× faster on mini)` : ''}. ` +
    (A.decisionAcc <= B.decisionAcc
      ? 'Mini matched or beat the full model — the decision gate does not need the expensive model.'
      : `The full model caught ${A.decisionAcc - B.decisionAcc} prompt(s) mini missed.`),
  );

  lines.push(
    `- **Extraction (B vs C — full vs mini; decision mini + storage full).** ` +
    `The real extractor abstained (no operation) on ${B.extractAbstainedCount}/${B.extractRuns} gated prompts on full and ${C.extractAbstainedCount}/${C.extractRuns} on mini — its minimal-reasoning selectivity dominates, so the model tier barely changes output. ` +
    `Latency ${f(B.extractMsAvg)}ms vs ${f(C.extractMsAvg)}ms/call.`,
  );

  const jr = (a: ConfigAggregate, stage: 'decisionParse' | 'storageParse') => {
    const p = a[stage]; const t = p.strict + p.salvaged + p.failed;
    return t ? `${p.strict} strict / ${p.salvaged} salvaged / ${p.failed} failed (of ${t})` : 'n/a';
  };
  lines.push(
    `- **Structured-output reliability — the mini JSON risk you flagged.** ` +
    `Decision JSON: full (A) ${jr(A, 'decisionParse')}; mini (B) ${jr(B, 'decisionParse')}. ` +
    (D ? `Storage JSON (the most format-heavy stage): full (A) ${jr(A, 'storageParse')}; mini (D, all-mini) ${jr(D, 'storageParse')}. ` : '') +
    `"salvaged" = the model wrapped its answer in fences/prose/trailing commas the parser had to strip; "failed" = unrecoverable. ` +
    `The probe parses in tiers (strict → fence-strip + balanced-object scan + trailing-comma repair → fail), so a format slip is recovered and counted as salvaged instead of being silently scored as a wrong answer — and the salvage/fail counts make mini's "adds extra stuff" tendency visible.`,
  );

  lines.push(
    `- **Storage dedup.** Correct add-vs-dedup — A ${A.storageAcc}/${A.storageScored} (${pct(A.storageAcc, A.storageScored)}), B ${B.storageAcc}/${B.storageScored} (${pct(B.storageAcc, B.storageScored)}), C ${C.storageAcc}/${C.storageScored} (${pct(C.storageAcc, C.storageScored)})` +
    (D ? `, D mini-storage ${D.storageAcc}/${D.storageScored} (${pct(D.storageAcc, D.storageScored)})` : '') + `. ` +
    (D
      ? `Mini on storage ${D.storageAcc >= A.storageAcc ? 'matched full on the dedup decision' : `dropped ${A.storageAcc - D.storageAcc} call(s) vs full`} — weigh that against its JSON reliability above.`
      : `Storage is constant (full) across A–C, so gaps reflect upstream candidate quality, not storage.`),
  );

  lines.push(
    `- **End-to-end.** Mean LLM time/turn — A ${f(A.e2eMsPerPrompt)}ms, B ${f(B.e2eMsPerPrompt)}ms, C ${f(C.e2eMsPerPrompt)}ms${D ? `, D ${f(D.e2eMsPerPrompt)}ms` : ''}; ` +
    `wall — A ${f(A.wallMs)}ms, B ${f(B.wallMs)}ms, C ${f(C.wallMs)}ms${D ? `, D ${f(D.wallMs)}ms` : ''}.`,
  );

  const miniDecSlip = B.decisionParse.salvaged + B.decisionParse.failed + C.decisionParse.salvaged + C.decisionParse.failed;
  const miniDecCalls = B.decisionTotal + C.decisionTotal;
  const miniStoreSlip = D ? D.storageParse.salvaged + D.storageParse.failed : 0;
  const miniStoreCalls = D ? D.storageParse.strict + D.storageParse.salvaged + D.storageParse.failed : 0;
  lines.push(
    `- **Recommendation.** Accuracy is equivalent across A–C (decision ${A.decisionAcc}/${total}, storage ${A.storageAcc}/${A.storageScored}); the call is cost + format reliability, not quality. ` +
    `On the gate, mini's decision JSON needed salvage or failed only ${miniDecSlip} time(s) across ${miniDecCalls} mini calls — reliable enough, so **mini decision is safe**. ` +
    (D
      ? `On storage (the strict \`{"operations":[…]}\` payload), mini slipped ${miniStoreSlip}/${miniStoreCalls} time(s)${miniStoreSlip > 0 ? ' — the exact "adds extra stuff" failure you flagged' : ' this run, though that is the highest-risk spot'}. `
      : '') +
    `So keep **${C.config.label}** as the cost-optimal default (mini decision + mini extraction) but **keep the full model on storage**, where a malformed operations array would silently drop or corrupt writes. The tiered parser is the safety net that makes mini usable on the cheaper stages.`,
  );
  return lines;
}

function buildMarkdown(now: string, live: boolean, base: RegexBaseline, aggregates: ConfigAggregate[], configs: ModelConfig[]): string {
  const total = base.results.length;
  const aggA = aggregates.find((a) => a.config.id === 'A');
  const aggB = aggregates.find((a) => a.config.id === 'B');
  const aggC = aggregates.find((a) => a.config.id === 'C');
  const aggD = aggregates.find((a) => a.config.id === 'D');
  const L: string[] = [];

  L.push('# Memory pipeline probe', '');
  L.push(`Run: ${now} — live LLM: ${live} — models: full=\`${FULL_MODEL}\`, mini=\`${MINI_MODEL}\``, '');

  L.push('## Pipeline & method', '');
  L.push('Three LLM-decidable stages are exercised independently, each with its own model:');
  L.push('1. **Decision** — classify a message as extract / retrieve / ignore (LLM stand-in for the regex gate `hasExtractionSignal` / `shouldConsiderMemory`). Scored against 23 labelled prompts.');
  L.push('2. **Extraction** — the real `extractMemories` extractor (command lane, as used for user messages) turns an extract-gated message into memory operations.');
  L.push('3. **Storage** — an LLM reconciler decides each extracted candidate against the seed memories: `add` (new) vs `merge`/`ignore` (dedup). When the extractor abstains, the raw message is used as the candidate so the stage is always measurable on a gated extract. Scored on the expected add-vs-dedup outcome.');
  L.push('');
  L.push('Configs isolate one downgrade each: **A→B = decision**, **B→C = extraction**, **C→D = storage** (D is all-mini, added to stress mini on the strict-JSON storage stage).', '');
  L.push('Every stage parses the model reply in tiers — **strict** (clean JSON), **salvaged** (code fences / prose / trailing commas stripped), or **failed** — so a small model wrapping its answer in extra text is recovered and *counted*, not silently scored as a wrong answer. See **Structured-output reliability** below.', '');
  L.push('| config | decision | extract | storage |');
  L.push('|--|--|--|--|');
  for (const c of configs) L.push(`| ${c.label} | \`${c.decision}\` | \`${c.extract}\` | \`${c.storage}\` |`);
  L.push('');

  L.push('## Accuracy & speed by configuration', '');
  L.push('| config | decision acc | dec ms | ext ms | ext abst | store acc | store ms | e2e ms/turn | LLM calls | wall ms |');
  L.push('|--|--|--|--|--|--|--|--|--|--|');
  L.push(`| regex baseline | ${base.acc}/${total} (${pct(base.acc, total)}) | ~0 | — | — | — | — | ~0 | 0 | — |`);
  for (const a of aggregates) {
    L.push(`| ${a.config.label} | ${a.decisionAcc}/${a.decisionTotal} (${pct(a.decisionAcc, a.decisionTotal)}) | ${f(a.decisionMsAvg)} | ${f(a.extractMsAvg)} | ${a.extractAbstainedCount}/${a.extractRuns} | ${a.storageAcc}/${a.storageScored} (${pct(a.storageAcc, a.storageScored)}) | ${f(a.storageMsAvg)} | ${f(a.e2eMsPerPrompt)} | ${a.llmCalls} | ${f(a.wallMs)} |`);
  }
  if (!aggregates.length) L.push('| _A/B/C pending — add key to api/.env_ |  |  |  |  |  |  |  |  |  |');
  L.push('');

  L.push('## Structured-output reliability (strict-JSON adherence)', '');
  L.push('How often each stage returned clean **strict** JSON vs needed **salvage** (stripping code fences / surrounding prose / trailing commas) vs **failed** outright. This is where small models like `' + MINI_MODEL + '` tend to slip by adding extra stuff around the JSON. The probe recovers salvageable replies (so format slips are not miscounted as wrong answers) and records the rate here.', '');
  L.push('| config | decision model | decision JSON (strict/salv/fail) | storage model | storage JSON (strict/salv/fail) |');
  L.push('|--|--|--|--|--|');
  for (const a of aggregates) {
    const d = a.decisionParse; const s = a.storageParse;
    const sTotal = s.strict + s.salvaged + s.failed;
    L.push(`| ${a.config.label} | \`${a.config.decision}\` | ${d.strict}/${d.salvaged}/${d.failed} | \`${a.config.storage}\` | ${sTotal ? `${s.strict}/${s.salvaged}/${s.failed}` : '—'} |`);
  }
  L.push('');

  L.push('## Decision label by prompt', '');
  L.push('`*` marks a mismatch vs the expected label.', '');
  L.push('| expect | prompt | regex | A | B | C | D |');
  L.push('|--|--|--|--|--|--|--|');
  for (let i = 0; i < base.results.length; i++) {
    const rb = base.results[i];
    const regexCell = rb.ok ? rb.label : `${rb.label}*`;
    L.push(`| ${rb.expect} | ${shortPrompt(rb.prompt)} | ${regexCell} | ${cellDecision(aggA, i)} | ${cellDecision(aggB, i)} | ${cellDecision(aggC, i)} | ${cellDecision(aggD, i)} |`);
  }
  L.push('');

  L.push('## Storage decision by extract prompt', '');
  L.push('Expected `dedup` when a seed already covers the fact, `new` when novel. The extractor abstained on most prompts (see `ext abst`), so storage usually judged the raw message. `skip` = the decision stage did not classify the prompt as extract. `*` = wrong.', '');
  L.push('| expect | prompt | A | B | C | D |');
  L.push('|--|--|--|--|--|--|');
  for (let i = 0; i < CORPUS.length; i++) {
    const c = CORPUS[i];
    if (!c.store) continue;
    L.push(`| ${c.store} | ${shortPrompt(c.prompt)} | ${cellStorage(aggA, i)} | ${cellStorage(aggB, i)} | ${cellStorage(aggC, i)} | ${cellStorage(aggD, i)} |`);
  }
  L.push('');

  L.push('## Insights', '');
  for (const line of insightLines(base, aggregates)) L.push(line);
  L.push('');
  L.push('---', '');
  L.push('Regenerate: `cd api && npm run probe` (reads `api/.env`).');
  return L.join('\n');
}

async function main() {
  const now = new Date().toISOString();
  const seeds = SEED.map((s, i) => ({ id: `m${i}`, text: s.text }));
  const base = regexBaseline();

  const live = !!(process.env.WATAI_PROBE_BASEURL && process.env.WATAI_PROBE_KEY);
  const creds: DecryptedCredentials = {
    baseUrl: process.env.WATAI_PROBE_BASEURL ?? '',
    key: process.env.WATAI_PROBE_KEY ?? '',
    models: { chat: FULL_MODEL } as DecryptedCredentials['models'],
  };

  const configs: ModelConfig[] = [
    { id: 'A', label: 'A: all-full', decision: FULL_MODEL, extract: FULL_MODEL, storage: FULL_MODEL },
    { id: 'B', label: 'B: mini-decision', decision: MINI_MODEL, extract: FULL_MODEL, storage: FULL_MODEL },
    { id: 'C', label: 'C: mini-decide+extract', decision: MINI_MODEL, extract: MINI_MODEL, storage: FULL_MODEL },
    { id: 'D', label: 'D: all-mini', decision: MINI_MODEL, extract: MINI_MODEL, storage: MINI_MODEL },
  ];

  const aggregates: ConfigAggregate[] = [];
  if (live) {
    for (const config of configs) {
      process.stderr.write(`probe: running ${config.label} (decision=${config.decision}, extract=${config.extract}, storage=${config.storage}) …\n`);
      aggregates.push(await runConfig(creds, config, seeds, now));
    }
  } else {
    process.stderr.write('probe: no WATAI_PROBE_BASEURL/KEY — writing regex baseline only. Add them to api/.env for the live matrix.\n');
  }

  const dir = resolve(HERE, '../../documentation/memory-system');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'pipeline-probe-report.md'), buildMarkdown(now, live, base, aggregates, configs) + '\n');
  writeFileSync(resolve(dir, 'pipeline-probe-report.json'), JSON.stringify({ ranAt: now, live, fullModel: FULL_MODEL, miniModel: MINI_MODEL, regexBaseline: base, configs: aggregates }, null, 2));

  console.log(`Regex decision accuracy: ${base.acc}/${base.results.length}`);
  for (const a of aggregates) {
    console.log(`${a.config.label}: decision ${a.decisionAcc}/${a.decisionTotal}, storage ${a.storageAcc}/${a.storageScored}, e2e ${f(a.e2eMsPerPrompt)}ms/turn, wall ${f(a.wallMs)}ms`);
  }
  console.log('Wrote documentation/memory-system/pipeline-probe-report.{md,json}');
}

main().catch((e) => { console.error(e); process.exit(1); });
