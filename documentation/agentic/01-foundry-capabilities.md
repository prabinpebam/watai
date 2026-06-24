# 01 — Foundry Agent Service: Capability Reference

A complete, build-oriented reference of what **Microsoft Foundry Agent Service** offers and
which parts Watai uses. This is the "what exists" document; how Watai wires it is in
[02-architecture-and-adoption.md](02-architecture-and-adoption.md) and the feature specs.

> Terminology note: Microsoft is mid-rename. Docs appear under both `/azure/ai-foundry/…`
> and `/azure/foundry/…`; the older portal is "Foundry (classic)". The **classic** Agents
> are deprecated (retire 2027-03-31). This spec targets the **new** Foundry Agent Service
> and the **Responses API**.

---

## 1. What an agent is

An agent is an AI app that uses a catalog model to **reason about a request and take
autonomous actions** to fulfill it. Unlike a chatbot that only generates text, an agent
can **call tools, access external data, and make decisions across multiple steps**.

Every agent combines three parts:

- **Model** — a Foundry-catalog model that provides reasoning/language (e.g. GPT-4.1,
  GPT-5 series, o3, deep-research models).
- **Instructions** — goals, constraints, behavior (a system/developer prompt, or code).
- **Tools** — access to data or actions (search, files, code, APIs, other agents).

---

## 2. The Responses API — the single entry point

The **Responses API** is the one endpoint behind **every** agent type. It gives any
framework/runtime access to Foundry models **plus platform tools** (web search, file
search, code interpreter, image generation, memory, MCP). It supersedes Chat Completions
for agentic work because it natively models **tool calls, multi-step state, and typed
output items**.

- Surface: `POST <endpoint>/openai/v1/responses`
- Auth: `Authorization: Bearer <token>` (a user API key on a plain Azure OpenAI endpoint,
  or a Microsoft Entra token / `DefaultAzureCredential` on a Foundry project endpoint).
- Body essentials: `model`, `input` (string or typed items), `tools` (array), `tool_choice`
  (`auto` | `required` | a specific tool), `stream` (bool), optional `conversation` id for
  server-managed multi-turn state.
- Output: `response.output` is an **array of typed items** — `message`,
  `web_search_call`, `image_generation_call`, `code_interpreter_call`, `function_call`,
  etc. Text lives in `output_text`; sources live in `annotations` (e.g. `url_citation`).

You can call the Responses API in **two ways**:

1. **Inline tools** — pass a `tools` array directly on the request. No persistent agent
   resource required. Example (web search):
   ```bash
   POST <endpoint>/openai/v1/responses
   Authorization: Bearer <token>
   { "model": "gpt-4.1-mini",
     "input": "Tell me about the latest news about AI",
     "tool_choice": "required",
     "tools": [ { "type": "web_search" } ] }
   ```
2. **Agent reference** — create a versioned agent (a saved model+instructions+tools
   bundle), then invoke it by reference. Example body fragment:
   `{ "agent": { "type": "agent_reference", "name": "my-agent", "version": "1" } }`.

Watai's primary integration is **(1) inline tools from the browser** (see adoption Path A),
with **(2) agent references** reserved for Deep Research and any shared managed agents.

### 2.1 Streaming events

With `stream: true` the response is SSE. Key event types Watai handles:

| Event | Meaning |
| --- | --- |
| `response.created` | Run started; carries the response id. |
| `response.output_text.delta` | Incremental assistant text (the live answer). |
| `response.output_text.done` / `response.text.done` | Text segment finished. |
| `response.output_item.done` | A typed item finished — inspect `item.type` for tool calls, citations, image results. |
| `response.completed` | Run finished; `event.response.output_text` holds the full text. |
| `response.error` | Run failed. |

This maps cleanly onto Watai's existing `parseSse` generator in
[../../src/ai/http.ts](../../src/ai/http.ts); only the event vocabulary changes.

---

## 3. Agent types

| Type | Authoring | Runtime | Best for | Watai use |
| --- | --- | --- | --- | --- |
| **Prompt agents** | Foundry portal, SDK, or REST (instructions + model + tools) | Fully managed; no compute to run | Fast start, production agents without custom orchestration | Optional: a saved **Deep Research** agent; a shared **image** agent |
| **Hosted agents** (preview) | Code: Agent Framework, LangGraph, OpenAI Agents SDK, Anthropic SDK, GitHub Copilot SDK, or custom; packaged as container/zip | Foundry runs the container with a managed endpoint, autoscale, dedicated Entra identity, session state, observability | Custom orchestration, multi-agent systems, custom protocols | Not required for v1; a future option if Watai wants server-side orchestration |
| **Responses API direct** | Your own code calls the Responses API | You host the calling code (here: the browser) | Getting Foundry models + tools into an app you already run | **Primary** path for Watai |

