# 09 — Provisioning & Enablement Runbook (make every tool *Available*)

This is the **end-to-end runbook** that turns the Settings → Tools screen from this:

> Code interpreter · **Unavailable** · Web search · **Unavailable** · File search · **Unavailable**

into this (on your **Visual Studio Enterprise** subscription):

> Code interpreter · **On** · File search · **On** · Image generation · **On**  _(Web search: deferred — §1)_

It covers the **why**, the **Azure CLI provisioning** of the Foundry side, the **Watai
configuration**, and the **verification** for each tool. It builds on the design in
[08-implementation-plan.md](08-implementation-plan.md) and the capability reference in
[01-foundry-capabilities.md](01-foundry-capabilities.md).

> The provisioning script is in [../../infra/foundry/provision.ps1](../../infra/foundry/provision.ps1).

---

## 0. Why the tools say "Unavailable" (root cause)

Watai's three service-side tools run **inside the AI plane**, not the browser:

| Tool | Where it runs | What it requires of the endpoint |
| --- | --- | --- |
| **Image generation** | Browser → `/images/generations` | A plain Azure OpenAI key. **Already works** (shown "On"). |
| **Code interpreter** | Service (Responses API) | A **Responses-capable Foundry endpoint**. |
| **Web search** | Service (Grounding with Bing) | A **Foundry project + a Bing connection** + a **pay-as-you-go subscription**. |
| **File search** | Service (vector stores) | A **Foundry project endpoint** (vector stores created on demand). |

The screenshot shows endpoint = **Standard** (a plain Azure OpenAI key). A plain key has no
Foundry project and no Bing connection, so capability detection probes those tools and gets a
`400/404` → **Unavailable**. The fix is to **provision an Azure AI Foundry resource + project
(+ a Bing connection for web search)** and point Watai's endpoint at it.

---

## 1. Scope on this subscription (Visual Studio Enterprise — locked)

This runbook targets **your existing Visual Studio Enterprise subscription**; we are **not**
creating a new subscription. On a credit/Visual-Studio subscription, **everything works except
Grounding with Bing (web search)**, which Microsoft restricts to **pay-as-you-go** subscriptions
([01 §5](01-foundry-capabilities.md)). So **web search is deferred** here; the other tools are
fully provisioned and functioning.

| Tool | On VS Enterprise | Notes |
| --- | --- | --- |
| **Image generation** | ✅ Works (already) | Plain Image API — no project needed. |
| **Function calling** (history/threads/memory) | ✅ Works | Client-side; needs a Responses-capable endpoint. |
| **Code interpreter** | ✅ Works | First-party Azure usage on your credits — no PAYG gate. |
| **File search** (vector stores) | ✅ Works | First-party Azure usage on your credits — no PAYG gate. |
| **Web search** (Grounding with Bing) | ⛔ Deferred | PAYG-only; blocked on credit subscriptions. Not a quota issue. |

> **Web search later, without Bing:** it can be added on *any* subscription by implementing it as
> a **client-side function tool** backed by a BYO third-party search API (Google Programmable
> Search / Brave / Tavily), reusing the existing citations UI. That is **out of scope for this
> runbook** (we are leaving the Bing/web-search part); it is noted as a future enhancement only.

---

## 2. Decisions to make (parameters)

| Parameter | Default | Notes |
| --- | --- | --- |
| `SubscriptionId` | current (`az account show`) | Your **Visual Studio Enterprise** subscription — kept as-is (no new subscription). |
| `Location` | `eastus2` | Broad model coverage. Deep Research needs `westus`/`norwayeast` (not one of our 5 tools). |
| `ResourceGroup` | `watai-ai-rg` | New RG for the AI plane (separate from the persistence plane in `infra/main.bicep`). |
| `AccountName` | `watai-foundry` | The `Microsoft.CognitiveServices` account, kind `AIServices`. |
| `ProjectName` | `watai` | The Foundry project (holds connections like Bing). |
| `ChatModel` | `gpt-4.1` | Or `gpt-5`/`gpt-4o`. Maps to Watai's `models.chat`. |
| `MiniModel` | `gpt-4.1-mini` | Orchestrator/clarifier. Optional. |
| `ImageModel` | `gpt-image-1` | Maps to Watai's `models.image` (your "gpt 2"). |
| `EnableWebSearch` | **`false`** | Deferred — Grounding with Bing is PAYG-only; leave off on VS Enterprise. |

> The AI plane is **the user's own** — `infra/main.bicep` stays persistence-only. This runbook
> provisions into **your** subscription; Watai never deploys it for you.

