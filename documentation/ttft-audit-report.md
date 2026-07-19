# Chat TTFT audit — measured (2026-06-30)

Goal: explain why chat feels slow, and isolate every contributor to **time-to-first-token (TTFT)** —
from the user hitting send to the first assistant token rendering. Measurements were taken against the
live endpoint (`ai-project-deployments-resource…`, `gpt-5.4` + `text-embedding-3-small`) with the
offline harness [api/scripts/pipeline-bench.ts](../api/scripts/pipeline-bench.ts), 5 samples per prompt
to absorb LLM nondeterminism. Raw numbers:
[documentation/memory-system/pipeline-bench-report.{md,json}](memory-system/pipeline-bench-report.md).

This complements the earlier infra-focused write-up in
[documentation/chat-pipeline-audit.md](chat-pipeline-audit.md) (queue/cold-start + the tool-combo
no-response bug).

---

## TL;DR

- **The model, memory, and tool layers are fast and healthy.** Warm, they sum to ~2–4s.
- **The slowness you feel is the storage-queue worker cold start (scale-from-zero), ~12–42s** — it is
  infrastructure, not the model. A warm session is already ~3–4s end-to-end; an idle app pays ~40s on
  the first prompt because the queue worker scales from zero **independently** of the HTTP instance
  that handled the POST.
- **Memory extraction is fully off the hot path** (enqueued after the reply). **Memory retrieval** is
  overlapped with setup and capped at 3s, so it adds ~0 in the warm case.
- **Tools:** `code_interpreter` adds ~3–6s when active; the `web_search + generate_image +
  code_interpreter` combo is intermittently unstable (it did not deadlock in today's two runs, but has
  historically — see the companion doc). Ordinary chat now skips skill-mounting, so it stays on the
  fast path.
- **Reasoning effort (minimal→high) has no systematic TTFT impact** (measured).

---

## Measured results (live endpoint, 5 samples/prompt)

### Embedding — the memory-retrieval query embed
| call | ms |
|--|--|
| cold (first call) | ~2.7s |
| warm (steady) | **~0.77s median** (range 0.70–0.84s) |

### Agent first token — Responses API, no tools (pure model latency)
| prompt | TTFT min | TTFT median | TTFT p95 | total median |
|--|--|--|--|--|
| short | 0.82s | **0.91s** | 2.36s | 1.1s |
| factual | 1.11s | **1.22s** | 2.00s | 1.4s |
| medium | 0.77s | **1.12s** | 2.49s | 2.6s |
| long (6 paragraphs) | 0.91s | **2.89s** | 9.96s | 14.5s |
| code | 2.76s | **2.97s** | 3.31s | 4.1s |

- Normal prompts: **first token ~0.9–1.2s**. Code prompts are consistently slower to first token (~3s,
  the model "thinks" before emitting code).
- The p95/outliers (e.g. a 9.96s `long` sample) are **Responses-API variance**, not our code — exactly
  the nondeterminism the multi-sample run was designed to expose.

### Reasoning-effort sweep — chat/completions, same prompt
| effort | TTFT |
|--|--|
| minimal | 5.94s* |
| low | 2.57s |
| medium | 2.32s |
| high | 2.60s |

\* The `minimal` outlier is noise; there is **no systematic relationship** between reasoning effort and
TTFT. (Note the chat/completions path shows higher TTFT than the Responses agent path above.)

### Tool isolation — Responses API, 40s abort (simple prompt)
| tools | TTFT | result |
|--|--|--|
| web_search + generate_image | 2.40s | ✅ |
| img + code_interpreter | 3.01s | ✅ |
| web_search + code_interpreter | 6.12s | ✅ |
| all 3 (ws + img + ci) | 2.61s | ✅ (no deadlock this run) |

`code_interpreter` adds ~3–6s when present. The all-3 combo completed in both of today's runs but has
deadlocked before (intermittent, upstream) — the worker's watchdog + tool-degradation handles it.

---

## Full pipeline — what blocks first token

