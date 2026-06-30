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

const now = (): number => Number(process.hrtime.bigint()) / 1e6;
const f = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '—' : Math.round(n).toString());

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

async function main(): Promise<void> {
  if (!baseUrl || !key) {
    console.error('Set WATAI_PROBE_BASEURL and WATAI_PROBE_KEY (env or api/.env).');
    process.exit(1);
  }
  const ranAt = new Date().toISOString();
  console.error(`pipeline-bench: endpoint=${new URL(baseUrl).host} chat=${CHAT_MODEL} embed=${EMBED_MODEL}`);
  const toolsOnly = process.env.BENCH_TOOLS_ONLY === '1' || process.env.BENCH_REAL === '1';

  // --- Phase A: embeddings (memory retrieval hot-path add-on) ---
  const embeds: Array<{ label: string; ms: number; dims: number; err?: string }> = [];
  if (!toolsOnly) {
    console.error('Phase A: embeddings (cold + warm) …');
    embeds.push({ label: 'cold', ...(await timeEmbed("What is my dog's name?")) });
    embeds.push({ label: 'warm', ...(await timeEmbed('How old is my daughter?')) });
    embeds.push({ label: 'warm', ...(await timeEmbed('Tell me about my pet')) });
  }

  // --- Phase B: agent generation via Responses API (no tools) ---
  const agent: AgentTiming[] = [];
  if (!toolsOnly) {
    console.error('Phase B: agent generation (Responses API, no tools) …');
    for (const [label, prompt] of PROMPTS) {
      console.error(`  · ${label} …`);
      agent.push(await timeAgent(label, prompt));
    }
  }

  // --- Phase C: chat/completions reasoning-effort sweep (same medium prompt) ---
  const sweep: AgentTiming[] = [];
  if (!toolsOnly) {
    console.error('Phase C: chat/completions reasoning sweep …');
    const sweepPrompt = 'Explain what a JavaScript closure is, in about four sentences.';
    for (const eff of ['minimal', 'low', 'medium', 'high'] as const) {
      console.error(`  · reasoning=${eff} …`);
      sweep.push(await timeChat('chat', sweepPrompt, eff));
    }
  }

  // --- Phase D: tool isolation / real-combo reproduction ---
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
  const toolResults: AgentTiming[] = [];
  for (const [label, tools] of toolCases) {
    console.error(`  · ${label} …`);
    toolResults.push(await timeAgentTools(label, toolPrompt, tools));
  }

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

  const dir = resolve(HERE, '../../documentation/memory-system');
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'pipeline-bench-report.md'), L.join('\n') + '\n');
  writeFileSync(resolve(dir, 'pipeline-bench-report.json'), JSON.stringify({ ranAt, baseUrlHost: new URL(baseUrl).host, chatModel: CHAT_MODEL, embedModel: EMBED_MODEL, embeds, agent, sweep, toolResults }, null, 2));

  // Console summary
  console.log('\n=== EMBEDDING ===');
  for (const e of embeds) console.log(`  ${e.label.padEnd(5)} ${f(e.ms).padStart(6)}ms  dims=${e.dims || '-'}${e.err ? '  ERR ' + e.err.slice(0, 80) : ''}`);
  console.log('=== AGENT (Responses, no tools) ===');
  for (const a of agent) console.log(`  ${a.label.padEnd(8)} TTFT=${f(a.firstTokenMs).padStart(6)}ms total=${f(a.totalMs).padStart(7)}ms chars=${String(a.chars).padStart(5)}${a.errored ? '  ERR ' + a.errored.slice(0, 80) : ''}`);
  console.log('=== REASONING SWEEP (chat/completions) ===');
  for (const s of sweep) console.log(`  ${s.label.padEnd(16)} TTFT=${f(s.firstTokenMs).padStart(6)}ms total=${f(s.totalMs).padStart(7)}ms chars=${String(s.chars).padStart(5)}${s.errored ? '  ERR ' + s.errored.slice(0, 80) : ''}`);
  console.log('=== TOOL ISOLATION (Responses, 40s abort) ===');
  for (const t of toolResults) console.log(`  ${t.label.padEnd(22)} TTFT=${f(t.firstTokenMs).padStart(6)}ms total=${f(t.totalMs).padStart(7)}ms chars=${String(t.chars).padStart(5)} toolEvts=${t.toolEvents}${t.errored ? '  ERR ' + t.errored.slice(0, 80) : ''}`);
  console.log('\nWrote documentation/memory-system/pipeline-bench-report.{md,json}');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
