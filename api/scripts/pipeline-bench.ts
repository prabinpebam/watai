/**
 * pipeline-bench — end-to-end latency benchmark for the watai chat run pipeline.
 *
 * Times the model-facing steps the server runWorker performs for a chat turn, against the REAL
 * production AI endpoint, so we can see exactly where the wall-clock goes (and why a run can take
 * ~2 minutes). It exercises the same code the worker uses:
 *   - embedText()  — the memory-retrieval query embedding (added to the run hot path).
 *   - runAgent()   — the Responses-API agent loop that streams the assistant reply.
 *
 * It reports, per prompt: time-to-first-token (TTFT), total generation time, characters produced,
 * tool events, and (for the agent) whether it errored. Embedding is measured cold + warm.
 *
 * Credentials (never printed) come from the environment or api/.env (gitignored):
 *   WATAI_PROBE_BASEURL   inference endpoint (…/openai/v1)
 *   WATAI_PROBE_KEY       API key
 *   WATAI_PROBE_CHAT_MODEL   chat deployment (default gpt-5.4)
 *   MEMORY_EMBED_MODEL       embedding deployment (default text-embedding-3-small)
 *
 * Run:  npx tsx scripts/pipeline-bench.ts
 * Output: console table + documentation/memory-system/pipeline-bench-report.{md,json}.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedText } from '../src/ai/azureEmbedder';
import { runAgent, type Turn } from '../src/ai/orchestrator';
import { streamChat } from '../src/ai/chat';

const HERE = dirname(fileURLToPath(import.meta.url));

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

const baseUrl = (process.env.WATAI_PROBE_BASEURL ?? '').trim();
const key = (process.env.WATAI_PROBE_KEY ?? '').trim();
const CHAT_MODEL = (process.env.WATAI_PROBE_CHAT_MODEL ?? 'gpt-5.4').trim();
const EMBED_MODEL = (process.env.MEMORY_EMBED_MODEL ?? 'text-embedding-3-small').trim();
// Repeat the embed + no-tool agent phases this many times per prompt and report percentiles, so a
// single unlucky LLM sample doesn't skew the TTFT picture. Default 1 keeps the original behavior.
const REPEAT = Math.max(1, Math.floor(Number(process.env.BENCH_REPEAT ?? 1)) || 1);

const now = (): number => Number(process.hrtime.bigint()) / 1e6;
const f = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '—' : Math.round(n).toString());

/** min / median / p95 / max over the finite samples (sorted-nearest-rank percentile). */
function stats(xs: Array<number | undefined>): { n: number; min: number; median: number; p95: number; max: number } | undefined {
  const v = xs.filter((x): x is number => x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const q = (p: number): number => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  return { n: v.length, min: v[0], median: q(0.5), p95: q(0.95), max: v[v.length - 1] };
}

/** Group repeated agent timings by prompt label and summarize TTFT + total. */
function summarize(rows: AgentTiming[]): Array<{ label: string; ttft?: ReturnType<typeof stats>; total?: ReturnType<typeof stats>; errors: number }> {
  const byLabel = new Map<string, AgentTiming[]>();
  for (const r of rows) (byLabel.get(r.label) ?? byLabel.set(r.label, []).get(r.label)!).push(r);
  return [...byLabel].map(([label, rs]) => ({
    label,
    ttft: stats(rs.map((r) => r.firstTokenMs)),
    total: stats(rs.map((r) => r.totalMs)),
    errors: rs.filter((r) => r.errored).length,
  }));
}

interface AgentTiming {
  label: string;
  prompt: string;
  firstTokenMs?: number;
  totalMs: number;
  chars: number;
  toolEvents: number;
  errored?: string;
}

async function timeEmbed(text: string): Promise<{ ms: number; dims: number; err?: string }> {
  const t = now();
  try {
    const v = await embedText({ baseUrl, key }, text, { model: EMBED_MODEL, timeoutMs: 30_000 });
    return { ms: now() - t, dims: v.length };
  } catch (e) {
    return { ms: now() - t, dims: 0, err: e instanceof Error ? e.message : String(e) };
  }
}

/** Run the real agent loop (no tools, no-op execute) and time generation. */
async function timeAgent(label: string, prompt: string): Promise<AgentTiming> {
  const turns: Turn[] = [
    { role: 'system', text: 'You are a helpful assistant. Answer directly.' },
    { role: 'user', text: prompt },
  ];
  const t0 = now();
  let firstTokenMs: number | undefined;
  let chars = 0;
  let toolEvents = 0;
  let errored: string | undefined;
  for await (const ev of runAgent({
    baseUrl,
    key,
    model: CHAT_MODEL,
    turns,
    tools: [],
    execute: async () => ({ output: '' }),
  })) {
    if (ev.type === 'text') {
      if (firstTokenMs === undefined) firstTokenMs = now() - t0;
      chars += ev.delta.length;
    } else if (ev.type === 'tool') {
      toolEvents++;
    } else if (ev.type === 'error') {
      errored = ev.message;
    } else if (ev.type === 'done') {
      break;
    }
  }
  return { label, prompt, firstTokenMs, totalMs: now() - t0, chars, toolEvents, errored };
}

/** Plain chat/completions for comparison with the Responses agent path. */
async function timeChat(label: string, prompt: string, reasoning?: 'minimal' | 'low' | 'medium' | 'high'): Promise<AgentTiming> {
  const t0 = now();
  let firstTokenMs: number | undefined;
  let chars = 0;
  let errored: string | undefined;
  for await (const ev of streamChat({
    baseUrl,
    key,
    model: CHAT_MODEL,
    messages: [
      { role: 'system', content: 'You are a helpful assistant. Answer directly.' },
      { role: 'user', content: prompt },
    ],
    ...(reasoning ? { reasoningEffort: reasoning } : {}),
    timeoutMs: 180_000,
  })) {
    if (ev.type === 'delta') {
      if (firstTokenMs === undefined) firstTokenMs = now() - t0;
      chars += ev.textDelta.length;
    } else if (ev.type === 'error') {
      errored = ev.error.message;
    } else if (ev.type === 'done') {
      break;
    }
  }
  return { label: `${label}${reasoning ? ` [${reasoning}]` : ''}`, prompt, firstTokenMs, totalMs: now() - t0, chars, toolEvents: 0, errored };
}

const PROMPTS: Array<[string, string]> = [
  ['short', 'Reply with exactly one word: ready.'],
  ['factual', 'What is the capital of France? Answer in one short sentence.'],
  ['medium', 'Explain what a JavaScript closure is, in about four sentences.'],
  ['long', 'Write six paragraphs explaining how DNS name resolution works end to end.'],
  ['code', 'Write a Python function that returns the nth Fibonacci number iteratively.'],
];

// Tool definitions mirror api/src/application/runWorker.ts assembleTools().
const webSearchTool = {
  type: 'function' as const,
  name: 'web_search',
  description: 'Search the web for current, factual information. Returns titles, URLs, and snippets.',
  parameters: { type: 'object', properties: { query: { type: 'string', description: 'The search query.' } }, required: ['query'], additionalProperties: false },
};
const genImageTool = {
  type: 'function' as const,
  name: 'generate_image',
  description: 'Generate an image from a text description.',
  parameters: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'], additionalProperties: false },
};
const codeInterpTool = { type: 'code_interpreter' as const, container: { type: 'auto' as const } };
const SKILL_FILE_IDS = (process.env.WATAI_PROBE_SKILL_FILE_IDS
  ?? 'assistant-U3okAHLurr7L5xouUPbf4V,assistant-9FLRKfhKkkjz7GeuwEXEyw,assistant-AJRZosbZGJ8WgbJ6J5DBkt')
  .split(',').map((s) => s.trim()).filter(Boolean);
const codeInterpWithSkills = { type: 'code_interpreter' as const, container: { type: 'auto' as const, file_ids: SKILL_FILE_IDS } };

/** Run the agent loop with a specific tool set and a hard abort, to detect tool-induced hangs. */
async function timeAgentTools(label: string, prompt: string, tools: unknown[], timeoutMs = 40_000): Promise<AgentTiming> {
  const turns: Turn[] = [
    { role: 'system', text: 'You are a helpful assistant. Answer directly.' },
    { role: 'user', text: prompt },
  ];
  const t0 = now();
  let firstTokenMs: number | undefined;
  let chars = 0;
  let toolEvents = 0;
  let errored: string | undefined;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    for await (const ev of runAgent({
      baseUrl,
      key,
      model: CHAT_MODEL,
      turns,
      tools: tools as never,
      execute: async () => ({ output: 'OK' }),
      signal,
    })) {
      if (ev.type === 'text') {
        if (firstTokenMs === undefined) firstTokenMs = now() - t0;
        chars += ev.delta.length;
      } else if (ev.type === 'tool') {
        toolEvents++;
      } else if (ev.type === 'error') {
        errored = ev.message;
      } else if (ev.type === 'done') {
        break;
      }
    }
  } catch (e) {
    errored = e instanceof Error ? e.message : String(e);
  }
  return { label, prompt, firstTokenMs, totalMs: now() - t0, chars, toolEvents, errored };
}