Ordered from send to first token, against the current worker
([api/src/application/runWorker.ts](../api/src/application/runWorker.ts)).

| Stage | Where | Blocks first token? | Cost |
|--|--|--|--|
| Send → optimistic streaming bubble | [runStore.ts](../src/features/chat/runStore.ts#L56-L62) | no (sync render) | <10ms |
| Client prepare: image flush / file index / tool probe | [useChat.ts](../src/features/chat/useChat.ts#L108-L141) | delays *submit*, not the bubble | 0–7s, **only with attachments** |
| `POST /runs`: append user msg, create run, enqueue, 202 | [runService.ts](../api/src/application/runService.ts#L35-L68) | no | ~100–200ms |
| **Queue pickup (worker scale-from-zero)** | [host.json](../api/host.json#L8), [functions/runWorker.ts](../api/src/functions/runWorker.ts) | **YES** | **~1s warm → 12–42s cold** |
| Credentials decrypt (Key Vault unwrap) | [runWorker.ts](../api/src/application/runWorker.ts#L704) | yes | 50–200ms |
| Memory embed/retrieval (kicked early, overlapped) | [runWorker.ts](../api/src/application/runWorker.ts#L710-L718) | bounded 3s; usually no | ~0.8s warm, overlapped |
| settings + history (parallel) | [runWorker.ts](../api/src/application/runWorker.ts#L720-L723) | yes | ~50–200ms |
| Semantic manager (`select_action`, full thread, minimal reasoning, ≤500 output tokens) | [semanticRouter.ts](../api/src/ai/semanticRouter.ts) | **yes, but overlaps memory retrieval** | expected ~0.9–1.2s for normal threads; ~2–3s for long threads; log field `[routing] … latencyMs` provides live measurement |
| Skill provisioning (gated to skill prompts) | [runWorker.ts](../api/src/application/runWorker.ts#L746-L766) | only if a skill is matched | **~30–35s cold**, else 0 |
| buildTurns (mint image read-SAS) | [runWorker.ts](../api/src/application/runWorker.ts#L783) | yes if history has images | 0.1–1s |
| assembleTools (drops fn tools when skills mounted) | [runWorker.ts](../api/src/application/runWorker.ts#L789) | no | <5ms |
| **Model first token** (watchdog 15s / 50s w-skills, 3 attempts) | [runWorker.ts](../api/src/application/runWorker.ts#L800-L813) | **YES** | **~0.9–3s typical** |
| Stream flush → SignalR push (250ms) → UI | [runWorker.ts](../api/src/application/runWorker.ts#L715), [serverRun.ts](../src/features/chat/serverRun.ts#L55) | post-first-token | 250ms cadence; 450ms poll fallback |
| Memory **extraction** | enqueued after the reply | **no — off hot path** | 0 |

**Visible impact of semantic routing (2026-07-19 architecture):** the optimistic assistant bubble
and typing dots still render synchronously, so immediate UI acknowledgement is unchanged. The first
real token or `Generating image…` placeholder waits for the manager. With memory enabled, its call
overlaps the existing ~0.8s retrieval, so the estimated warm incremental TTFT is roughly **+0.1 to
+0.5s typical**. With memory disabled, expect roughly **+0.9 to +1.2s**. Long full threads can add
**~2–3s median** and retain normal model-tail variance. These are estimates derived from the live
Responses baseline above; query `[routing] semantic manager completed` / `latencyMs` in Application
Insights for actual production values after deployment.

---

## Ranked TTFT contributors

1. **Queue cold start (scale-from-zero): 12–42s** — dominant and variable; the reason chat feels slow
   after the app idles. `maxPollingInterval` is already 1s, so a *warm* worker grabs the job in ~1s;
   the cost is a worker scaling from zero. **Not measurable from the offline bench** — characterized via
   App Insights in the companion doc.
2. **Model first token: ~0.9–3s** (measured) — inherent; code prompts slowest; occasional ~10s
   Responses outliers.
3. **Skill provisioning: ~30–35s cold** — only when a prompt matches a skill; ordinary chat is gated
   out of this path.
4. **Memory retrieval embed: ~0.8s warm / ~2.7s cold** (measured) — overlapped with setup, 3s cap, so
   ~0 added in practice.
5. **Client prepare** — only when attaching files/images.
6. **Credentials decrypt: 50–200ms.**

---

## Tools & memory — direct answers

- **Tools enabled/disabled:** tool *probing* is client-side (~10–50ms) and off the bubble path. Server
  tool *assembly* is <5ms. The runtime cost is the tool itself: `code_interpreter` ~3–6s; the
  ws+img+ci combo is intermittently unstable (watchdog + degradation mitigates). Skill-mounting is gated
  so normal chat never pays the ~30s container cold start.
- **Memory retrieval:** overlapped with settings/history and capped at 3s
  ([DEFAULT_MEMORY_CONTEXT_BUDGET_MS](../api/src/application/runWorker.ts#L710-L718)); warm embed ~0.8s.
  Net TTFT impact warm ≈ 0.
- **Memory extraction:** scheduled **after** the assistant message completes — **zero** TTFT impact.

So neither memory layer is the cause of the slowness.

---

## Warm-path deep-dive (cold start set aside)

Goal: make sure that once the cold start is fixed, nothing else makes chat feel slow. Every warm-path
contributor below was audited in code and, where possible, measured.

### Context scaling — does a long thread / big memory+skills prompt slow the first token?
**No, only mildly.** Measured TTFT for a one-word answer over a synthetic conversation of increasing
input size (so TTFT ≈ input-prefill time, isolated from output length), 3 samples each:

| approx input tokens | TTFT median |
|--|--|
| ~1.2k | 0.91s |
| ~4.2k | 0.86s |
| ~12k | 1.02s |
| ~24k | 1.31s |
| ~48k | 1.49s |

TTFT is **essentially flat**: 1k→48k tokens adds only ~0.6s. A growing thread, a large injected memory
profile, and skill descriptions do **not** materially degrade first-token latency. Total generation
time still scales with **output** length (e.g. the "long" prompt streams ~14s), but that is visible,
streamed text — not dead wait. Reproduce: `BENCH_CONTEXT=1 npx tsx scripts/pipeline-bench.ts`.

### Memory context build — redundant Cosmos work (small, fixable)
[MemoryContextService.buildForRun](../api/src/application/memoryContextService.ts#L78-L88) does, per run:
1. its **own** `settings.get(userId)` — a **second** settings read; the worker already loads settings in
   its `Promise.all` ([runWorker.ts](../api/src/application/runWorker.ts#L720-L723)). Redundant Cosmos read.
2. the query embed (~0.8s warm) + vector `retrieve` (candidate scan, limit 200).
3. when the always-on profile is enabled, an **additional** `store.list(userId, { limit: 200 })`
   ([memoryContextService.ts](../api/src/application/memoryContextService.ts#L150-L156)) — a 200-record
   read on **every** run, then `renderMemoryProfile`.

All of this is overlapped with the history load and capped at 3s, so net warm TTFT impact is small
(~100–300ms of Cosmos that usually hides under the embed), but it is redundant work on every turn.

### Client send → first render — round-trips (modest)
[runOnServer](../src/features/chat/serverRun.ts#L72-L116):
1. **pre-submit `sync()`** — pushes the new thread + user message before submit (a full sync round-trip
   *before* the worker can start). Necessary for a brand-new thread; pure latency for existing threads.
2. `submitRun` (the `POST /runs`).
3. **post-submit `getRun()`** — an extra round-trip just to anchor the poll `since` window. The client
   already has `assistantMessageId` from the submit ack; this round-trip could be removed.
4. the poll loop **sleeps `interval` (450ms) before the first read**, so without SignalR the first
   content can lag ~450ms behind the worker's first write. **SignalR push (250ms cadence) is the fast
   path**; the poll is the fallback — so SignalR reliability directly governs warm responsiveness.

### Tools — first *text* is delayed by execution (perceived latency)
For a tool-using turn the model emits the **tool call** first, executes it server-side, then resumes
with text. So time-to-first-*text* = model-decide + tool-exec + resume:
- `web_search` (Tavily) ~1–2s, `generate_image` ~5–15s, `code_interpreter` container ~3–6s (cold ~30s).
- The UI masks this with a live tool-call card ("Searching…"/"Generating image…"), so the user sees
  motion, but actual prose is delayed by the tool. This is the main warm-path "slow" perception for
  tool turns, and it is inherent to tool use.

### Other warm-path notes
- **History load** pulls all non-deleted thread messages (no cap); fine now, but a very long thread
  grows the Cosmos read + the input token count (mild TTFT effect per the scaling table).
- **Streaming writes** flush to Cosmos + SignalR every 250ms; not a first-token cost.
- **Credentials decrypt** 50–200ms; **image read-SAS** minted serially per attachment in
  [buildTurns](../api/src/application/runWorker.ts#L206-L230) (only when a user turn has images).

### Warm-path verdict
The warm path is healthy: **end-to-end warm ≈ submit + ~1s queue + ~0.3s setup + ~1–1.5s model ≈ 3–4s**,
stable across thread size. After the cold start is fixed there is **no second hidden bottleneck** — only
small, optional cleanups (below). The one genuinely variable warm cost is **tool execution** on
tool-using turns, which is inherent.

### Optional warm-path cleanups (small, independent of cold start)
1. **Pass the already-loaded settings into `buildForRun`** to drop the duplicate settings read.
2. **Cache / bound the profile `list(200)`** (or fold it into the same query as retrieval) so it isn't a
   fresh 200-record read every turn.
3. **Drop the post-submit `getRun()`** — anchor the poll `since` from the submit ack's run `createdAt`.
4. **Verify SignalR connects reliably** before generation so the 450ms poll is truly only a fallback.
5. (Optional) **cap history** sent to the model for very long threads (last N turns + summary) — not
   needed at current sizes per the scaling data.

---

## Recommendations (prioritized)


1. **Fix the cold start — the single biggest win.** Decide between (companion doc has detail):
   - **A) `alwaysReady = 1`** on the Flex plan → cold ~40s → ~1–2s. Recurring cost (~1 small instance
     billed continuously). Reversible, low-risk.
   - **B) Run `processRun` inline in the `POST /runs` handler** (stream via SignalR), dropping the
     storage-queue hop → cold becomes a normal HTTP cold start (~3–5s), no recurring cost. Larger change
     (client-supplied runId for Stop, cooperative cancel on disconnect). Recommended with you available
     to live-validate.
2. **Measure the real cold number** post the 60s→1s polling change before committing to A or B — some of
   the historical 12–42s was poll backoff, not pure scale-from-zero.
3. **Trim model first token for code prompts** (~3s) only if needed — minor vs the cold start.
4. **Leave reasoning effort as-is** — no TTFT benefit to lowering it.
5. **Keep the skill-mount gate and watchdog** — they already remove the worst tool-combo stalls.

---

## How to reproduce

```
cd api
# add WATAI_PROBE_BASEURL + WATAI_PROBE_KEY (and deployment names) to api/.env
npx tsx scripts/pipeline-bench.ts          # BENCH_REPEAT defaults to 5
BENCH_CONTEXT=1 npx tsx scripts/pipeline-bench.ts   # TTFT vs input (prefill) size
BENCH_REAL=1   npx tsx scripts/pipeline-bench.ts   # reproduce the real production tool combo
```

Measures the model-facing steps (embed, agent TTFT × prompts × repeats, reasoning sweep, tool
isolation, and context scaling) and writes
[pipeline-bench-report.{md,json}](memory-system/pipeline-bench-report.md). The **queue/cold-start**
portion needs the deployed endpoint (App Insights) — out of scope for this offline harness.
