# Chat run pipeline — audit & latency benchmark (2026-06-30)

Triggered by: **"I'm not getting any chat response at all."** This records the full
prompt→render pipeline, benchmarks every step against the live production endpoint, identifies the
root cause of the no-response failure, and documents the fix.

## TL;DR

- **The model and memory layers are healthy.** Embedding is 0.7–2.2s; gpt-5.4 generation is 1–18s.
- **Root cause of "no response":** the Azure **Responses API intermittently stalls — producing zero
  output — when `code_interpreter` is offered alongside the custom function tools (`web_search`,
  `generate_image`).** The stalled stream hangs until the 120s `aiFetch` timeout aborts it; the run
  then finalizes as an **empty `error` message**, which the UI shows as no reply.
- **It is intermittent and upstream**, reproduced with direct orchestrator calls (no memory code in
  the path). Yesterday's runs hit the fast path; today's two runs both hit the stall.
- **It is NOT caused by the memory deploy** — `withTimeout` caps memory at 3s; the failure is in the
  tool-enabled Responses call.
- **Fix shipped:** a first-token **watchdog + clean retry** in the worker. If an agent attempt yields
  nothing within 45s, it is aborted and retried from scratch (safe — nothing was emitted, so no
  duplication). The intermittent stall now self-heals instead of hanging 120s and failing silently.

## The pipeline (server-authoritative + SignalR)

```mermaid
sequenceDiagram
  participant UI as Browser (UI)
  participant API as Function (HTTP)
  participant Q as Storage Queue (run-jobs)
  participant W as runWorker (queue trigger)
  participant AI as Azure AI (Responses/Embeddings)
  participant SR as SignalR

  UI->>API: POST /threads/{id}/runs (submit, after sync push)
  API->>Q: enqueue RunJob
  API-->>UI: 202 (optimistic streaming bubble seeded)
  Q->>W: dequeue (cold: ~13s pickup)
  W->>W: load run/thread/history/settings (Cosmos)
  W->>AI: embed query (memory retrieval, ≤3s budget, parallel)
  W->>AI: provision skills (code_interpreter on; listFiles + upload)
  W->>AI: runAgent (Responses API, streamed, up to 6 tool iters)
  AI-->>W: text/tool/image deltas
  W->>SR: push 'message' snapshot every ~250ms
  SR-->>UI: live tokens → render
  W->>W: finalize (persist complete/error, bump thread, enqueue extraction)
  W->>SR: push final 'message'
```

## Per-step benchmark (live endpoint `ai-project-deployments-resource`, model `gpt-5.4`)

Measured with `api/scripts/pipeline-bench.ts` (real calls via the same code the worker uses) and
App Insights request telemetry.

| Step | Measurement | Source |
|--|--|--|
| Submit run `POST /threads/{id}/runs` | ~519ms avg | App Insights `thread-runs` |
| SignalR `negotiate` | ~118ms | App Insights |
| Queue → worker pickup (cold) | ~13s | queue InsertedOn→Executing |
| Queue → worker pickup (warm) | <1s | storage-queue polling |
| Load run/thread/history (Cosmos) | ~0.1–0.4s | est. (deps sampled out) |
| **Embedding (memory query)** | **cold 2.2s / warm 0.7–1.7s** | bench Phase A |
| Agent gen, no tools — TTFT | 0.9–2.5s | bench Phase B |
| Agent gen, no tools — total | 1–18s (length-dependent) | bench Phase B |
| Reasoning effort (minimal→high) | ~1.8–2.1s (negligible) | bench Phase C |
| `web_search` alone | 1.6s | bench Phase D |
| `generate_image` alone | 1.3s | bench Phase D |
| `code_interpreter` alone | 6.5s (container spin-up) | bench Phase D |
| **`code_interpreter` + function tool** | **5–31s … or HANG → 120s abort** | bench Phase D |
| Flush cadence (SignalR push) | every 250ms | worker `DEFAULT_FLUSH_MS` |

**End-to-end:**
- Healthy, warm, no tools: **~3–22s**.
- Healthy, warm, with tools (fast path): **~5–35s**.
- **Stall path (code_interpreter + function tools): hangs to the 120s timeout → run `error`, empty
  message → no response rendered.**

## Failure analysis (ground truth)

Cosmos `runs` + `messages` for the two runs that prompted this report:

```
run 74a6629f 01:57:55  status=error  tools=[web_search,generate_image,code_interpreter,file_search]
            ERR="This operation was aborted"  → assistant msg len=0   (worker ran 123s then aborted)
run abfb19ac 01:54:39  status=error  same tools  ERR="This operation was aborted"  → msg len=0 (~135s)
```

Yesterday's runs (20:06–20:11), same tool set, all `complete` with content (len 83–127, `toolCalls=0`).

Tool-isolation benchmark (40s abort), two consecutive runs showing the **nondeterminism**:

| tools | run 1 | run 2 |
|--|--|--|
| web_search only | 1.6s ✅ | — |
| generate_image only | 1.3s ✅ | — |
| code_interpreter only | 6.5s ✅ | — |
| web_search + code_interpreter | — | **hang → abort 40s** ❌ |
| generate_image + code_interpreter | — | 31s ⚠️ |
| web_search + generate_image (no CI) | — | 3s ✅ |
| all 3 | **hang → abort** ❌ | 5s ✅ |

