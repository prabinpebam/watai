# Evidence Contract

Status: DESIGN, NOT IMPLEMENTED. Version: 0.4. Date: 2026-09-12.
This is the proposed recorder interchange contract, not a report of a passing run.

## Requirements

| ID | Requirement |
| --- | --- |
| EV-01 | Preserve independent product, execution, visual, integration and artifact observations. |
| EV-02 | Represent unknown, unavailable, redacted, omitted and observed-empty states differently. |
| EV-03 | Record observation order, document identity, monotonic times and cross-source uncertainty. |
| EV-04 | Retain reconstructable state changes and explicit gaps; never silently truncate. |
| EV-05 | Keep safe content sufficient for semantic review, not only hashes or detector summaries. |
| EV-06 | Bind immutable evidence to deployed identities, recorder, scenario, coverage and evaluator versions. |
| EV-07 | Protect credentials, account data and captured artifacts before they leave the browser/process. |
| EV-08 | A missing required observation blocks qualification even if all available assertions pass. |

## Run Package

One unique, append-only directory per attempt, including failed startup attempts:

```text
test-results/deployed-eval/<run-id>/<scenario-id>/<attempt-id>/
  metadata.json
  actions.jsonl
  events.jsonl
  checkpoints.jsonl
  deltas.jsonl
  capture-health.jsonl
  screenshots/
  media/
  artifacts/
  manifest.json
  evaluation/
    coverage.json
    detector-report.json
    semantic-review-input.json
    semantic-review-result.json
    verdict.json
```

These are future output paths, not files supplied by this planning task.
Playwright traces/video may be added only under the privacy rules below. The manifest
records absent optional artifacts and missing required artifacts explicitly. A killed
run must leave the available package marked incomplete, not disappear from the index.

The recorder writes observations. Evaluators write derived timelines, findings and
verdicts separately. A later evaluator must be able to read the original package
without rerunning the real provider or relying on an earlier evaluator's conclusions.

## Typed Envelope

Run metadata must bind the flow/variant version, reviewed capture-design ID/digest,
observer topology and resolution policies, action-driver version, initial-state manifest,
actual deployed frontend/API/config identities, browser/environment, oracle/rubric/DS
versions, and recorder calibration. Missing bindings prevent qualification. Record
discovery/calibration/candidate/production as separate evidence classes, not a label an
evaluator may change after seeing the result.

The following TypeScript is a specification sketch, not a validated runtime schema.
The implementation milestone must provide versioned serialization and validators.

```ts
type Observation<T> =
  | { state: 'observed'; value: T }
  | { state: 'unavailable' | 'redacted' | 'not-applicable'; reason: string }
  | { state: 'omitted-by-profile'; profileId: string; reason: string }
  | { state: 'partial'; value: T; missing: string[]; reason: string };

interface EvidenceEvent {
  schemaVersion: '1.0';
  runId: string;
  scenarioId: string;
  attemptId: string;
  contextId: string;
  pageId: string;
  documentId: string;
  frameId: string;
  source: 'runner' | 'dom' | 'animation-frame' | 'network' | 'media' | 'server';
  sourceSequence: number;
  receivedSequence: number;
  monotonicMs: number;
  receivedAt: string;
  clockId: string;
  actionId?: string;
  kind: string;
  payload: Observation<unknown>;
}

interface CaptureCheckpoint {
  checkpointId: string;
  event: EvidenceEvent;
  captureStartedMs: number;
  captureFinishedMs: number;
  product: Observation<ProductObservation>;
  execution: Observation<ExecutionObservation>;
  visual: Observation<VisualObservation>;
  integration: Observation<IntegrationObservation>;
  artifacts: Observation<ArtifactObservation>;
  healthRef: string;
}
```

Empty arrays are legitimate only after a successful read of that layer. Do not invent
`active: false`, zero jobs, an empty artifact list, or a ready state when no observation
interface exists. Read access to internal state is optional; fabricating or injecting
internal state is forbidden. Missing mandatory capabilities are coverage blockers.

## Layer Contents

### Product and Execution

Capture the route, selected thread/entity IDs, account role alias, settings/feature
configuration identity, and safe observed state. Prefer public behavior and normal
API responses. Read-only product instrumentation is allowed only if actually deployed
and reviewed; a test-only store export is not production evidence.

