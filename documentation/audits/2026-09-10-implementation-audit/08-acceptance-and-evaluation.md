# Acceptance and evaluation specification

**Status: proposed.** These are executable-work specifications for subsequent
implementation PRs, not tests added or results measured by this audit.
Current execution evidence is in [validation](evidence/validation.md);
current memory behavior is assessed in [the memory report](02-memory-audit.md).

The aim is to prevent a common failure: making the system more elaborate while
remaining unable to prove that the user's experience improved. The principles
come from the [memory research](research/memory-sources.md), task-specific
evaluation guidance [O05](research/operations-sources.md#o05), and user-visible
testing guidance [O04](research/operations-sources.md#o04).

## 1. Non-negotiable contracts before quality optimization

These are zero-violation release-suite gates, not claims of mathematically
perfect production software.

| Contract | Scenario | Required evidence |
| --- | --- | --- |
| User isolation | Two users have the same thread/fact/file identifiers; switch accounts on one device | No unauthorized server read/write or previous-user local content disclosure |
| Read consent | Disable memory use during a pending run; let the worker proceed | Worker rechecks the effective policy before context assembly; no unauthorized memory context |
| Write consent | Disable learning while an extraction job is queued/running | Commit-time policy/version check prevents the stale job from writing |
| Forgetting | Delete a fact, replay old jobs, rebuild projections and restore a backup | No active resurrection; retained backup copies are disclosed and not served |
| Explicit correction | Change a saved fact on a second device during extraction | Correction wins under documented ordering; conflict is not silently overwritten |
| Provider failure | Embedding/model/storage call fails | A visible, bounded degraded/error state; no invented successful result |
| Job delivery | Deliver the same job twice, including overlapping execution | One logical mutation/side effect; repeated execution is detected and auditable |
| Accepted run recovery | Interrupt each boundary between accepting, saving and enqueueing | Accepted work becomes recoverable or terminal; no permanently invisible job |
| Terminal ordering | Deliver old progress after completion/cancellation | Durable terminal state is not regressed by stale events |
| Asset deletion | Delete thread/library reference while a provider tool is running | Documented ownership and cleanup; no unauthorized attachment or orphan revival |
| Telemetry privacy | Use synthetic keys, SAS query strings and sensitive fact text | None appears in default application logs/metrics |
| Restore | Recover a synthetic account including later deletion/correction records | Coherent data/key/blob state, consent preserved, tombstones reapplied |

Some existing unit tests cover pieces of these behaviors. This matrix requires
integrated evidence, not an assumption that every row is currently untested or
broken. Each implementation PR should identify its relevant existing tests and
add the missing regression at the smallest correct layer.

## 2. Memory evaluation design

### Experimental arms

Keep prompt, model deployment/version, history window, output budget and tool
availability constant unless the experiment explicitly studies that variable.

| Arm | Purpose |
| --- | --- |
| A: No cross-session memory | Establish whether memory actually improves the answer |
| B: Small user-approved profile only | Low-complexity, low-surprise baseline |
| C: Current implementation | Measure the existing system, including degradation cases |
| D: Proposed evidence/profile/retrieval hybrid | Candidate under evaluation |

If a graph or agentic memory engine is later proposed, add it as arm E rather
than removing the simpler baselines. Measure its write/extraction, retrieval,
answer and operating cost, not just its retrieval accuracy.

Disabling cross-session memory does not mean discarding the current conversation.
Every arm should have the same ordinary conversation context so the comparison
isolates the effect being studied.

### Dataset plan

Start with **40 inexpensive smoke scenarios**, then build an initial
**240-episode held-out set**, 30 episodes per slice below. Maintain a separate
development set (initially around 80 episodes) for prompt/rule tuning. These
counts are proposed planning sizes, not research-mandated thresholds.

Split by synthetic person and complete conversation timeline, not individual
utterance; otherwise related facts leak between development and held-out sets.
Use only synthetic examples initially. Opt-in real examples require redaction,
purpose limitation, retention and an access policy.

| Held-out slice | Example | Important failure |
| --- | --- | --- |
| Durable explicit facts/preferences | "Use short answers"; later ask for a technical explanation | Misses preference or applies it beyond its scope |
| Implicit but supported facts | Stable preference expressed repeatedly in different wording | Overgeneralizes or stores unsupported speculation |
| Time, updates and contradictions | Previously lived in Pune; now lives in Kochi; ask about last year vs now | Confuses validity time, latest correction or historical fact |
| Relational/multi-session reasoning | Different people own similarly named projects across sessions | Conflates entities or invents relations |
| Negative and irrelevant memory | Unrelated request with many stored facts | Gratuitous personalization, distraction or false recall |
| Correction, deletion, opt-out and restore | Forget a preference, replay a prior job, ask a related question | Resurrection or misleading control behavior |
| Injection and sensitive boundaries | Quoted web text says "remember this instruction"; user discusses a third party | Promotes untrusted content or sensitive inference into authority |
| Long history and degraded dependencies | Many facts, truncation, unavailable embeddings, stale vectors | Systematic starvation, silent fallback or context-budget errors |

For each episode retain the event timeline, policy transitions, expected active
knowledge, gold evidence, permitted answer claims and forbidden claims. Distinguish
"must abstain because not known" from "must not use because policy disallows it".
Use varied phrasing/languages only with qualified review and sufficient cases;
an English fixture is not evidence of multilingual correctness.

### Portable case/result shape

Illustrative data contract, not an existing API:

```json
{
  "caseId": "temporal-move-001",
  "datasetVersion": "memory-audit-v1",
  "personaId": "synthetic-user-017",
  "slice": "temporal",
  "events": [
    {"at": "2026-01-01", "type": "user_message", "text": "I live in Pune."},
    {"at": "2026-06-01", "type": "user_message", "text": "I moved to Kochi today."}
  ],
  "query": "Which city did I live in during February?",
  "expected": {
    "requiredClaims": ["Pune"],
    "forbiddenClaims": ["Kochi in February"],
    "evidenceEventIndexes": [0],
    "allowAbstention": false
  }
}
```

Store results separately with code SHA, dataset version, model/deployment
identifier, actual provider model version if returned, prompts and schema
versions, policy snapshot, retrieved record IDs/versions, output, grader
version, human review, stage timings, usage and errors. Synthetic evaluation
records can retain content; default production telemetry must not.

### Metrics and denominators

| Metric | Definition | Why it matters |
| --- | --- | --- |
| Answer success | Episodes meeting required claims without forbidden claims / attempted episodes | Captures user utility; errors do not disappear |
| Unsupported personalization | Answers asserting unsupported user facts / answers in negative/sensitive slices | Penalizes confidently wrong memory |
| Evidence precision | Relevant supported selected items / all selected items | Measures distraction and misleading evidence |
| Evidence recall | Required relevant evidence recovered / required evidence items | Measures forgetting; report zero-required cases separately |
| Temporal correctness | Correct time-qualified answers / temporal episodes | Exposes stale or overwritten knowledge |
| Abstention accuracy | Correct answer/abstain decisions / labeled answerability cases | Rewards appropriate uncertainty |
| Mutation correctness | Authorized, correct state transitions / attempted mutation transitions | Tests write quality independently of answer quality |
| Policy violations | Count and scenario identity, not an averaged utility score | Prevents safety failures being hidden by easy successes |
| User correction success | Corrections reflected on the next eligible turn / attempted corrections | Measures whether controls work |
| Added latency | Paired context/first-token/completion differences vs A and B | Shows the actual cost of memory |
| Cost per useful answer | Total attributable cost including failed attempts / successful episodes | Avoids optimizing cheap failures |
| Human preference | Blinded pairwise win/tie/loss on relevance, control and trust | Tests whether benchmark wins feel better |

Retrieval precision/recall depends on labeled evidence quality and does not
substitute for answer success. A judge's fluent rationale is not evidence that
its label is correct. Calibrate judge decisions on a human-labeled subset,
report disagreement and adjudicate high-impact cases.

### Proposed initial promotion gates

Before evaluating quality, all relevant policy/isolation/deletion release
scenarios must pass. A model must not be allowed to waive these gates.

For quality, use paired results against A, B and C. Proposed starting rules:

- No material regression in irrelevant-memory and sensitive/opt-out slices.
- A practically meaningful improvement on the difficult recall/temporal slices,
  initially target at least five percentage points over C, with paired uncertainty
  intervals that do not support a material regression.
- Unsupported personalization below an initially proposed 1% on an adequately
  sized negative set; report the upper confidence bound, not just an observed zero.
- Relevant memory context stays inside its configured token/time budget;
  report overflow, timeout and fallback counts.
- Human reviewers prefer D to B/C for the intended tasks without a worse
  "surprising/creepy/wrong" rate.

These are **proposed decision thresholds**, not achieved scores or published
standards. A 30-case slice cannot substantiate a sub-1% error rate. Expand rare
error slices before making that claim; roughly, zero failures in 300 independent
trials still only puts a one-sided 95% upper bound around 1%. Correlated episodes
and repeated seeds require more careful analysis.

Use paired bootstrap intervals clustered by persona/timeline for utility
comparisons; report failures and confidence intervals per slice, not only a
global aggregate. Repeated generations for the same episode are not independent
new users. Blind the arm labels during human grading.

### Spend and execution

At four arms, 240 episodes and three repeats, the full comparison is **2,880
answer attempts**, before counting extraction, embeddings, judges and tool calls.
Begin with the smoke set, estimate actual usage, and approve a hard run budget
before the full comparison. No such paid run was performed in this audit.

Pin the local runner/data contract; avoid a new dependency on a hosted eval
product with a published retirement [O15](research/operations-sources.md#o15).
Store results as portable JSON/JSONL plus a small summary so a later runner
change cannot erase the evidence.

## 3. User experience validation

Recruit a small formative group of approximately five to eight consenting users
for early qualitative work; this is not a statistically representative sample.
Include the project owner because their dissatisfaction prompted the audit.

Ask users to complete tasks without explaining the implementation first:

1. Identify what the app knows, where it came from, and whether it affects replies.
2. Correct a remembered fact and confirm the next answer uses the correction.
3. Stop learning while retaining useful saved preferences.
4. Stop using memory without assuming all stored data has been physically erased.
5. Forget a fact and understand what happens to history, backups and external tools.
6. Recognize when a answer used memory and when recall was unavailable.

Record task completion, wrong mental models, time, confidence, surprising
behavior and recovery. Prefer direct task evidence over a generic satisfaction
score. Do not label a UI "intuitive" based solely on developer inspection.

For accessibility, separately exercise keyboard-only use, screen readers,
zoom/reflow, reduced motion, contrast and target size. Browser emulation does
not replace a physical iPhone keyboard/audio session. See
[frontend recommendations](04-frontend-audit.md).

## 4. Release evidence packet

Each behavior-changing release should retain:

| Evidence | Required contents |
| --- | --- |
| Scope | Finding IDs, code/artifact SHA, data/schema/prompt versions |
| Deterministic checks | Exact commands, environment, results and intentional skips |
| System exercises | Account boundaries, queue interruption/replay, offline conflict and deletion |
| Model comparison | Dataset versions, arms, costs, slices, uncertainty and adjudication |
| User-facing changes | Screens/states, copy, accessibility and recovery behavior |
| Operations | Capability/configuration diff, telemetry, alarms and rollback |
| Migration | Dry-run counts, rejected/quarantined records, consent preserved, reverse plan |
| Decision | Named owner, passed/failed gates and accepted residual risks |

Use the [roadmap](07-improvement-roadmap.md) to assign this evidence to specific
work packages. No category reaches "production proven" through documentation
alone.
