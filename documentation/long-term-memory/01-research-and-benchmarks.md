# 01 — Research And Benchmarks

This document summarizes how leading AI assistant products and memory frameworks handle long-term memory, then extracts the design principles Watai should adopt.

Research date: 2026-06-27.

Primary sources consulted:

- [OpenAI ChatGPT Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq)
- [Claude memory blog](https://claude.com/blog/memory)
- [Claude chat search and memory help](https://support.claude.com/en/articles/11817273-using-claude-s-chat-search-and-memory-to-build-on-previous-context)
- [Claude Projects and project knowledge](https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects)
- [Claude RAG for Projects](https://support.claude.com/en/articles/11473015-retrieval-augmented-generation-rag-for-projects)
- [Gemini Personal Intelligence](https://gemini.google/overview/personal-intelligence/)
- [LangGraph memory overview](https://docs.langchain.com/oss/javascript/langgraph/memory)
- [Zep key concepts](https://help.getzep.com/concepts), [retrieving context](https://help.getzep.com/retrieving-context), and [facts](https://help.getzep.com/facts)
- [Mem0 memory types](https://docs.mem0.ai/core-concepts/memory-types), [research results](https://mem0.ai/research), and [token-efficient memory algorithm](https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm)
- [LoCoMo paper](https://arxiv.org/abs/2402.17753)
- [MemGPT paper](https://arxiv.org/abs/2310.08560)
- [CoALA paper](https://arxiv.org/abs/2309.02427)
- [mem0ai/memory-benchmarks](https://github.com/mem0ai/memory-benchmarks)

## 1. Executive Findings

The best current systems converge on these patterns:

| Pattern | Why it matters for Watai |
| --- | --- |
| Separate **short-term thread context** from **long-term user memory**. | Prevents a long conversation or one stale thread from becoming the memory system. |
| Use **memory scopes**: global user memory, project/thread memory, temporary/incognito exclusion. | Watai has threads today and may later have projects/skills; scope prevents accidental cross-contamination. |
| Provide a user-visible **memory summary** plus lower-level retrieved facts. | Users need a reviewable surface, while retrieval needs atomic records. One alone is insufficient. |
| Use **background extraction** for memory writing. | Avoids slowing down every assistant response and keeps generation logic focused. |
| Use **bounded retrieval** on the hot path. | Retrieval must be fast and token-efficient; dumping all past chats does not scale and hurts model focus. |
| Preserve **source links** and show memory usage in responses. | Trust depends on users seeing why personalization happened and how to correct it. |
| Treat memory changes as **time-aware**, not blind overwrites. | Real user facts change. The system should understand current vs old facts, not lose history. |
| Test with **semantic memory evals**, not only CRUD tests. | Memory can pass API tests while recalling the wrong thing, using deleted data, or ignoring new corrections. |

## 2. Product Benchmarks

### 2.1 ChatGPT

Observed pattern:

- Memory can use saved memories, past chats, custom instructions, files, and connected apps depending on plan/region.
- Users can enable/disable memory from Settings > Personalization > Memory.
- ChatGPT has a memory summary that updates over time and can be reviewed/edited.
- Sources can show whether custom instructions, past chats, files, or saved memories influenced a response.
- Temporary Chats do not use existing memories or create new ones.
- Saved memories and chat history are controlled separately in the legacy/current transition model.
- Memory can be used for search query rewriting when personal details improve search relevance.
- The system does not search history on every request; it decides when personalization is likely useful.
- Deleted saved memories and deleted chats are separate deletion surfaces; full deletion may require removing the memory and the source chat/file/app data.

Watai takeaways:

- Build two controls: **Reference saved memory** and **Reference chat history/thread summaries**. The UI may start with one toggle, but the data model should support both.
- Add Temporary Chat exclusion as a hard rule.
- Persist response-level memory sources so users can inspect and correct what was used.
- Avoid claiming the memory summary is the complete database; describe it as a reviewable synthesis.

### 2.2 Claude

Observed pattern:

- Claude can search past chats via RAG-style tool calls that appear in the conversation.
- Claude memory creates a summary synthesized from chat history and updates on a roughly daily cadence.
- Projects have separate memory spaces and project summaries.
- Incognito chats do not contribute to memory or chat history.
- Users can pause memory, reset memory, view/edit memory, and tell Claude to remember things directly in chat.
- Past chat citations link to original chats when previous conversations are referenced.
- Enterprise controls include organization-level disablement, exports, audit behavior, encryption, and retention policy interaction.
- Claude Projects use RAG automatically when project knowledge approaches context limits, instead of placing all project content in the prompt.

Watai takeaways:

- Scope memory by user and, later, by project/space. For now, support global user memory plus thread summaries.
- Model search-history/memory retrieval as a visible tool-like action, or at minimum show a compact memory sources panel.
- Add **pause** semantics distinct from delete: pause means do not read/write memory, but keep stored data.
- Keep source-thread links for memories and thread summaries.

### 2.3 Gemini

Observed pattern:

- Gemini Personal Intelligence connects chat history and Google apps such as Gmail, Photos, Search, and YouTube.
- Personalization is optional and source connection is user-controlled.
- Gemini emphasizes that users can manage personalization settings, Google activity, and chat history.
- It tries to reference or explain the information used from connected sources so users can verify it.

Watai takeaways:

- Future connectors should be separate memory sources with independent consent.
- Memory source provenance must be part of the schema from day one, even before Watai has external connectors.

## 3. Framework And Architecture Benchmarks

### 3.1 LangGraph

LangGraph draws a strong line between:

- Short-term memory: thread-scoped state/checkpoints, usually recent conversation history and working state.
- Long-term memory: namespaced data retrievable across threads.

It also names three useful memory types:

- Semantic: durable facts about a user or domain.
- Episodic: past experiences or examples useful for future tasks.
- Procedural: instructions or behavior rules, usually prompt-level.

LangGraph also identifies the key write-path tradeoff:

- Hot-path writes make memory immediately available and transparent, but increase latency and distract the agent.
- Background writes reduce latency and separate concerns, but require careful trigger timing.

Watai takeaways:

- Watai should use short-term message history and long-term memory as separate inputs to prompt assembly.
- Use background extraction for automatic memory writes.
- Keep explicit user commands such as "remember this" as hot-path/manual writes because the user expects immediacy.

### 3.2 MemGPT / Letta lineage

MemGPT frames memory as virtual context management: the model has a small active context and must move information between fast/active memory and slower archival memory. The important lesson is not a specific library; it is the operating-system-style split between tiers and explicit control over what enters the context window.

Watai takeaways:

- Treat the model context window as scarce runtime memory.
- The memory subsystem should decide what to page in, not ask the model to read the entire archive.

### 3.3 Zep

Zep uses a temporal knowledge graph and returns a prompt-ready Context Block. Notable patterns:

- Ingest messages and other data into a user graph.
- Store facts with validity ranges such as `valid_at` and `invalid_at`.
- Preserve invalidated facts instead of only replacing them.
- Retrieve a compact Context Block containing a user summary plus relevant facts.
- Use hybrid retrieval: semantic search, full-text search, and graph traversal.
- Vendor-reported Context Block retrieval is P95 under 200 ms.

Watai takeaways:

- Watai should store `validAt` and `invalidAt` on memory records.
- A prompt-ready Memory Context Block is the right serving abstraction.
- Start with simpler facts/entities, but keep the schema compatible with graph-like relationships later.

### 3.4 Mem0

Mem0 separates memory into layers:

- Conversation memory: current turn.
- Session memory: current task or run.
- User memory: durable personalization.
- Organizational memory: shared context.

Mem0's docs warn against storing secrets or unredacted PII in retrievable memory. Its research pages emphasize three production constraints: accuracy, token cost, and latency.

Mem0's 2026 vendor-reported results claim:

| Benchmark | Reported score | Mean retrieval tokens | Notes |
| --- | ---: | ---: | --- |
| LoCoMo | 91.6 to 92.5 overall | ~6,956 | Long-term conversational memory. |
| LongMemEval | 93.4 to 94.4 overall | ~6,787 | Multi-session and temporal memory. |
| BEAM 1M | 64.1 average score | ~6,719 | Larger production-like memory scale. |
| BEAM 10M | 48.6 average score | ~6,914 | Harder 10M-token scale; temporal/event ordering remains weak. |

The open-source [memory-benchmarks](https://github.com/mem0ai/memory-benchmarks) suite currently supports LoCoMo, LongMemEval, and BEAM with an ingest -> search -> evaluate pipeline. Its README notes that scores depend heavily on extraction model quality, embedding quality, retrieval depth, and judge model quality.

Watai takeaways:

- Optimize for **recall at a practical prompt budget**, not maximum context stuffing.
- Add lexical/entity signals alongside vector similarity.
- Include assistant-generated facts, not only user-stated facts.
- Expect temporal reasoning and contradiction resolution to need explicit eval coverage.

## 4. Academic Benchmarks

### 4.1 LoCoMo

LoCoMo was introduced in "Evaluating Very Long-Term Conversational Memory of LLM Agents". It contains long-range, multi-session conversations, each around 300 turns and 9K tokens on average, across up to 35 sessions. It evaluates question answering, event summarization, and multimodal dialogue generation.

Important finding: long-context models and RAG help, but still substantially lag human performance on long-range temporal and causal dynamics.

### 4.2 LongMemEval

LongMemEval evaluates long-term memory across single-session, multi-session, preference, knowledge-update, and temporal reasoning questions. In vendor benchmark summaries, it exposes blind spots such as remembering what the assistant itself previously said.

### 4.3 BEAM

BEAM is designed for larger token scales, including 1M and 10M-token settings. Reported categories include preference following, instruction following, information extraction, knowledge update, multi-session reasoning, summarization, temporal reasoning, event ordering, abstention, and contradiction resolution.

For Watai, BEAM is directionally important because it reflects what happens when a user's history becomes too large for a simple context-window strategy.

## 5. What Not To Copy

- Do not use raw whole-chat stuffing as the primary long-term memory strategy.
- Do not store a single editable memory summary as the only source of truth; summaries lose source traceability and make deletion/correction ambiguous.
- Do not ask the assistant to decide memory writes while also producing every normal response unless the user explicitly says "remember this".
- Do not use embeddings alone. Benchmarks and production systems increasingly combine semantic, keyword, entity, recency, and salience signals.
- Do not make deletion purely cosmetic. If a memory is deleted, suppressed, or source-deleted, retrieval must exclude it.
- Do not store secrets or hidden reasoning as memory.

## 6. Watai Design Principles From The Research

1. **Memory is a governed product surface, not just a vector store.** The user needs controls, explanations, exports, and deletion.
2. **Serve memory as a context block.** Prompt assembly consumes one bounded artifact, not arbitrary database rows.
3. **Write asynchronously, read synchronously.** Background jobs produce memory; server runs retrieve memory just before generation.
4. **Prefer additive, source-linked records.** Invalidating an old fact is better than overwriting it without history.
5. **Use layered retrieval.** Combine profile summary, explicit instructions, recent messages, atomic memories, and thread summaries.
6. **Evaluate semantic invariants.** The system must remember correct durable facts, ignore temporary chats, forget deleted facts, and handle contradictions.