Execution observations include real run/message/job IDs when exposed, status, observed
retry/cancel/terminal transitions, duration, and bounded safe error codes. Record the
source of each value. A displayed label is UI evidence, not proof of backend state.

Do not infer server ordering from local receipt time, nor infer parent-child message
relationships solely from role alternation. Retain actual IDs and logical/order/server
timestamps separately. If the relationship cannot be established, mark it unknown.

### Visual

The visual tree contains detailed nodes, contextual nodes and abstract region records.
It need not contain every DOM node. Each retained node observation includes fields
selected by its declared resolution profile, where applicable:

- Page/frame/document ID, recorder node ID, parent ID, sibling position and node kind.
- Separately observed domain ID, accessible role/name, text/content reference and length.
- Presence, DOM order, bounding rectangles, client rectangles and scroll-container chain.
- Relevant computed display, visibility, opacity, pointer-events, overflow, transform,
  stacking, dimensions, font, foreground/background/border and motion properties.
- Disabled, inert, hidden, selected, expanded, checked, pressed, busy and live-region state.
- Focus identity, selection where safe, viewport/visualViewport geometry, zoom/DPR and scroll.
- Image decode/load/error/natural dimensions, font readiness, media/canvas observations.
- Animation identity/play state/timing and observed geometry over the transition.
- Clip intersections, sampled hit targets and screenshot/media references as observations,
  not a single unqualified `visible: true` verdict.

Use a stable recorder-assigned WeakMap identity per retained node lifetime; abstracted
descendants do not need individual IDs until promoted. A domain message ID
is an additional field, not a replacement for DOM identity: remounts and duplicate DOM
instances must remain detectable. New documents receive new IDs. Keep old/new logical
IDs when the product hands an optimistic placeholder over to a server message.

Capture the semantic surface tree and its layout/visibility ancestors, including
hidden or offscreen relevant nodes. Do not record only elements already judged visible.
For virtualized lists, distinguish unmounted records from captured hidden DOM; the
recorder cannot assert inventory completeness from visible rows alone.

Safe test text must remain available for semantic review through content-addressed
blobs. A text hash alone cannot establish correctness. Exact raw text and normalized
comparison text are different fields; normalization is a derived evaluator operation.

### Resolution Metadata and Abstract Regions

Every region identifies its `resolutionProfileId`, level (`detailed`, `context` or
`abstract`), selected fields, temporal/paint sampling policy and interval of applicability.
Profile changes are timestamped events, never an unnoticed change in the file format.

An abstract record represents a real subtree boundary. It contains a retained region ID,
parent/position, semantic role/name if safely observed, boundary bounds/visibility,
activity version and an omission declaration. Example fragment:

```json
{
  "regionId": "history-sidebar",
  "resolutionProfileId": "chat-submit-sidebar-summary-v1",
  "level": "abstract",
  "observedAtMs": 125,
  "bounds": { "x": 0, "y": 0, "width": 260, "height": 850 },
  "visible": { "state": "observed", "value": true },
  "activityVersion": 3,
  "children": {
    "state": "omitted-by-profile",
    "reason": "No sidebar-content task in this phase; boundary effects remain observed"
  }
}
```

`omitted-by-profile` is a visual-projection omission descriptor, not an observed-empty
array or `not-applicable` claim about the real app. Keep this distinct from redaction,
unsupported access and accidental loss. A future runtime schema must represent all four
without collapsing them into null or an empty list.

The viewer replays an abstract region as an abstract region, not reconstructed children.
Promotion carries a new checkpoint and effective observation time. Earlier detail remains
omitted, even if a later checkpoint exposes the same descendants. A detector requiring
those fields must return insufficient evidence for the earlier interval.

Lossless reconstruction applies to the declared captured projection. It does not mean
the abstraction of the original DOM is lossless. Budget pressure cannot retroactively
change a required profile into a cheaper one or authorize omission of critical fields.

### Integration and Artifacts

Record request IDs, method, sanitized origin/path template, start/end times, status,
error category and permitted response fields. Authorization headers, cookies, SAS
queries, CIAM tokens and provider keys are never evidence payloads. WebSocket events
must be captured only through supported read-only observation and safe payload rules.
Transport observation is not permission to alter or fulfill responses.

