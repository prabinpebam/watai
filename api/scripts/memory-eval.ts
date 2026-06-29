/**
 * memory-eval — `.env`-driven live evaluation harness for the memory pipeline.
 *
 * Runs the REAL extractor + embedding model against a labeled prompt corpus and reports
 * per-category metrics. It spends tokens by design; the run is bounded by WATAI_EVAL_MAX_USD.
 *
 * Usage:
 *   npm run eval -- --validate                 # no network: schema-check + corpus stats
 *   npm run eval                               # full live run (needs api/.env)
 *   npm run eval -- --stage retrieval          # one stage only
 *   npm run eval -- --sample 12                # stratified sample
 *
 * .env keys (gitignored): WATAI_PROBE_BASEURL, WATAI_PROBE_KEY,
 *   MEMORY_MODEL | WATAI_PROBE_MINI_MODEL, MEMORY_EMBED_MODEL | WATAI_EVAL_EMBED_MODEL,
 *   WATAI_EVAL_CORPUS, WATAI_EVAL_MAX_USD.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMemories } from '../src/ai/memoryExtractor';
import { embedText } from '../src/ai/azureEmbedder';
import { InProcessRetriever } from '../src/adapters/memory/inProcessRetriever';
import { InMemoryMemoryStore } from '../src/adapters/memory/memoryStore';
import { renderMemoryProfile } from '../src/domain/memoryProfile';
import { parseMemoryRecord, containsSecretLikeValue, type MemoryRecord } from '../src/domain/memory';
import type { DecryptedCredentials } from '../src/application/credentialService';

const HERE = dirname(fileURLToPath(import.meta.url));
const RELEVANCE_FLOOR = 0.3; // mirrors MemoryContextService

/** Minimal zero-dependency .env loader: KEY=VALUE lines, # comments, optional quotes. */
function loadEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnv(resolve(HERE, '../.env'));

interface Turn { role: 'user' | 'assistant'; content: string }
interface SeedMemory { id: string; text: string; kind?: string; salience?: number; sensitive?: boolean }
interface EvalCase {
  id: string;
  category: string;
  difficulty?: string;
  locale?: string;
  conversation?: Turn[];
  seedMemories?: SeedMemory[];
  expect?: { op: string; kind?: string | string[]; mustContain?: string[] };
  query?: string;
  expectRetrieved?: string[];
  expectExcluded?: string[];
  expectProfileContains?: string[];
  expectProfileExcludes?: string[];
  why?: string;
}
type Stage = 'capture' | 'retrieval' | 'profile';
interface CaseResult { id: string; category: string; stage: Stage; pass: boolean; detail: string }

function stageOf(c: EvalCase): Stage {
  if (c.query !== undefined) return 'retrieval';
  if (c.expectProfileContains || c.expectProfileExcludes) return 'profile';
  return 'capture';
}

function loadCorpus(dir: string): EvalCase[] {
  const cases: EvalCase[] = [];
  for (const f of readdirSync(dir).filter((name) => name.endsWith('.json'))) {
    const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8')) as EvalCase[];
    for (const c of parsed) cases.push(c);
  }
  return cases;
}

function validateCorpus(cases: EvalCase[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const c of cases) {
    if (!c.id) { errors.push('a case is missing its id'); continue; }
    if (ids.has(c.id)) errors.push(`duplicate id: ${c.id}`);
    ids.add(c.id);
    if (!c.category) errors.push(`${c.id}: missing category`);
    const stage = stageOf(c);
    if (stage === 'capture') {
      if (!c.conversation?.length) errors.push(`${c.id}: capture case needs a conversation`);
      if (!c.expect?.op) errors.push(`${c.id}: capture case needs expect.op`);
    }
    if (stage === 'retrieval' && !c.seedMemories?.length) errors.push(`${c.id}: retrieval case needs seedMemories`);
    if (stage === 'profile' && !c.seedMemories?.length) errors.push(`${c.id}: profile case needs seedMemories`);
    if (!c.why) errors.push(`${c.id}: missing why`);
  }
  return errors;
}

function makeRecord(seed: SeedMemory, now: string, embedding?: number[]): MemoryRecord {
  return parseMemoryRecord({
    id: seed.id,
    userId: 'eval',
    kind: seed.kind ?? 'fact',
    status: 'active',
    text: seed.text,
    confidence: 0.9,
    salience: seed.salience ?? 0.7,
    pinned: false,
    sensitive: seed.sensitive ?? false,
    visibility: 'normal',
    useCount: 0,
    createdAt: now,
    updatedAt: now,
    sourceRefs: [{ type: 'manual', createdAt: now }],
    ...(embedding ? { embedding } : {}),
  });
}