The hosted-agent deploy flow (from the quickstart) is `azd ai agent init` → `azd provision`
→ `azd ai agent run` (local) → `azd deploy` → `azd ai agent invoke`. Watai does **not** need
this for v1 but it is the path if a managed Watai agent is desired later.

---

## 4. The tool catalog

Foundry splits tools into **built-in** (service-executed) and **custom** (your endpoints),
plus **Toolbox** bundles. The table below is the full catalog with Watai relevance.

### 4.1 Built-in tools

| Tool | Type | What it does | Watai relevance |
| --- | --- | --- | --- |
| **Web search** | `web_search` | Real-time public-web retrieval with **inline citations**. Recommended way to add grounding. Backed by Grounding with Bing. | **Core** — agentic chat grounding ([03](03-agentic-chat-and-tools.md)) |
| **Code Interpreter** | `code_interpreter` | Runs Python in a sandbox for math, data analysis, charts. | **High** — "analyze this", charts, calculations |
| **Custom Code Interpreter** (preview) | — | Customize CI resources, packages, Container Apps env. | Later |
| **File Search** | `file_search` | Vector search over uploaded files / proprietary docs. | **Medium** — "chat with my doc/thread attachments" |
| **Azure AI Search** | — | Ground on an existing Azure AI Search index. | Optional (power users) |
| **Azure Functions** | — | Let the agent call your Azure Functions. | Optional |
| **Function calling** | `function` | Agent requests a function; **your app executes it** and returns the result. | **Core** — client-side tools (Watai persistence API, local actions) |
| **Image Generation** (preview) | `image_generation` | Generate images in-conversation; streaming partial images; edit/inpaint. Needs `gpt-image-1`. | **Core** — agentic images ([05](05-agentic-image-generation.md)) |
| **Browser Automation** (preview) | — | Drive a browser via natural language. | Out of scope (risk) |
| **Computer Use** (preview) | — | Operate computer UIs. | Out of scope (risk) |
| **Microsoft Fabric** (preview) | — | Connect a Fabric data agent. | Out of scope |
| **SharePoint** (preview) | — | Chat with private SharePoint docs. | Out of scope |

### 4.2 Custom tools