Artifacts retain actual downloaded bytes, digest, MIME, decoded dimensions or parsed
structure, and the UI element/action that delivered them. Record expected transformations
before comparing a preview with a download; transformed media need not be byte-identical.
Existence in storage is distinct from accessible delivery in the required UI surface.

## Ordering, Deltas and Correlation

### Timestamped Mutation Journal

The primary deliverable is a seekable JSON timeline of the task flow. Store JSONL
incrementally for bounded writing; an offline viewer/export may assemble a `timeline.json`
index without requiring one enormous in-memory file. The timeline includes the baseline,
ordered changes, unchanged-duration records, checkpoints and capture gaps. The evaluator
must be able to inspect what preceded and followed a failure, not just the final state.

Each retained detailed mutation record must retain:

- Document/frame identity, source sequence, batch ID and index within that batch.
- Monotonic `observedAtMs`, time-origin/clock identity and separate receiver timestamp.
- Mutation type, target node identity, parent/sibling anchors and affected attribute or
  text field; old value and reconstructable new value where observed.
- Added/removed subtree references, safe text splices or content references, and explicit
  uncertainty when a before/after value was not recoverable.
- Related action ID when correlation is observed; no invented causal association.

At abstract resolution, a timestamped region-activity record may stand in for internal
mutation payloads under the frozen profile. It reports the observed activity scope/count
where known and preserves boundary changes; it does not claim per-descendant replay.
Both representations retain sequencing and explicit resolution metadata.

Native MutationRecord has no mutation timestamp. `performance.now()` at observer
delivery timestamps observation, not the precise write to the DOM. Preserve record order
within the batch, with shared observation time when appropriate. Do not distribute
fabricated timestamps among records. Additional browser instrumentation may provide
finer timing only when independently supported and qualified; record its provenance.

Enable old-value capture for relevant attributes/character data. Do not assign every
record the target's current value at callback time: several writes may have occurred
before delivery. Reconstruct intermediate values from ordered old-value records where
possible; otherwise label missing transition detail. Same-task DOM changes are not
automatically proof that the browser painted those states. Keep mutation, geometry and
paint observations separate while retaining all their evidence.

Illustrative timeline below is a compact presentation, not the full event schema. Times
are observation times. It demonstrates a failure that a final-state check would miss:

```json
{
  "documentId": "page-1-document-1",
  "timeBasis": "document-monotonic-ms",
  "events": [
    { "seq": 1, "observedAtMs": 0, "kind": "checkpoint", "messageOrder": [] },
    { "seq": 2, "observedAtMs": 110, "kind": "action", "actionId": "send-1", "name": "submit" },
    { "seq": 3, "observedAtMs": 125, "kind": "childList", "batchId": "b1", "batchIndex": 0, "insert": "prompt-1", "parent": "messages", "beforeSibling": null },
    { "seq": 4, "observedAtMs": 310, "kind": "childList", "batchId": "b2", "batchIndex": 0, "insert": "reply-1", "parent": "messages", "beforeSibling": "prompt-1" },
    { "seq": 5, "observedAtMs": 316, "kind": "frame", "messageOrder": ["reply-1", "prompt-1"] },
    { "seq": 6, "observedAtMs": 345, "kind": "childList", "batchId": "b3", "batchIndex": 0, "remove": "reply-1", "parent": "messages" },
    { "seq": 7, "observedAtMs": 345, "kind": "childList", "batchId": "b3", "batchIndex": 1, "insert": "reply-1", "parent": "messages", "beforeSibling": null },
    { "seq": 8, "observedAtMs": 350, "kind": "frame", "messageOrder": ["prompt-1", "reply-1"] }
  ]
}
```

Seeking to event 5 exposes the inversion; event 8 does not erase it. A viewer must support
stepping by event/frame/action, comparing layers, inspecting text/geometry/focus/scroll,
and opening correlated paint evidence. It is a faithful replay of captured observations,
not a re-execution of arbitrary captured HTML/scripts or a pixel-perfect browser emulator.
Missing ranges are displayed as gaps, never interpolated into a fictional correct state.

### Ordering and Reconstruction Rules

1. Assign a monotonically increasing sequence in each source before buffering.
2. Retain receiver order separately; never silently reorder sources by wall-clock time.
3. Record time-origin calibration and uncertainty for every page/frame/runner clock.
4. Correlate using observed action/request/run/message/artifact IDs when available.
5. Save an initial checkpoint, lossless ordered structural/text/attribute deltas, frame
   samples and periodic checkpoints. Removed nodes need retained identity and safe
   subtree content; deletion must not make the preceding state unreconstructable.