async function runCapture(creds: DecryptedCredentials, model: string, c: EvalCase): Promise<CaseResult> {
  const now = new Date().toISOString();
  const messages = (c.conversation ?? []).map((t, i) => ({ id: `m${i}`, role: t.role, content: t.content, createdAt: now }));
  const expected = c.expect?.op ?? 'ignore';
  let out;
  try {
    out = await extractMemories(
      creds,
      {
        mode: 'turn',
        now,
        threadId: 'eval',
        threadTitle: 'eval',
        messages,
        existingMemories: (c.seedMemories ?? []).map((s) => ({ id: s.id, kind: s.kind ?? 'fact', status: 'active', text: s.text })),
      },
      { model },
    );
  } catch (e) {
    // A refusal/empty completion for a reject case means nothing was stored — the desired outcome.
    if (expected === 'reject') return { id: c.id, category: c.category, stage: 'capture', pass: true, detail: `refused: ${(e as Error).message}` };
    return { id: c.id, category: c.category, stage: 'capture', pass: false, detail: `error: ${(e as Error).message}` };
  }
  const ops = out.operations as Array<Record<string, unknown>>;
  const order = ['add', 'merge', 'invalidate', 'suppress'];
  const dominant = order.find((op) => ops.some((o) => o.op === op)) ?? 'ignore';
  const addOp = ops.find((o) => o.op === 'add');
  let pass: boolean;
  let detail = `predicted=${dominant}`;
  if (expected === 'reject') {
    pass = dominant === 'ignore' || (!!addOp && containsSecretLikeValue(String(addOp.text ?? '')));
    if (!pass) detail = `stored op=${dominant} (expected reject)`;
  } else {
    pass = dominant === expected;
    if (!pass) detail = `op ${dominant} != ${expected}`;
    if (pass && expected === 'add') {
      const text = String(addOp?.text ?? '').toLowerCase();
      if (c.expect?.mustContain?.length && !c.expect.mustContain.every((s) => text.includes(s.toLowerCase()))) {
        pass = false;
        detail = `text missing ${JSON.stringify(c.expect.mustContain)}`;
      } else if (c.expect?.kind) {
        const want = Array.isArray(c.expect.kind) ? c.expect.kind : [c.expect.kind];
        if (!want.includes(String(addOp?.kind))) {
          pass = false;
          detail = `kind ${String(addOp?.kind)} not in ${JSON.stringify(want)}`;
        }
      }
    }
  }
  return { id: c.id, category: c.category, stage: 'capture', pass, detail };
}

async function runRetrieval(creds: DecryptedCredentials, embedModel: string, c: EvalCase): Promise<CaseResult> {
  const now = new Date().toISOString();
  const store = new InMemoryMemoryStore();
  for (const seed of c.seedMemories ?? []) {
    const vector = await embedText(creds, seed.text, { model: embedModel });
    await store.put(makeRecord(seed, now, vector));
  }
  const queryVec = await embedText(creds, c.query ?? '', { model: embedModel });
  const scored = await new InProcessRetriever(store).retrieve('eval', queryVec, { now, limit: 5 });
  const selected = scored.filter((s) => s.relevance >= RELEVANCE_FLOOR).map((s) => s.memory.id);
  const gotAll = (c.expectRetrieved ?? []).every((id) => selected.includes(id));
  const noExcluded = (c.expectExcluded ?? []).every((id) => !selected.includes(id));
  return { id: c.id, category: c.category, stage: 'retrieval', pass: gotAll && noExcluded, detail: `selected=[${selected.join(',')}]` };
}

function runProfile(c: EvalCase): CaseResult {
  const now = new Date().toISOString();
  const records = (c.seedMemories ?? []).map((s) => makeRecord(s, now));
  const profile = renderMemoryProfile(records, now);
  const hasAll = (c.expectProfileContains ?? []).every((s) => profile.includes(s));
  const noneExcluded = (c.expectProfileExcludes ?? []).every((s) => !profile.includes(s));
  return { id: c.id, category: c.category, stage: 'profile', pass: hasAll && noneExcluded, detail: profile ? 'rendered' : 'empty' };
}

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}

function stratifiedSample(cases: EvalCase[], n: number): EvalCase[] {
  if (n <= 0 || n >= cases.length) return cases;
  const byCat = new Map<string, EvalCase[]>();
  for (const c of cases) (byCat.get(c.category) ?? byCat.set(c.category, []).get(c.category)!).push(c);
  const out: EvalCase[] = [];
  let i = 0;
  const buckets = [...byCat.values()];
  while (out.length < n) {
    const bucket = buckets[i % buckets.length];
    const next = bucket.shift();
    if (next) out.push(next);
    i++;
    if (buckets.every((b) => b.length === 0)) break;
  }
  return out;
}