---

## 3. Prerequisites (one-time)

```pwsh
# Azure CLI (you have 2.84.0). Update if older than ~2.60:
az upgrade

# Sign in + pick the subscription (PAYG if you want web search):
az login
az account set --subscription "<SubscriptionId>"

# Extensions used by the script (cognitive-services deployments + connections):
az extension add --name cognitiveservices --upgrade 2>$null
az extension add --name ml --upgrade 2>$null   # for project connections (Bing)

# (Web search only) Make sure the web_search tool isn't blocked at the subscription:
az feature show --namespace Microsoft.CognitiveServices --name OpenAI.BlockedTools.web_search `
  --query properties.state -o tsv
# If it shows 'Registered' (i.e. blocked), unregister to allow it:
# az feature unregister --namespace Microsoft.CognitiveServices --name OpenAI.BlockedTools.web_search
```

---

## 4. Provision the Foundry side (CLI)

Run the script (idempotent — safe to re-run):

```pwsh
cd c:\projects\watai
./infra/foundry/provision.ps1 `
  -Location eastus2 `
  -ResourceGroup watai-ai-rg `
  -AccountName watai-foundry `
  -ProjectName watai `
  -ChatModel gpt-4.1 -MiniModel gpt-4.1-mini -ImageModel gpt-image-1
  # -EnableWebSearch defaults to $false (Bing is PAYG-only; deferred on VS Enterprise)
```

What it does, step by step (so you can run any step by hand):

### 4.1 Resource group + AI Foundry account

```pwsh
az group create -n watai-ai-rg -l eastus2

az cognitiveservices account create `
  -n watai-foundry -g watai-ai-rg -l eastus2 `
  --kind AIServices --sku S0 --custom-domain watai-foundry --yes
```

### 4.2 Model deployments (chat, mini, image)

```pwsh
# Chat
az cognitiveservices account deployment create -g watai-ai-rg -n watai-foundry `
  --deployment-name gpt-4.1 --model-name gpt-4.1 --model-version 2025-04-14 `
  --model-format OpenAI --sku-name GlobalStandard --sku-capacity 50

# Orchestrator / clarifier (optional)
az cognitiveservices account deployment create -g watai-ai-rg -n watai-foundry `
  --deployment-name gpt-4.1-mini --model-name gpt-4.1-mini --model-version 2025-04-14 `
  --model-format OpenAI --sku-name GlobalStandard --sku-capacity 50

# Image ("gpt 2")
az cognitiveservices account deployment create -g watai-ai-rg -n watai-foundry `
  --deployment-name gpt-image-1 --model-name gpt-image-1 --model-version 2025-04-15 `
  --model-format OpenAI --sku-name GlobalStandard --sku-capacity 1
```

> **Re-verify model versions** (`az cognitiveservices model list -l eastus2 -o table`) — preview
> versions change. Code interpreter + file search need **no extra model**; they are built-in to
> the Responses runtime once the endpoint is a Foundry endpoint.

### 4.3 Web search (Grounding with Bing) — DEFERRED on this subscription

Skipped: the script runs with `-EnableWebSearch:$false`, so it does **not** create the Bing
resource or the project connection. Grounding with Bing is **PAYG-only** and ineligible on Visual
Studio Enterprise.

If you ever move the Foundry resource to a PAYG subscription, re-run with `-EnableWebSearch:$true`
and add the **Grounding with Bing** connection in the Foundry portal (<https://ai.azure.com> →
project → **Management center → Connected resources → + New connection → Grounding with Bing
Search**). The browser only ever sends `tools:[{type:"web_search"}]`; the Bing key stays in the
connection, never in the browser. Until then, Watai shows **Web search** disabled with a tooltip.

### 4.4 Grab the endpoint + key

```pwsh
az cognitiveservices account show -n watai-foundry -g watai-ai-rg `
  --query properties.endpoint -o tsv
# -> https://watai-foundry.services.ai.azure.com/   (or .cognitiveservices...)

az cognitiveservices account keys list -n watai-foundry -g watai-ai-rg --query key1 -o tsv
```

---

## 5. Point Watai at the Foundry endpoint

In Watai → **Settings → Models & keys**:

1. **Resource name or base URL** → paste the endpoint host, e.g.
   `https://watai-foundry.services.ai.azure.com`.
   Watai normalizes any Foundry host to `…/openai/v1` automatically
   ([../../src/ai/http.ts](../../src/ai/http.ts) `v1Url`).
