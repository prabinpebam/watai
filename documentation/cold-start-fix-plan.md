# Cold-start fix plan — always-ready instances (Flex Consumption)

Status: **Phase 1 (IaC) implemented & validated; Phase 2 (apply) pending interactive `az login`.**
Decisions resolved autonomously — see [§9](#9-decisions-needed-from-you).

## 1. Goal

Eliminate the user-visible cold start identified in [ttft-audit-report.md](ttft-audit-report.md): an idle
app pays **~12–42s** on the first prompt because the **storage-queue worker scales from zero**,
independently of the HTTP instance that accepted the `POST /runs`. Target after fix: first prompt on an
idle app behaves like a warm one (**~3–4s end-to-end**).

Chosen approach: **Option A — Flex Consumption "always ready" instances** (keep N instances loaded and
polling). This is the low-risk, reversible option from the audit. We are explicitly **not** doing Option B
(inline `processRun` in the HTTP handler) in this plan.

## 2. Current state (verified)

- Plan: **Flex Consumption `FC1`**, Linux, Node 20 — [infra/main.bicep](../infra/main.bicep) L218–266.
- `scaleAndConcurrency`: `maximumInstanceCount: 40`, `instanceMemoryMB: 2048`, **no `alwaysReady`** → scales to zero.
- Functions in the app:
  - **HTTP group (`http`)**: all `app.http(...)` routes incl. `negotiate` (SignalR) — [api/src/functions/api.ts](../api/src/functions/api.ts), [health.ts](../api/src/functions/health.ts).
  - **Queue triggers (each is its own `function:<name>` scale unit)**: `runWorker`, `memoryWorker`, `imageWorker` — [runWorker.ts](../api/src/functions/runWorker.ts), [memoryWorker.ts](../api/src/functions/memoryWorker.ts), [imageWorker.ts](../api/src/functions/imageWorker.ts).
- Queue polling already hot: `maxPollingInterval: 1s` — [api/host.json](../api/host.json) L8. So a **warm** worker grabs the job in ~1s; the cost is purely scale-from-zero.
- Live app: `func-watai-cbroocyg3omrk` in **`rg-watai-dev`** (note: not `rg-watai`).

## 3. How Flex "always ready" works (from Microsoft docs)

- Per-function-scaling groups: `http`, `durable`, `blob`. **Queue triggers are not in any group** — they are
  addressed individually as **`function:<FUNCTION_NAME>`**.
- Set counts with name/value pairs: `http=1`, `function:runWorker=1`, etc. Default is `0`.
- Billing: always-ready instances are billed **continuously** (baseline GB-s) whether or not they execute —
  there are no free grants on that baseline. They also count against the regional **250-core** quota (trivial here).
- Zone redundancy caveat: if ZR is enabled you must use **≥2** per group. Our plan does **not** set
  `zoneRedundant`, so **count = 1 is allowed**. (Verify in §6.)
- App-init timeout is 30s (unchangeable); irrelevant once instances stay warm.

## 4. What to keep warm (and why)

| Target | Removes | Keep warm? | Rationale |
|--|--|--|--|
| `function:runWorker` | the **12–42s** queue scale-from-zero | **Yes — required** | This is the dominant cold-start cost on the hot path. |
| `http` | ~3–5s HTTP front-door cold start on `POST /runs` + `negotiate` | **Recommended** | Without it the first POST and the SignalR negotiate still cold-start; keeps the whole send→stream path warm. |
| `function:memoryWorker` | background extraction cold start | **No** | Off the hot path (runs after the reply). Don't pay for it. |
| `function:imageWorker` | image-gen worker cold start | **Optional/No** | Image gen is already long and user-initiated; lower priority. Decide in §9. |

Minimum viable = `function:runWorker=1`. Smoothest = `http=1` **+** `function:runWorker=1`.

## 5. Single source of truth: Bicep, not a CLI one-off

A CLI `always-ready set` takes effect immediately **but is wiped by the next `bicep`/infra deploy** (the
deployment reconciles `alwaysReady` back to whatever the template says). So the durable fix is to **codify
`alwaysReady` in the Bicep**, and optionally also run the CLI for instant effect before the next deploy.

## 6. Task list

### Phase 0 — Prereqs & baseline
1. **Re-authenticate Azure CLI** — the session expired (`az login` requires your interactive MFA; I can't do that step). Target tenant `a419…`, subscription `Visual Studio Enterprise`.
2. **Confirm plan facts** once authed:
   - `az functionapp show -n func-watai-cbroocyg3omrk -g rg-watai-dev --query "properties.functionAppConfig.scaleAndConcurrency"`
   - Confirm `zoneRedundant` is false (so count=1 is legal): check the plan/site config.
3. **Capture a baseline cold number** (so we can prove the win). Let the app idle ~20–30 min, then send one prompt and time first token; and/or App Insights KQL:
   ```kusto
   requests
   | where timestamp > ago(1d) and cloud_RoleName == "func-watai-cbroocyg3omrk"
   | where name has "runWorker"
   | project timestamp, duration, success
   | order by timestamp desc
   ```

### Phase 1 — Codify in infra (durable) — DONE
4. **Parameterize** the counts in [infra/main.bicep](../infra/main.bicep): `alwaysReadyHttp` (default 1), `alwaysReadyRunWorker` (default 1), both `@minValue(0) @maxValue(5)`. ✅ applied.
5. **Add `alwaysReady`** to `functionAppConfig.scaleAndConcurrency` via `concat(...)` so a `0` omits the entry. ✅ applied.
6. **Set values** in [infra/main.dev.bicepparam](../infra/main.dev.bicepparam): `alwaysReadyHttp = 1`, `alwaysReadyRunWorker = 1`. ✅ applied.
7. **Lint**: `az bicep build` + `az bicep build-params` both pass. ✅

### Phase 2 — Apply
8. **Deploy infra** (preferred, durable):
   `az deployment group create -g rg-watai-dev -f infra/main.bicep -p infra/main.dev.bicepparam`
   - Review the what-if first: append `--what-if` to confirm the only change is `alwaysReady` (no destructive diffs to Cosmos/KV/storage).
9. **(Optional) Immediate CLI** for instant effect without waiting on a full deploy:
   `az functionapp scale config always-ready set -g rg-watai-dev -n func-watai-cbroocyg3omrk --settings http=1 function:runWorker=1`

### Phase 3 — Verify & measure
10. **Confirm config applied**:
    `az functionapp scale config always-ready list -g rg-watai-dev -n func-watai-cbroocyg3omrk -o table`
11. **Measure cold path gone**: idle the app ~30 min, send a prompt, confirm first token ~3–4s (was 12–42s). Re-run the idle test 2–3×.
12. **Watch always-ready metrics** for a day: `AlwaysReadyFunctionExecutionCount`, `AlwaysReadyUnits`, `InstanceCount` (via `az monitor metrics list`).

### Phase 4 — Cost & guardrails
13. **Confirm cost** against the [Functions pricing page](https://azure.microsoft.com/pricing/details/functions/) and actual metrics (rough estimates in §7).
14. **Set a budget alert** on `rg-watai-dev` so the continuous baseline can't surprise us.

## 7. Cost estimate (from the Azure Retail Prices API, eastus2, 2026-06-30)

Exact rate pulled from `prices.azure.com` — product **Flex Consumption**, meter **Always Ready Baseline**:
**$0.000004 / GB-second**. The baseline bills the **full instance memory continuously** (whether or not it
executes). Using Azure's 730 h/month = 2,628,000 s, per-instance baseline = `GB × 2,628,000 × $0.000004`:

| Config | Always-ready instances | Baseline @ 2048MB (2 GB) | Baseline @ 512MB (0.5 GB) |
|--|--|--|--|
| `function:runWorker=1` only (**chosen — Option B**) | 1 | **~$21.0/mo** | ~$5.3/mo |
| `http=1` + `function:runWorker=1` | 2 | ~$42.0/mo | ~$10.5/mo |

On top of the baseline you also pay, but these are **negligible** at personal traffic:
- **Always Ready Execution Time** $0.000016/GB-s — only during the ms an always-ready instance is *actively* running a function.
- **Always Ready Total Executions** $0.40 per million (no free grant on the always-ready meters).
- On-demand instances (scale-out beyond always-ready) keep their normal on-demand rate + free grants.

So the realistic bill for the **chosen config is ~$42/month** (≈ the earlier "$30–$50" assessment; the
plan's first-draft "$90–$180" used a wrong ~$0.0000173/GB-s rate and is superseded).

**Cost levers (§9):**
- **Worker-only** (`alwaysReadyHttp = 0`): **~$21/mo**, still removes the 40s stall; accepts a ~3–5s front-door cold start on the first POST after idle.
- **Drop `instanceMemoryMB` 2048 → 512** (app-wide, 0.25 core): **~4× cheaper** (~$10.5/mo for both). Risk: the run worker streams model output + Key Vault unwrap + Cosmos I/O; verify under concurrency before committing.

## 8. Risks, caveats, out-of-scope

- **CLI vs IaC drift** — addressed by §5 (codify in Bicep). Flag for whoever runs deploys.
- **Always-ready ≠ never recycles** — the platform can still replace an instance; always-ready means a
  replacement is kept ready, so steady-state cold starts effectively disappear, but a rare post-deploy/
  platform-recycle blip can occur.
- **Skill provisioning cold (~30–35s)** is a *separate* cold start on the user's Azure OpenAI container, only
  on skill-matched prompts. **Out of scope** here (gated off normal chat already).
- **`visibilityTimeout: 30s`** in [host.json](../api/host.json) — unrelated to cold start, but note a run
  exceeding 30s after a worker crash could be redelivered. Not touched by this plan.
- **Single instance memory size** is app-wide in Flex (can't give the worker 2 GB and HTTP 512 MB separately).
- **No in-place plan migration** — staying on Flex; nothing to migrate.

## 9. Decisions needed from you

Resolved autonomously (you were away) — defaults chosen, all reversible. Override any by changing the
bicepparam and redeploying:

1. **Warm targets:** ✅ **worker-only** — `function:runWorker=1`, `http=0` (**Option B, ~$21/mo** at 2048MB, per §7). Removes the dominant 12–42s queue scale-from-zero; accepts a ~3–5s HTTP front-door cold start on the first POST after a long idle (acceptable per owner).
2. **Instance memory:** ✅ **keep 2048MB** — not risking 512MB without a concurrency load check.
3. **imageWorker:** ✅ **left cold** — off the hot path; avoids extra baseline cost.
4. **Apply path:** ✅ **Bicep deploy (durable)** — codified in IaC and deployed to `rg-watai-dev`.

**To go fully warm later:** set `alwaysReadyHttp = 1` (~$42/mo total). **To disable:** set `alwaysReadyRunWorker = 0`.

## 10. Acceptance criteria

- First prompt on a ~30-min-idle app reaches first token in **~3–4s** (no 12–42s stall), verified ≥3×.
- `always-ready list` shows the agreed counts; Bicep + bicepparam contain them (no drift on next deploy).
- Always-ready cost visible in metrics and within the agreed budget; budget alert in place.
