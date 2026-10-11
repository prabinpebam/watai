const regions = [
  { id: 'conversation', selector: '.chat__column', level: 'context' },
  { id: 'message', selector: '[data-message-id]', level: 'detailed' },
  { id: 'composer', selector: '.composer', level: 'detailed' },
  { id: 'alerts', selector: '[role=alert], [role=dialog]', level: 'detailed' },
];

const contracts = {
  'CHAT-02': {
    variantId: 'CHAT-02.same-thread-follow-up-desktop',
    expectation: 'I can give the app a fact in this conversation, ask about it in my next message, and receive the correct answer without losing or reordering either turn.',
    prompts: ['For this conversation, the project code is MAPLE-27. Reply only ACK.', 'What is the project code I gave you? Reply only with the code.'],
    answers: ['ACK', 'MAPLE-27'],
    phases: [
      ['ready', 15000, 'Open a new empty test-owned conversation and verify the exact account and composer.', 'No existing messages; one visible usable composer; actual account receipt matches the test identity.'],
      ['seed', 35000, 'Fill the first fixed prompt and click Send once. Observe its real accepted IDs and terminal complete receipt.', 'The first prompt persists before its associated reply; terminal body is exactly ACK.'],
      ['follow-up', 35000, 'In the same thread, fill the second fixed prompt and click Send once after seed completion.', 'The request carries the same threadId and a new clientMessageId; both earlier messages remain in original order.'],
      ['complete', 5000, 'Inspect the second actual terminal reply, then observe 1500ms of reconciliation without another action.', 'The second reply is exactly MAPLE-27 and is associated with the second prompt; all four message identities stay present and ordered.'],
    ],
    knownChecks: [
      ['context-answer', 'Require two distinct submissions and accepted run/message pairs in one thread; compare actual terminal bodies exactly with ACK and MAPLE-27, not model plausibility or driver booleans.'],
      ['two-turn-order', 'At every same-document snapshot retain all previously visible message IDs and order each prompt before its accepted reply; preserve the first turn ahead of the second prompt.'],
      ['context-isolation', 'Reject changed threadId, duplicate client/run IDs, wrong prompt text or terminal answer. Missing immutable association is insufficient, not guessed.'],
    ],
  },
  'CHAT-03': {
    variantId: 'CHAT-03.streaming-anchor-desktop',
    expectation: 'I can watch a reply arrive progressively and scroll back to my prompt while generation continues, without text rollback, message reordering or the app pulling me away from my reading position.',
    prompts: ['Write the integers from 1 through 200, one integer per line, in order. No headings, Markdown or explanation.'],
    answers: [Array.from({ length: 200 }, (_, index) => String(index + 1)).join('\n')],
    phases: [
      ['ready', 15000, 'Open a new empty owned thread and verify account, composer and scroll container.', 'One empty conversation and accessible Send control; recorder active before input.'],
      ['submit', 15000, 'Fill the fixed number-list prompt and click Send once.', 'One accepted run and immutable prompt/reply association; prompt present before first reply.'],
      ['stream', 30000, 'Observe at least three distinct increasing nonempty reply bodies while the real run remains running.', 'Each later body has the earlier body as its exact prefix; a final-only answer does not cover this phase.'],
      ['read-history', 25000, 'After overflow is observed, hover the actual .chat__scroll and wheel upward by its observed scrollTop until the prompt is visible; record its viewport offset and perform no more scrolling.', 'At least two subsequent streaming updates occur while the user-pinned prompt offset remains within2 CSS pixels and its identity remains visible.'],
      ['complete', 5000, 'Wait for the same run to become complete, inspect the full actual body and retain 1500ms of reconciliation.', 'Exactly integers1..200 on separate lines, no format wrappers, no text rollback or anchor jump.'],
    ],
    knownChecks: [
      ['incremental-delivery', 'Require at least three distinct nonempty prefix-growing body observations during running status; repeated identical snapshots do not count.'],
      ['reading-anchor', 'After the real wheel action and pinned-anchor receipt, require at least two additional distinct stream bodies with the same visible prompt anchor; absolute offset change <=2 CSS pixels. Missing overflow or updates is insufficient.'],
      ['complete-sequence', 'After the matching complete receipt, split actual body on CRLF/LF, trim only outer whitespace, and require exactly200 lines whose values equal1..200.'],
    ],
  },
  'CHAT-04': {
    variantId: 'CHAT-04.stop-then-next-prompt-desktop',
    expectation: 'I can stop a reply that is still being generated and ask a new question. The stopped reply stays stopped, its history is preserved, and delayed work never changes the new answer.',
    prompts: ['Write the integers from 1 through 2000, one integer per line, in order. No headings, Markdown or explanation.', 'Calculate 17 + 29. Reply with only the decimal integer, without formatting or explanation.'],
    answers: [null, '46'],
    phases: [
      ['ready', 15000, 'Open a new empty owned thread; verify account, provider ceiling and composer.', 'Only test-owned state, no existing history; observer and request guards active.'],
      ['submit', 15000, 'Send the first fixed long-list prompt exactly once.', 'One admitted run with prompt/reply IDs and a visible Stop generating button.'],
      ['stream', 20000, 'Require two distinct nonempty body updates and running status; then click Stop generating exactly once.', 'The stop click occurs while running, not after completion; record the actual DELETE request target and response.'],
      ['cancel', 15000, 'Observe cancel_requested and then canceled for the same run; do not treat request acknowledgement as terminal.', 'A canceled receipt and matching UI occur; retain the stopped body/identity as the comparison baseline. If complete wins the race, the required mid-stream-stop branch is insufficient, not passed.'],
      ['next-prompt', 20000, 'Only after canceled, send the second fixed arithmetic prompt once in the same thread.', 'Distinct next run/prompt/reply identities; the previous canceled response remains unchanged through every next-turn state.'],
      ['complete', 5000, 'Inspect the second terminal complete reply and observe1500ms of reconciliation.', 'The new reply is exactly46; no canceled text grows or replaces the new answer; all message order is preserved.'],
    ],
    knownChecks: [
      ['real-cancellation', 'Require a real Stop action linked to the running accepted run and a canceled receipt; cancel_requested alone, completed-before-stop or absent DELETE evidence is insufficient.'],
      ['no-late-write', 'Freeze the actual old reply body at canceled and compare its body/identity in every subsequent same-document snapshot, including next-run streaming and terminal handoff; any change is failure.'],
      ['next-run-owned-answer', 'Require second submission after canceled, same thread but distinct client/run/assistant IDs; compare final new answer exactly46 and retain every prompt before its own response.'],
    ],
  },
};