/** Build a synthetic conversation carrying ~targetChars of prior context, ending with a question
 *  whose answer is one word — so the measured TTFT reflects INPUT (prefill) processing, not output
 *  generation. This isolates how a growing thread / large memory+skills system prompt slows the
 *  first token. */
function buildContextTurns(targetChars: number): Turn[] {
  const turns: Turn[] = [{ role: 'system', text: 'You are a helpful assistant. Answer directly.' }];
  const filler =
    'The engineering team reviewed the quarterly latency report and noted action items for the next sprint about caching, retries, and connection pooling. ';
  let acc = 0;
  let i = 0;
  while (acc < targetChars) {
    const note = `Note ${++i}: ${filler.repeat(6)}`;
    turns.push({ role: 'user', text: note }, { role: 'assistant', text: 'Acknowledged.' });
    acc += note.length + 12;
  }
  turns.push({ role: 'user', text: 'Ignore everything above and reply with exactly one word: ready.' });
  return turns;
}

/** Time TTFT for a caller-supplied turns array (no tools, no-op execute). */
async function timeTurns(label: string, turns: Turn[]): Promise<AgentTiming> {
  const t0 = now();
  let firstTokenMs: number | undefined;
  let chars = 0;
  let errored: string | undefined;
  for await (const ev of runAgent({ baseUrl, key, model: CHAT_MODEL, turns, tools: [], execute: async () => ({ output: '' }) })) {
    if (ev.type === 'text') {
      if (firstTokenMs === undefined) firstTokenMs = now() - t0;
      chars += ev.delta.length;
    } else if (ev.type === 'error') {
      errored = ev.message;
    } else if (ev.type === 'done') {
      break;
    }
  }
  return { label, prompt: '', firstTokenMs, totalMs: now() - t0, chars, toolEvents: 0, errored };
}