**Conclusion:** combining the `code_interpreter` server tool with custom function tools destabilizes
the Responses stream (zero-output stall). `aiFetch`'s 120s default timeout
([api/src/ai/http.ts](../api/src/ai/http.ts)) then aborts it, and the worker finalizes the run as an
empty `error`. **Mounting skill file_ids makes it deterministic:** `code_interpreter` with skill
files takes ~36s to first byte and, combined with the function tools, hangs every time (bench: 3/3;
prod: 3/3 errored). The worker mounted skills on *every* `code_interpreter` run, so every run
deadlocked. The memory query embedding is bounded to 3s by `withTimeout` and is not in the failure
path.

## Fix

Four coordinated changes in [api/src/application/runWorker.ts](../api/src/application/runWorker.ts):

1. **Skill-mounting gate.** Skills are provisioned + mounted only when the prompt actually calls for
   one (`selectSkills` keyword match or a `/tag`). Ordinary chat → no skill files → `code_interpreter`
   stays on its fast path, so no deterministic deadlock.
2. **Drop function tools when skills are mounted** (`assembleTools`). A skill/code run offers
   `code_interpreter` (+ `file_search`) *without* `web_search`/`generate_image`, so the slow skill
   container can't deadlock against the function tools.
3. **Graceful tool degradation** (`streamAgentWithRetry` + `toolsForAttempt`). On a zero-output
   stall, retry attempt 2 with `code_interpreter` dropped, then attempt 3 with no tools (always
   answers). Retrying only while nothing has been emitted keeps it duplicate-free. `maxAgentAttempts`
   default **3**.
4. **Adaptive first-token watchdog.** **15s** when no skills are mounted (fast container — surface a
   stall quickly), **50s** when skills are mounted (the container legitimately needs ~36s).

Together: ordinary chat is fast again; skill prompts run `code_interpreter` without deadlocking; any
residual stall self-heals via degradation instead of failing empty after 120s. Tests in
[runWorker.test.ts](../api/src/application/runWorker.test.ts) cover clean retry → `complete`,
persistent stall → `error` (no duplicate), tool degradation, the mounting gate, and the function-tool
drop.

## Recommendations / follow-ups

1. **Reduce/observe the tool combination.** Investigate offering `code_interpreter` without the
   custom function tools in the same request (or as a separate iteration). Track the Azure Responses
   API behavior; this is an upstream instability.
2. **Lower the hard Responses timeout** (currently 120s) toward the watchdog so a true hang fails
   faster even on the final attempt.
3. **Disable trace/dependency sampling temporarily for deep diagnosis** — `host.json`
   `samplingSettings` currently drops worker traces and dependency timings, which is why per-step
   server timing had to be reconstructed via a local benchmark.
4. **Surface a fast, friendly error** to the UI when all attempts stall, instead of a silent empty
   bubble.

Regenerate the benchmark: `cd api && npx tsx scripts/pipeline-bench.ts` (reads `WATAI_PROBE_BASEURL` /
`WATAI_PROBE_KEY`). Raw numbers: `documentation/memory-system/pipeline-bench-report.{md,json}`.

---

# TTFT audit — prompt → first token (2026-06-30, follow-up)

## Measured breakdown
| stage | time | note |
|--|--|--|
| frontend submit (sync push + `POST /runs`) | ~0.5–1s | two round-trips: sync, then submitRun |
| **storage-queue pickup** | **2s warm → 12–42s cold** | dominant + variable; `alwaysReady: null` so the app scales to zero |
| worker pre-model (creds + history + memory embed ~1s) | ~1.5s | embed is inherent |
| model first token (gpt-5.4, Responses API) | ~1s | reasoning effort has negligible TTFT impact (measured) |
| SignalR push → render | fast | frontend renders each push immediately; the 450ms poll defers to push |

The queue pickup is variable because HTTP and queue triggers scale **independently** on Flex
Consumption — a warm HTTP instance (handling the POST) does not warm the queue worker, which pays its
own scale-from-zero.

## Shipped (free, deployed — commit `ccce99e`)
- **Queue polling 60s → 1s** (`host.json` `extensions.queues.maxPollingInterval`, + `batchSize` 16,
  `visibilityTimeout` 30s). A warm instance now grabs the run job in ~1s instead of waiting out the
  60s poll backoff. (Helps only when an instance is alive; does not by itself fix true
  scale-from-zero.)
- **Parallelized worker setup** ([runWorker.ts](../api/src/application/runWorker.ts)): the memory
  query-embedding starts from the submitted prompt text immediately and the settings + history reads
  run via `Promise.all`, so the embed overlaps setup instead of running after it.

Net: **active-session TTFT ~5s → ~3.5–4s.** The warm floor is the inherent memory embed (~1s) +
model first token (~1s) + queue (~1s) + submit (~0.5s).

## Open decision — cold start (~40s on the first prompt after the app idles to zero)
Needs either recurring cost or an architecture change, so it's the user's call (raised, user
delegated while away — deferred rather than spend money or deploy an unvalidated refactor):
- **A) `alwaysReady=1`** on the Flex plan → cold ~40s → ~1–2s. Recurring cost (~1×2 GB instance
  billed continuously). Reversible.
- **B) Run `processRun` inline in the `POST /runs` handler** (stream via SignalR), dropping the
  storage-queue hop → cold becomes a normal HTTP cold start (~3–5s), no recurring cost. Larger change
  (durability on client disconnect via cooperative cancel, client-generated `runId` for Stop, the
  frontend submit-while-streaming flow). Recommended as the next focused change **with the user
  available to live-validate.**
- **Measure first:** the 60s→1s polling change may already cut much of the 12–42s if it was poll
  backoff rather than pure scale-from-zero — confirm on real cold runs before committing to A or B.