export function pilotChatPlans(baseFlow) {
  return Object.entries(contracts).map(([id, contract]) => {
    const flow = { ...structuredClone(baseFlow), id, version: 1, driver: 'PILOT_DRIVER_LOCAL_CALIBRATED',
      phases: contract.phases.map(([phase]) => phase), requiredPhases: contract.phases.map(([phase]) => phase),
      requiredOutcomes: contract.knownChecks.map(([check]) => check), prompts: [...contract.prompts], answers: [...contract.answers],
      prompt: contract.prompts[0], expectedAnswer: contract.answers.at(-1), maxRunSubmissions: contract.prompts.length,
      regions: structuredClone(regions), claims: contract.knownChecks.map(([check]) => check) };
    const steps = contract.phases.map(([phase, deadlineMs, action, expected], index) => ({
      id: `${id}.${phase}`, phase, deadlineMs, maxVisits: 1,
      action: index === 0 ? `In the verified existing Edge page, navigate through about:blank to https://prabinpebam.github.io/watai/#/new within this phase deadline. ${action}` : action, expected,
      trigger: index === 0 ? 'Before navigation or any input; all preflight prerequisites must already pass.' : `After ${contract.phases[index - 1][0]} has its actual required evidence; no skipped or invented transition.`,
      failureModes: ['Wrong identity, content or chronological order is a product failure.', 'Absent required branch, receipt, paint or temporal evidence is insufficient.', 'No retry, forced action or altered expectation within the attempt.'],
      next: [contract.phases[index + 1] ? `${id}.${contract.phases[index + 1][0]}` : 'end', 'stop'],
      capture: {
        start: `Before ${phase} action and throughout every driver wait, including unexpected states.`,
        end: 'Only after its observed outcome or explicit stop; drain pending observations before transition.',
        channels: ['ordered mutation and rAF timeline', 'safe real request and run-state receipts', 'actual content and formatting', 'focus/scroll/hit and linked screenshots'],
        fields: ['document/receiver sequence and monotonic time', 'DOM lifetime and immutable message/run/thread IDs', 'actual body text and structure', 'region coverage, visibility, bounds, clip/hit', 'run status and original request phase', 'scroll anchor identity and viewport offset'],
        maxBytes: flow.maxEvidenceBytes,
        overflow: 'Stop insufficient on any missing interval, 250ms visible-frame gap, 400-node/4096-character field or flow byte/event limit; never reduce detail dynamically.',
        unexpectedSurface: 'Fixed sentinel retains unexpected overlays, errors and unrelated message changes; unsupported identity or geometry stops clean interpretation. No runtime resolution changes.',
        regions: regions.map(region => ({ ...region,
          fields: region.id === 'message' ? ['all prompt/reply IDs and their unchanged order', 'safe .bubble-user/.md content and structure', 'visibility, bounds and mutation history']
            : region.id === 'conversation' ? ['scroll container and pinned prompt offset', 'ancestor visibility/clipping', 'boundary identity and activity']
              : region.id === 'composer' ? ['actual draft and control names', 'Send/Stop enabled state and hit geometry', 'focus'] : ['safe text and roles', 'visibility and occlusion', 'focus and lifetime'],
          reason: region.id === 'message' ? 'Each existing and new turn must remain attributable through every intermediate state.'
            : region.id === 'conversation' ? 'Preserve context and user-pinned reading position.' : region.id === 'composer' ? 'Submission and cancellation controls must reflect actual execution.' : 'Unexpected failures must remain available to open-ended semantic review.' })),
      },
    }));
    return { flow, pack: {
      schemaVersion: 1, flowId: id, flowVersion: 1, flowDigest: null, variantId: contract.variantId, designVersion: 2,
      scope: 'One fixed desktop pilot child; unrelated families and other variants are deferred.', expectation: contract.expectation,
      userGoals: [contract.expectation],
      preconditions: ['Genuine invited non-admin test session, verified owner/consent and approved provider budget.', 'Exact deployed app in the verified existing Edge page; fresh empty test-owned thread; preserve and record actual viewport, scale and locale without emulation or focus.', 'Complete task/capture/heuristic and calibrated skill-bound semantic preparation must pass before any evaluated action.'],
      cleanup: ['Drain capture, remove only runner-owned page bindings/scripts/routes/listeners and detach its CDP session; leave browser/context/page open. Driver exit disconnects transport. Retain attempts and conversation identities; no deletion or replay.'],
      safety: [`At most${flow.maxRunSubmissions} submitted runs, exactly the fixed prompts, no automatic retries.`, 'Keep90second overall and authored step deadlines;120request/20MiB network and24,000event/16MiB evidence ceilings; no implicit model-review spend.', 'Only whitelisted real app/API fields; never capture credentials, storage, headers or arbitrary run secrets.'],
      entryStep: steps[0].id, steps,
      heuristics: contract.knownChecks.map(([check, algorithm]) => ({ id: `${id}.${check}`, outcome: check, steps: steps.map(step => step.id), algorithm,
        inputs: ['original phase/action/mutation/frame observations', 'whitelisted submitted and accepted IDs', 'real run status and message bodies', 'scroll-anchor observation where applicable'],
        pass: 'All required branch observations satisfy the exact algorithm in every retained state.',
        fail: 'A supported mismatch, transient disappearance, chronology inversion, stale write or incorrect answer remains failure even after correction.',
        insufficient: 'Missing required intermediate updates, association, cancellation, scroll/paint or calibrated capture is not a pass.',
        negativeCases: ['Correct final state after an intermediate failure', 'Wrong answer with driver success booleans', 'Required asynchronous branch never observed'],
        implementation: 'tests/e2e/deployed/pilot-chat-heuristics.mjs#evaluatePilotChat' })),
      semantic: { required: true, openEnded: true, expectation: contract.expectation,
        skillPath: '.github/skills/edd-semantic-review/SKILL.md', skillSha256: null,
        agentPath: 'tests/e2e/deployed/semantic-agent.json', agentSha256: null,
        reviewProtocol: 'complete-timeline-then-cross-phase-synthesis-v1', evidenceLayers: ['timeline', 'visual', 'run identity/status', 'interaction and artifacts'],
        contextExhaustion: 'Deny admission if the complete planned capture cannot fit the calibrated review protocol; no on-the-fly summaries or omitted windows.',
        findingContract: 'Review every original window and required image with the preloaded skill, then synthesize cross-phase experience. Novel anomaly categories need no known detector ID; preserve uncertainty and cite original evidence. Heuristic success never skips review.' },
      artifacts: [], attestations: [],
      unresolved: ['Existing Edge login is verified; borrowed-page lifecycle still requires calibration. Actual model/reservation billing authority and independent calibration approval remain unavailable.',
        'The exact drivers passed source-bound local Chromium interaction and screenshot calibration; actual serving-contract and authenticated product qualification remain required.',
        'Full intermediate render/paint, identity handoff, scrollbar/anchor and DS evidence are not qualified.',
        'The current capture envelope exceeds the semantic profile capacity; actual LLM effectiveness and private evidence publication are unvalidated.'],
    } };
  });
}