async function main(): Promise<void> {
  if (!baseUrl || !key) {
    console.error('Set WATAI_PROBE_BASEURL and WATAI_PROBE_KEY (env or api/.env).');
    process.exit(1);
  }
  const ranAt = new Date().toISOString();
  console.error(`pipeline-bench: endpoint=${new URL(baseUrl).host} chat=${CHAT_MODEL} embed=${EMBED_MODEL}`);
  const toolsOnly = process.env.BENCH_TOOLS_ONLY === '1' || process.env.BENCH_REAL === '1';
  const contextOnly = process.env.BENCH_CONTEXT === '1';

  // --- Phase A: embeddings (memory retrieval hot-path add-on) ---
  const embeds: Array<{ label: string; ms: number; dims: number; err?: string }> = [];
  if (!toolsOnly && !contextOnly) {
    console.error(`Phase A: embeddings (cold + warm×${REPEAT}) …`);
    embeds.push({ label: 'cold', ...(await timeEmbed("What is my dog's name?")) });
    const warmQueries = ['How old is my daughter?', 'Tell me about my pet'];
    for (let i = 0; i < REPEAT; i++) {
      for (const qy of warmQueries) embeds.push({ label: 'warm', ...(await timeEmbed(qy)) });
    }
  }

  // --- Phase B: agent generation via Responses API (no tools) ---
  const agent: AgentTiming[] = [];
  if (!toolsOnly && !contextOnly) {
    console.error(`Phase B: agent generation (Responses API, no tools) ×${REPEAT} …`);
    for (let i = 0; i < REPEAT; i++) {
      for (const [label, prompt] of PROMPTS) {
        console.error(`  · ${label}${REPEAT > 1 ? ` (${i + 1}/${REPEAT})` : ''} …`);
        agent.push(await timeAgent(label, prompt));
      }
    }
  }
  const agentStats = summarize(agent);

  // --- Phase C: chat/completions reasoning-effort sweep (same medium prompt) ---
  const sweep: AgentTiming[] = [];
  if (!toolsOnly && !contextOnly) {
    console.error('Phase C: chat/completions reasoning sweep …');
    const sweepPrompt = 'Explain what a JavaScript closure is, in about four sentences.';
    for (const eff of ['minimal', 'low', 'medium', 'high'] as const) {
      console.error(`  · reasoning=${eff} …`);
      sweep.push(await timeChat('chat', sweepPrompt, eff));
    }
  }

  // --- Phase D: tool isolation / real-combo reproduction ---
  const toolResults: AgentTiming[] = [];
  if (!contextOnly) {
    console.error('Phase D: tool combos (simple prompt, 40s abort) …');
    const toolPrompt = 'What is 2 + 2? Answer in one short sentence.';
    const toolCases: Array<[string, unknown[]]> = process.env.BENCH_REAL === '1'
      ? [
          ['real ws+img+ci(skills) #1', [webSearchTool, genImageTool, codeInterpWithSkills]],
          ['real ws+img+ci(skills) #2', [webSearchTool, genImageTool, codeInterpWithSkills]],
          ['real ws+img+ci(skills) #3', [webSearchTool, genImageTool, codeInterpWithSkills]],
          ['fallback ws+img (no ci)', [webSearchTool, genImageTool]],
          ['ci(skills) alone', [codeInterpWithSkills]],
        ]
      : [
          ['ws + ci', [webSearchTool, codeInterpTool]],
          ['img + ci', [genImageTool, codeInterpTool]],
          ['ws + img', [webSearchTool, genImageTool]],
          ['all 3 (ws+img+ci)', [webSearchTool, genImageTool, codeInterpTool]],
        ];
    for (const [label, tools] of toolCases) {
      console.error(`  · ${label} …`);
      toolResults.push(await timeAgentTools(label, toolPrompt, tools));
    }
  }

  // --- Phase E: context scaling — TTFT vs input (prefill) size ---
  const context: AgentTiming[] = [];
  if (contextOnly) {
    const sizes = [0, 4000, 16000, 48000, 96000, 192000];
    console.error(`Phase E: context scaling (TTFT vs input size) ×${REPEAT} …`);
    for (const targetChars of sizes) {
      const turns = buildContextTurns(targetChars);
      const approxTokens = Math.round(turns.reduce((n, t) => n + t.text.length, 0) / 4);
      for (let i = 0; i < REPEAT; i++) {
        console.error(`  · ~${approxTokens} tok (${i + 1}/${REPEAT}) …`);
        context.push(await timeTurns(`~${approxTokens}tok`, turns));
      }
    }
  }
  const contextStats = summarize(context);

  // --- Report ---
  const L: string[] = [];
  L.push('# Chat pipeline latency benchmark', '');
  L.push(`Run: ${ranAt} — endpoint \`${new URL(baseUrl).host}\` — chat \`${CHAT_MODEL}\` — embed \`${EMBED_MODEL}\``, '');
  L.push('Times each model-facing step the server `runWorker` performs, against the live endpoint.', '');

  L.push('## Embedding (memory retrieval query)', '');
  L.push('| call | ms | dims | error |');
  L.push('|--|--|--|--|');
  for (const e of embeds) L.push(`| ${e.label} | ${f(e.ms)} | ${e.dims || '—'} | ${e.err ? e.err.slice(0, 60) : ''} |`);
  L.push('');

  L.push('## Agent generation — Responses API, no tools (pure model latency)', '');
  L.push('| prompt | TTFT ms | total ms | chars | tool evts | error |');
  L.push('|--|--|--|--|--|--|');
  for (const a of agent) L.push(`| ${a.label} | ${f(a.firstTokenMs)} | ${f(a.totalMs)} | ${a.chars} | ${a.toolEvents} | ${a.errored ? a.errored.slice(0, 50) : ''} |`);
  L.push('');

  if (REPEAT > 1) {
    L.push(`## Agent TTFT/total stats — ${REPEAT} samples/prompt (no tools)`, '');
    L.push('| prompt | n | TTFT min | TTFT median | TTFT p95 | TTFT max | total median | total p95 | errors |');
    L.push('|--|--|--|--|--|--|--|--|--|');
    for (const s of agentStats)
      L.push(`| ${s.label} | ${s.ttft?.n ?? 0} | ${f(s.ttft?.min)} | ${f(s.ttft?.median)} | ${f(s.ttft?.p95)} | ${f(s.ttft?.max)} | ${f(s.total?.median)} | ${f(s.total?.p95)} | ${s.errors} |`);
    L.push('');
  }

  L.push('## Reasoning-effort sweep — chat/completions, same medium prompt', '');
  L.push('| effort | TTFT ms | total ms | chars | error |');
  L.push('|--|--|--|--|--|');
  for (const s of sweep) L.push(`| ${s.label} | ${f(s.firstTokenMs)} | ${f(s.totalMs)} | ${s.chars} | ${s.errored ? s.errored.slice(0, 50) : ''} |`);
  L.push('');

  L.push('## Tool isolation — Responses API with server/function tools (40s abort)', '');
  L.push('Simple prompt that should answer instantly; any case that stalls to ~40s reveals the hanging tool.', '');
  L.push('| tools | TTFT ms | total ms | chars | tool evts | error |');
  L.push('|--|--|--|--|--|--|');
  for (const t of toolResults) L.push(`| ${t.label} | ${f(t.firstTokenMs)} | ${f(t.totalMs)} | ${t.chars} | ${t.toolEvents} | ${t.errored ? t.errored.slice(0, 50) : ''} |`);
  L.push('');

  if (context.length) {
    L.push('## Context scaling — TTFT vs input (prefill) size, no tools', '');
    L.push('One-word answer, so TTFT ≈ time to process the input. Shows how a growing thread / large memory+skills system prompt slows the first token.', '');
    L.push('| approx input tokens | n | TTFT min | TTFT median | TTFT p95 | TTFT max |');
    L.push('|--|--|--|--|--|--|');
    for (const s of contextStats)
      L.push(`| ${s.label} | ${s.ttft?.n ?? 0} | ${f(s.ttft?.min)} | ${f(s.ttft?.median)} | ${f(s.ttft?.p95)} | ${f(s.ttft?.max)} |`);
    L.push('');
  }

  const dir = resolve(HERE, '../../documentation/memory-system');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'pipeline-bench-report.md'), L.join('\n') + '\n');
  writeFileSync(resolve(dir, 'pipeline-bench-report.json'), JSON.stringify({ ranAt, baseUrlHost: new URL(baseUrl).host, chatModel: CHAT_MODEL, embedModel: EMBED_MODEL, repeat: REPEAT, embeds, agent, agentStats, sweep, toolResults, context, contextStats }, null, 2));

  // Console summary
  console.log('\n=== EMBEDDING ===');
  for (const e of embeds) console.log(`  ${e.label.padEnd(5)} ${f(e.ms).padStart(6)}ms  dims=${e.dims || '-'}${e.err ? '  ERR ' + e.err.slice(0, 80) : ''}`);
  console.log('=== AGENT (Responses, no tools) ===');
  for (const a of agent) console.log(`  ${a.label.padEnd(8)} TTFT=${f(a.firstTokenMs).padStart(6)}ms total=${f(a.totalMs).padStart(7)}ms chars=${String(a.chars).padStart(5)}${a.errored ? '  ERR ' + a.errored.slice(0, 80) : ''}`);
  if (REPEAT > 1) {
    console.log(`=== AGENT TTFT STATS (${REPEAT} samples/prompt) ===`);
    for (const s of agentStats)
      console.log(`  ${s.label.padEnd(8)} TTFT min/med/p95/max=${f(s.ttft?.min).padStart(5)}/${f(s.ttft?.median).padStart(5)}/${f(s.ttft?.p95).padStart(5)}/${f(s.ttft?.max).padStart(5)}ms  total med=${f(s.total?.median).padStart(6)}ms${s.errors ? `  errors=${s.errors}` : ''}`);
  }
  console.log('=== REASONING SWEEP (chat/completions) ===');
  for (const s of sweep) console.log(`  ${s.label.padEnd(16)} TTFT=${f(s.firstTokenMs).padStart(6)}ms total=${f(s.totalMs).padStart(7)}ms chars=${String(s.chars).padStart(5)}${s.errored ? '  ERR ' + s.errored.slice(0, 80) : ''}`);
  console.log('=== TOOL ISOLATION (Responses, 40s abort) ===');
  for (const t of toolResults) console.log(`  ${t.label.padEnd(22)} TTFT=${f(t.firstTokenMs).padStart(6)}ms total=${f(t.totalMs).padStart(7)}ms chars=${String(t.chars).padStart(5)} toolEvts=${t.toolEvents}${t.errored ? '  ERR ' + t.errored.slice(0, 80) : ''}`);
  if (context.length) {
    console.log(`=== CONTEXT SCALING (TTFT vs input size, ${REPEAT} samples) ===`);
    for (const s of contextStats)
      console.log(`  ${s.label.padEnd(12)} TTFT min/med/p95/max=${f(s.ttft?.min).padStart(6)}/${f(s.ttft?.median).padStart(6)}/${f(s.ttft?.p95).padStart(6)}/${f(s.ttft?.max).padStart(6)}ms`);
  }
  console.log('\nWrote documentation/memory-system/pipeline-bench-report.{md,json}');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