function rate(results: CaseResult[]): string {
  if (!results.length) return 'n/a';
  const pass = results.filter((r) => r.pass).length;
  return `${pass}/${results.length} (${Math.round((100 * pass) / results.length)}%)`;
}

function summarize(results: CaseResult[]): string {
  const lines: string[] = [];
  lines.push(`Overall: ${rate(results)}`);
  for (const stage of ['capture', 'retrieval', 'profile'] as Stage[]) {
    const inStage = results.filter((r) => r.stage === stage);
    if (inStage.length) lines.push(`  ${stage}: ${rate(inStage)}`);
  }
  const cats = [...new Set(results.map((r) => r.category))].sort();
  lines.push('By category:');
  for (const cat of cats) lines.push(`  ${cat}: ${rate(results.filter((r) => r.category === cat))}`);
  const fails = results.filter((r) => !r.pass);
  if (fails.length) {
    lines.push('Failures:');
    for (const f of fails) lines.push(`  [${f.stage}] ${f.id} — ${f.detail}`);
  }
  return lines.join('\n');
}

function writeReport(results: CaseResult[], summary: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = resolve(HERE, '../../documentation/memory-system/eval-runs', stamp);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'results.json'), JSON.stringify(results, null, 2));
  writeFileSync(join(dir, 'report.md'), `# Memory eval run ${stamp}\n\n\`\`\`\n${summary}\n\`\`\`\n`);
  return dir;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const validate = args.includes('--validate');
  const stageArg = argValue(args, '--stage') as Stage | undefined;
  const sample = Number(argValue(args, '--sample') ?? '0') || 0;
  const maxUsd = Number(process.env.WATAI_EVAL_MAX_USD ?? argValue(args, '--max-usd') ?? '2') || 2;
  const corpusDir = process.env.WATAI_EVAL_CORPUS ? resolve(process.env.WATAI_EVAL_CORPUS) : resolve(HERE, 'eval/corpus');

  const all = loadCorpus(corpusDir);
  const errors = validateCorpus(all);

  const byStage = (s: Stage) => all.filter((c) => stageOf(c) === s).length;
  console.log(`Corpus: ${all.length} cases from ${corpusDir}`);
  console.log(`  capture=${byStage('capture')} retrieval=${byStage('retrieval')} profile=${byStage('profile')}`);
  if (errors.length) {
    console.error(`Schema errors (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('Corpus schema: OK');
  if (validate) return;

  const baseUrl = process.env.WATAI_PROBE_BASEURL?.trim();
  const key = process.env.WATAI_PROBE_KEY?.trim();
  if (!baseUrl || !key) {
    console.error('\nLive run needs WATAI_PROBE_BASEURL and WATAI_PROBE_KEY in api/.env.');
    console.error('Run `npm run eval -- --validate` for a no-network corpus check.');
    process.exit(1);
  }
  const model = process.env.MEMORY_MODEL?.trim() || process.env.WATAI_PROBE_MINI_MODEL?.trim() || 'gpt-5.4-mini';
  const embedModel = process.env.MEMORY_EMBED_MODEL?.trim() || process.env.WATAI_EVAL_EMBED_MODEL?.trim() || 'text-embedding-3-small';
  const creds = { baseUrl, key, models: { chat: model } } as DecryptedCredentials;

  let cases = all;
  if (stageArg) cases = cases.filter((c) => stageOf(c) === stageArg);
  if (sample > 0) cases = stratifiedSample(cases, sample);

  console.log(`\nRunning ${cases.length} cases (model=${model}, embed=${embedModel}, ceiling=$${maxUsd})\n`);
  const results: CaseResult[] = [];
  let usd = 0;
  for (const c of cases) {
    if (usd > maxUsd) {
      console.warn(`\nCost ceiling $${maxUsd} reached after ${results.length} cases; stopping.`);
      break;
    }
    const stage = stageOf(c);
    try {
      if (stage === 'capture') { results.push(await runCapture(creds, model, c)); usd += 0.002; }
      else if (stage === 'retrieval') { results.push(await runRetrieval(creds, embedModel, c)); usd += 0.0002 * ((c.seedMemories?.length ?? 0) + 1); }
      else { results.push(runProfile(c)); }
    } catch (e) {
      results.push({ id: c.id, category: c.category, stage, pass: false, detail: `error: ${(e as Error).message}` });
    }
    process.stdout.write(results[results.length - 1].pass ? '.' : 'x');
  }
  console.log('\n');
  const summary = summarize(results);
  console.log(summary);
  const dir = writeReport(results, summary);
  console.log(`\nReport written to ${dir}`);
  console.log(`Approx spend: $${usd.toFixed(3)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