6. Include insert/remove/reparent, sibling reorder, text/attribute, layout, focus,
   scroll, media and navigation changes. MutationObserver alone misses several of these.
7. Byte-identical samples may be run-length encoded with first/last times, sample count
   and sequence range. Do not quantize away pixel movement or replace raw deltas with
   only detected anomalies. Compression must round-trip the declared evidence fields.

A DOM checkpoint, screenshot and server event are not one atomic observation.
Screenshot metadata records request/start/completion and surrounding checkpoint IDs.
If content changed during the acquisition bracket, retain that fact; do not claim the
image depicts one exact intermediate checkpoint. Cross-tab causal order must not be
invented from a convenient merge of timestamps.

## Capture Health and Completeness

Each health record includes active observers, page visibility, last event/frame times,
queue bytes, sequence gaps, dropped/omitted fields, serialization failures, disconnects,
capture duration and feature support. The final manifest includes:

- Requested versus obtained layers and surfaces, with reasoned capability limitations.
- Observation interval, first/last action, all document navigations and reconnects.
- Expected and received sequence ranges; observer detach/install gaps.
- Missing screenshot/trace/artifact records and incomplete checkpoint chains.
- Recorder/transport buffer peaks, per-channel limits, overflow actions and diagnostics.
- Recorder performance calibration identity and measured perturbation on this environment.

Required-channel loss yields `INSUFFICIENT_EVIDENCE`, not `CLEAN`. Product failures
already observed remain failures even if another channel is incomplete. Background
tabs may stop animation frames; label that condition explicitly and do not claim
their invisible compositor output was sampled. Capture catch-up on return.

The final outcome vocabulary is `PASS`, `FAIL`, `BLOCKED`, `INSUFFICIENT_EVIDENCE` or
`NOT_RUN`. Only `PASS` is eligible for promotion. Capture health is checked before a
semantic reviewer is allowed to issue a clean verdict.

Retain independent fields behind that summary: execution outcome, per-claim product
outcome (`pass`, `fail`, `undetermined`), evidence sufficiency, failure layer and release
eligibility. A recorder timeout and a reliably observed prompt inversion can coexist:
the product finding remains `fail`, evidence elsewhere is insufficient, and promotion
is blocked. A capture failure never erases an observed product failure.

Record phase entry/exit, reached branch conditions, actionability waits and the bounded
post-terminal reconciliation interval. Unreached required phases are unqualified, not
passing because their detectors saw no events. Missing required evidence or unresolved
semantic judgment prevents aggregate `PASS`, even if the runner exited successfully.

## Privacy and Integrity

Use dedicated accounts and approved non-sensitive inputs. Record safe values only;
unknown fields default to unavailable until a capture policy permits them. Hashing a
secret does not make it safe to capture. Authentication and credential-entry screens
have a separate exclusion policy; never collect input values, token storage, clipboard
contents or raw provider secrets. Record only safe readiness/error outcomes there.

Screenshots, traces, video, request bodies and downloads can contain secrets even when
JSON fields are redacted. Configure capture before those screens are visited. If
redaction would hide a required correctness observation, mark that requirement blocked;
do not label a masked image as full visual proof. Retain protected originals only when
explicitly permitted by the evidence policy, outside source control and public reports.

Use SHA-256 digests for file manifests and declared canonical encodings for structured
records. Redaction policy, scenario, driver, recorder, detector, rubric and approved
design-reference versions belong in metadata. Hash binding is not an independent
signature. Release authority must verify provenance through the existing trust model.

## Acceptance Examples

- A removed prompt followed by its reinsertion is preserved as two changes even if the
  last screenshot is correct. Detector findings link to the retained changes and frames.
- A blank screenshot or unknown image decoder state cannot become an empty successful
  output observation. The task's delivery contract remains unproven.
- A missing final chunk in the recorder stream makes the package incomplete; retrying
  the scenario creates a new attempt without overwriting the failed package.
- A normal slow response with intact capture does not become a capture failure merely
  because it is slow. Product latency and recorder completeness are separate judgments.
- Replay of a package must reconstruct node order, safe text and state at every saved
  checkpoint and produce the same deterministic findings without model/provider calls.