2. **API key** → the `key1` from §4.4.
3. **Chat model** → `gpt-4.1` · **Image model** → `gpt-image-1` (your "gpt 2").
4. Go to **Settings → Tools → Detect capabilities** → **Code interpreter** and **File search**
   flip to **On** (Image is already On). **Web search** stays disabled with a "Needs a Foundry
   project" tooltip — expected and correct on this subscription.

> **Why this now works (code shipped with this runbook):** (1) capability detection now treats any
> **Foundry host** (`…services.ai.azure.com`), not only URLs containing `/api/projects/`, as
> tool-capable ([../../src/ai/http.ts](../../src/ai/http.ts) `isFoundryHost`); and (2) **file-search
> availability is derived from the Foundry endpoint** — vector stores are created on demand, so it
> no longer depends on probing an empty store (that chicken-and-egg previously kept File search
> "Unavailable"). Code interpreter is probed; web search is probed (and stays off here without a
> Bing connection). Verified by [../../src/ai/capabilities.test.ts](../../src/ai/capabilities.test.ts).

---

## 6. Verify each tool

| Tool | Test prompt | Expected |
| --- | --- | --- |
| **Code interpreter** | "Plot compound growth of 500/month at 7% for 20 years." | A **Ran code** tool card; a chart/answer. |
| **File search** | Settings → Tools → **Knowledge base → Add file** (a PDF/MD), then ask a question only it answers. | A **Searched your files** card + a **file citation**. |
| **Web search** | _Deferred on VS Enterprise (needs PAYG)._ | Toggle stays disabled with a "Needs a Foundry project" tooltip. |
| **Image** | "Make a hero image for a dev-tools launch." | A generated image with the expanded prompt. |

Acceptance criteria per tool are in [03 §9](03-agentic-chat-and-tools.md) and
[05 §9](05-agentic-image-generation.md).

---

## 7. Auth, CORS & networking (browser-direct invariant)

- **Auth:** the Foundry **account key** authorizes the Responses/files/vector-store calls — same
  BYO-key model as today. (If a future preview tool requires Entra on the data plane, acquire a
  separate **AI-plane** token, MSAL scope `https://cognitiveservices.azure.com/.default` — kept
  distinct from the persistence-plane app token. Not required for the four tools here.)
- **CORS:** the `…services.ai.azure.com` data plane is browser-callable (Watai already streams
  chat/images from the browser). If a corporate policy strips CORS, the fallback is a thin
  **same-origin proxy** in the Functions API for `/responses` only — but that would forward the
  key, so it is a last resort and off by default.
- **Networking:** web search needs **normal egress** — no Private Endpoint/VPN on that path
  ([01 §8](01-foundry-capabilities.md)).

---

## 8. Cost & governance

- **Web search (Grounding with Bing) is deferred** on this subscription (PAYG-only) — no Bing
  cost applies. Re-enable only if the resource moves to a PAYG subscription.
- **Budgets:** the orchestrator caps tool round-trips per turn; keep `search_context_size` at
  `medium` and image `quality` at `medium` for cost.
- **Admin block:** web search can be disabled per-subscription with
  `az feature register --namespace Microsoft.CognitiveServices --name OpenAI.BlockedTools.web_search`.
- **Teardown:** `az group delete -n watai-ai-rg --yes --no-wait` removes the whole AI plane.

---

## 9. Re-verify before/while running (preview surface)

Re-check against live docs at run time (these move):

- Model **names/versions/regions** (`az cognitiveservices model list -l <loc> -o table`).
- The **project + Bing connection** CLI (the portal path in §4.3 is the stable fallback).
- `Microsoft.Bing/accounts` resource type / SKU (`G1`) and `Bing.Grounding` kind.
- The exact **endpoint shape** that serves `web_search` (account-level `…/openai/v1` vs a
  project-scoped path). If it turns out to be project-scoped, set the **base URL** to the project
  endpoint (which contains `/api/projects/<project>`) — detection already handles that form too.

---

## 10. TL;DR (Visual Studio Enterprise track)

1. `./infra/foundry/provision.ps1 -Location eastus2`  (web search stays **off** by default).
2. Watai → **Settings → Models & keys** → paste the `…services.ai.azure.com` endpoint + key +
   deployment names.
3. **Settings → Tools → Detect capabilities** → **Code interpreter** + **File search** go **On**
   (Image already On).
4. Verify with the §6 prompts. **Web search is deferred** (PAYG-only) — left out by design.
