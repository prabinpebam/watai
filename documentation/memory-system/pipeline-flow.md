# Memory System — Pipeline Flow (as built)

A flowchart-led walkthrough of how Watai's memory system works **today**, derived from the
shipping code (not the spec). Use it to review behaviour and give feedback. File references point
at the live implementation.

- Storage / record shape: [memory.ts](../../api/src/domain/memory.ts)
- Write (extraction): [memoryExtractionService.ts](../../api/src/application/memoryExtractionService.ts), [memoryExtractor.ts](../../api/src/ai/memoryExtractor.ts), [memoryWorker.ts](../../api/src/functions/memoryWorker.ts)
- Read (retrieval): [memoryContextService.ts](../../api/src/application/memoryContextService.ts), [runWorker.ts](../../api/src/application/runWorker.ts)
- Models: [memoryModelService.ts](../../api/src/application/memoryModelService.ts)

---

## 1. Big picture

Two independent pipelines plus an admin-tuned model tier.

```mermaid
flowchart LR
  subgraph Write["WRITE — background extraction"]
    M[New message] --> EX[Extract memories] --> S[(Memory store)]
  end
  subgraph Read["READ — retrieval into prompt"]
    R[New run] --> RET[Retrieve + score] --> P[System prompt]
  end
  S -. lexical lookup .-> RET
  S --> UI[Sources + memory log]
  classDef store fill:#1f2937,stroke:#60a5fa,color:#fff;
  class S store;
```

---

## 2. Write pipeline (extraction)

Triggered after each message; runs async on a storage queue so chat latency is untouched.

```mermaid
flowchart TD
  A[Message saved] --> B{Role?}
  B -- user --> C[command lane]
  B -- assistant complete --> D[turn lane]
  C --> G{Eligible?\nenabled & not paused\n& autoExtract & referenceHistory}
  D --> G
  G -- no --> X1[Drop]
  G -- yes --> H{hasExtractionSignal?\nregex: remember/prefer/my dog/watai...}
  H -- no --> X2[Drop]
  H -- yes --> J{Dedupe key seen?}
  J -- yes & not failed --> X3[Reuse job]
  J -- no --> K[Enqueue job → memory-jobs queue]
  K --> W[memoryWorker.processJob]
  W --> L[Window: 5 msgs + up to 20 existing memories]
  L --> M[LLM extractor → strict JSON ops]
  M --> N[resilientParse: drop bad ops, never poison]
  N --> O[applyOperations]
  O --> P{accepted > 0?}
  P -- yes --> Q[SignalR 'memory' event → inline log]
  P -- no --> R[status ignored]
```

Gates live in [eligible()](../../api/src/application/memoryExtractionService.ts) and
`hasExtractionSignal`; window is the last 5 messages around the target.

### 2a. Operation apply + thresholds

```mermaid
flowchart TD
  OP[Op] --> T{op?}
  T -- ignore --> IG[skip]
  T -- add --> A{conf & salience\n>= lane min?}
  A -- no --> RJ[reject]
  A -- yes --> AH{sourceHash dup?}
  AH -- yes --> MG[merge into existing]
  AH -- no --> NEW[create active memory\nvisibility by salience]
  T -- merge --> MG
  T -- invalidate --> INV[status=invalidated]
  T -- suppress --> SUP[status=suppressed]
```

Lane minimums: command conf ≥0.65 / sal ≥0.40; turn conf ≥0.82 / sal ≥0.65
([applyOperations](../../api/src/application/memoryExtractionService.ts)).

---

## 3. Read pipeline (retrieval)

Budgeted at 250 ms inside the run; failure falls back to empty (never blocks chat).

```mermaid
flowchart TD
  A[Run starts] --> B[buildForRun: latest user text]
  B --> C{enabled & referenceSaved\n& not paused?}
  C -- no --> E[empty block]
  C -- yes --> D{relevance gate regex}
  D -- no --> E
  D -- yes --> F[list active memories]
  F --> G[lexical score:\n0.65·overlap +0.25·sal +0.10·conf +visibility]
  G --> H{score>=0.45 or pinned\nor top_of_mind?}
  H --> I[take 3, ~400 tokens]
  I --> J[renderMemoryContext → system prompt]
  J --> K[store refs on run → Sources UI]
```

---

## 4. Memory status lifecycle

```mermaid
stateDiagram-v2
  [*] --> active: add
  active --> active: merge
  active --> suppressed: suppress
  active --> invalidated: invalidate/superseded
  active --> deleted: user delete
  suppressed --> deleted
  invalidated --> deleted
```

## 5. Model tiers

Routine (command/turn) vs deep (rebuild). Precedence: admin override → env → chat model
([memoryModelService.ts](../../api/src/application/memoryModelService.ts)).

## 6. Built but not wired

- `embedding` stored; retrieval is **lexical only** (no vector search).
- `route` / structured profile stored; unused in retrieval.
- `threadSummaries` always empty.
- Heavy reliance on hardcoded keyword regexes for gates.