| Tool | What it does | Watai relevance |
| --- | --- | --- |
| **Model Context Protocol (MCP)** | Connect to tools on an MCP server endpoint; per-request `server_label` / `server_url` / `headers` override via structured inputs. | **Medium** — let power users attach MCP servers |
| **OpenAPI tool** | Call external HTTP APIs from an OpenAPI 3.0/3.1 spec (anonymous, API key, or managed-identity auth). | Optional |
| **Agent-to-Agent (A2A)** (preview) | Call other agents via A2A endpoints. | Later (multi-agent) |
| **Toolbox** (preview) | Bundle many tools into one **MCP-compatible** endpoint, versioned, with centralized auth. | Later (clean way to manage Watai's tool set) |

### 4.3 Structured inputs

Tool config (file IDs, vector-store IDs, MCP server URL/headers) can be **templated** in the
agent definition and **overridden at runtime** per request, without creating a new agent
version. Useful for per-user knowledge bases or per-request MCP endpoints.

---

## 5. Web search / grounding (detail)

- **Request:** `tools: [{ "type": "web_search" }]`. Optional `user_location`
  (`{ type: "approximate", country, city, region }`) and `search_context_size`
  (`low` | `medium` | `high`, default `medium`).
- **Domain-restricted:** `web_search` with `custom_search_configuration`
  (`project_connection_id`, `instance_name`) backed by **Bing Custom Search** to limit the
  searchable web to chosen domains.
- **Output:** assistant `output_text` plus `annotations` of `type: "url_citation"` with
  `url`, `title`, and `start_index`/`end_index` offsets into the text.
- **Display requirement:** Grounding-with-Bing terms require showing **both** the website
  URLs **and** the Bing search-query link, in the form provided. Watai must render
  citations (see [03](03-agentic-chat-and-tools.md) §UI).
- **Cost & data boundary:** web search uses Grounding with Bing (a First-Party Consumption
  Service). It **incurs cost** and **sends the search query outside the Azure compliance
  boundary**. Only paid/PAYG subscriptions are eligible (not free-credit subscriptions).
- **Admin control:** can be disabled per-subscription via
  `az feature register --name OpenAI.BlockedTools.web_search --namespace Microsoft.CognitiveServices`.
- **Treat results as untrusted input** (prompt-injection surface) — validate before acting.

---

## 6. Deep Research (detail)

The standalone **Deep Research tool is deprecated**. The current pattern:

- Create an agent (or inline call) whose **model is `o3-deep-research`** and whose tools
  include **web search** (`WebSearchPreviewTool` / `{ "type": "web_search" }`).
- A **`gpt-4o`** model is used to **clarify the question and scope** the task before the
  deep-research model runs the multi-step web investigation.
- **Models / regions:** `o3-deep-research` (version `2025-06-26`), Global Standard, in
  **West US** and **Norway East** only. Quotas: default `3K RPS / 3M TPM`, enterprise
  `30K RPS / 30M TPM`. Access: automatic if you already have Azure OpenAI `o3`; otherwise a
  request form.
- **Output:** a **structured, fully-cited report** documenting the answer, the sources, and
  the model's reasoning path — auditable by design.
- Long-running: drive with `stream: true` and (optionally) a server-managed `conversation`
  so the UI can show live progress. Full feature spec: [04-deep-research.md](04-deep-research.md).

---

## 7. Agentic image generation (detail)

- **Tool:** `tools: [{ "type": "image_generation" }]`; requires the **`gpt-image-1`**
  deployment plus a compatible **orchestrator** model (`gpt-4o`/`gpt-4o-mini`/`gpt-4.1*`/
  `o3`/`gpt-5*`) in the **same Foundry project**.
- **Header:** the Responses request must carry
  `x-ms-oai-image-generation-deployment: <gpt-image-1 deployment name>`.
- **Output item:** `{ "type": "image_generation_call", "result": "<base64>", "status": "completed" }`
  alongside the assistant `message`.
- **Parameters:** `size` (`1024x1024` | `1024x1536` | `1536x1024` | `auto`), `quality`
  (`low` | `medium` | `high` | `auto`), `background` (`transparent` | `opaque` | `auto`),
  `output_format` (`png` | `webp` | `jpeg`), `output_compression` (0–100), `moderation`
  (`auto` | `low`), `partial_images` (0–3 for streaming), and `input_image_mask`
  (`image_url` base64 or `file_id`) for **inpainting**.
- **Advantages over the plain Image API:** **streaming partial images** (perceived latency)
  and **flexible inputs** (accepts image file IDs as well as raw bytes), all inside a
  conversation the model understands. Full feature spec:
  [05-agentic-image-generation.md](05-agentic-image-generation.md).

---

## 8. Enterprise, identity, security, observability

- **Agent identity:** each agent can have a dedicated **Microsoft Entra** identity for
  scoped resource access, including OAuth **On-Behalf-Of (OBO)** passthrough.
- **Auth options for tools/MCP:** key-based, Microsoft Entra (managed identity), OAuth
  identity passthrough, or unauthenticated where appropriate. Prefer Entra when supported.
- **Networking:** private networking / BYO-VNet (hosted agents run each session in a
  VM-isolated sandbox). Note: web search requires **normal network access** (no VPN/Private
  Endpoint on that path).
- **Safety:** integrated content filters and guardrails to mitigate unsafe output and
  **cross-prompt injection (XPIA)**.
- **Observability:** end-to-end tracing of every model call and tool invocation, metrics,
  and Application Insights integration.
- **Lifecycle:** create → test (playground/local) → trace → evaluate → optimize → publish →
  monitor. Agents are **versioned**; publish to a stable endpoint; distribute via Teams /
  M365 Copilot / Entra Agent Registry; protocols include OpenResponses, Activity,
  Invocations, and **A2A**.

---

## 9. Constraints that shape Watai's design

1. **Project vs. plain endpoint.** Web search, image-gen tool, file search, deep research,
   and MCP need a **Foundry project** endpoint and (for search) a **Bing connection** — not
   just an Azure OpenAI key. Watai must detect this and degrade. (See decision A3/A7.)
2. **Bing cost + data boundary + consent.** Must be surfaced to the user before use (A8).
3. **Region-locked deep research.** `o3-deep-research` is West US / Norway East only.
4. **Untrusted tool output.** Web/file/MCP results are an injection surface — never auto-
   execute destructive actions from them without confirmation.
5. **Preview status.** Image generation, deep-research-via-web-search, MCP, hosted agents,
   and several tools are **preview**; pin API versions and feature-flag them.
6. **Display obligations.** Bing citations must be shown verbatim.

---

## 10. Source documentation

Primary Microsoft Learn references used for this spec (capture date 2026-06):

- Foundry Agent Service overview — `learn.microsoft.com/azure/ai-foundry/agents/overview`
- Agent tools overview / tool catalog — `…/agents/concepts/tool-catalog`
- Web search tool — `…/agents/how-to/tools/web-search`
- Image generation tool (preview) — `…/agents/how-to/tools/image-generation`
- Deep research (classic, deprecated) + migration note — `…/agents/how-to/tools/deep-research`
- Grounding with Bing Search — `…/agents/how-to/tools/bing-grounding` and `…/bing-tools`
- Hosted-agent quickstart (azd / VS Code) — `learn.microsoft.com/azure/foundry/agents/quickstarts/quickstart-hosted-agent`
- Responses API quickstart — `…/agents/quickstarts/responses-api`

> Preview features change. Re-verify tool names, parameters, models, and regions against the
> live docs at implementation time; pin the API version you test against.
