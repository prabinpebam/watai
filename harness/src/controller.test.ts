// @vitest-environment node
import { describe, expect, it } from "vitest";

import workflowJson from "../../documentation/implementation/2026-09-10-autonomous-delivery/contracts/workflow.json";
import {
  applyEvent,
  compileWorkflow,
  createCandidate,
  HarnessRejection,
  InMemoryCandidateLedger,
  type CandidateSnapshot,
  type ActorProof,
  type EventCommand,
  type GuardProof,
  type HarnessAuthorities,
  type ReleasePermit,
  type WorkflowDefinition,
} from "./controller";

const workflow = compileWorkflow(workflowJson as WorkflowDefinition);

const candidate = () =>
  createCandidate(workflow, {
    runId: "run-001",
    fencingEpoch: 7,
    sourceSha: "source-abc",
    policySha256: "policy-def",
  });

const now = Date.parse("2026-09-10T11:00:00.000Z");

const actorProof = (role: string, eventId = "event-001"): ActorProof => ({
  role,
  identity: `trusted-${role}`,
  runId: "run-001",
  eventId,
  fencingEpoch: 7,
  sourceSha: "source-abc",
  policySha256: "policy-def",
  issuedAt: "2026-09-10T10:59:00.000Z",
  expiresAt: "2026-09-10T11:05:00.000Z",
  signature: `trusted:${role}`,
});

const proof = (guard: string, eventId = "event-001"): GuardProof => ({
  guard,
  runId: "run-001",
  eventId,
  fencingEpoch: 7,
  sourceSha: "source-abc",
  policySha256: "policy-def",
  evidenceSha256: `evidence:${guard}`,
  issuer: "trusted-test-evaluator",
  issuedAt: "2026-09-10T10:59:00.000Z",
  expiresAt: "2026-09-10T11:05:00.000Z",
  signature: `trusted:${guard}`,
});

const authorities: HarnessAuthorities = {
  now: () => now,
  limits: {
    maxClockSkewMs: 5_000,
    maxGuardProofLifetimeMs: 15 * 60_000,
    maxPermitLifetimeMs: 15 * 60_000,
    maxEffectLifetimeMs: 20 * 60_000,
  },
  verifyActor: (value) => value.signature === `trusted:${value.role}`,
  verifyGuard: (value) => value.signature === `trusted:${value.guard}`,
  verifyPermit: (value) => value.signature === `trusted:${value.permitId}`,
};

const dispatchCommand = (overrides: Partial<EventCommand> = {}): EventCommand => ({
  envelope: {
    schemaVersion: "1.0",
    runId: "run-001",
    eventId: "event-001",
    expectedRevision: 0,
    fencingEpoch: 7,
    sourceSha: "source-abc",
    policySha256: "policy-def",
    eventType: "dispatch",
    payloadSha256: "payload-123",
  },
  actor: "controller",
  actorProof: actorProof("controller"),
  guardEvidence: {
    "valid-envelope": proof("valid-envelope"),
    "current-lease": proof("current-lease"),
    "current-source": proof("current-source"),
    "budget-reserved": proof("budget-reserved"),
  },
  effectDeadline: "2026-09-10T11:10:00.000Z",
  ...overrides,
});

const expectRejection = (action: () => unknown, code: string) => {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(HarnessRejection);
    expect((error as HarnessRejection).code).toBe(code);
  }
};

describe("deterministic harness controller", () => {
  it("commits state, receipt, and effect intent together", () => {
    const result = applyEvent(workflow, candidate(), dispatchCommand(), authorities);

    expect(result.kind).toBe("applied");
    expect(result.candidate.state).toBe("PREFLIGHT");
    expect(result.candidate.revision).toBe(1);
    expect(result.candidate.events).toEqual([result.receipt]);
    expect(result.candidate.outbox).toEqual([
      expect.objectContaining({
        effectId: "run-001:event-001:7:preflight",
        kind: "preflight",
        status: "pending",
      }),
    ]);
  });

  it("returns the original receipt for an exact replay", () => {
    const first = applyEvent(workflow, candidate(), dispatchCommand(), authorities);
    const replay = applyEvent(workflow, first.candidate, dispatchCommand(), authorities);

    expect(replay.kind).toBe("replayed");
    expect(replay.candidate).toBe(first.candidate);
    expect(replay.receipt).toEqual(first.receipt);
    expect(replay.candidate.outbox).toHaveLength(1);
  });

  it("replays a logical event when renewable proofs and deadline change", () => {
    const firstCommand = dispatchCommand();
    const first = applyEvent(workflow, candidate(), firstCommand, authorities);
    const refreshed = dispatchCommand({
      actorProof: {
        ...firstCommand.actorProof,
        issuedAt: "2026-09-10T10:59:30.000Z",
        expiresAt: "2026-09-10T11:06:00.000Z",
      },
      guardEvidence: Object.fromEntries(
        Object.entries(firstCommand.guardEvidence).map(([guard, value]) => [guard, {
          ...value,
          issuedAt: "2026-09-10T10:59:30.000Z",
          expiresAt: "2026-09-10T11:06:00.000Z",
        }]),
      ),
      effectDeadline: "2026-09-10T11:15:00.000Z",
    });

    const replay = applyEvent(workflow, first.candidate, refreshed, authorities);
    expect(replay.kind).toBe("replayed");
    expect(replay.candidate.outbox).toHaveLength(1);
  });

  it("authenticates the caller before returning a replay receipt", () => {
    const first = applyEvent(workflow, candidate(), dispatchCommand(), authorities);
    const untrustedReplay = dispatchCommand({
      actorProof: { ...actorProof("controller"), signature: "self-asserted" },
    });

    expectRejection(
      () => applyEvent(workflow, first.candidate, untrustedReplay, authorities),
      "ACTOR_PROOF_INVALID",
    );
  });

  it("quarantines an event ID reused with different content", () => {
    const first = applyEvent(workflow, candidate(), dispatchCommand(), authorities);
    const conflict = dispatchCommand({
      envelope: {
        ...dispatchCommand().envelope,
        payloadSha256: "different-payload",
      },
      effectDeadline: undefined,
    });
    const result = applyEvent(workflow, first.candidate, conflict, authorities);

    expect(result.kind).toBe("quarantined");
    expect(result.candidate.state).toBe("QUARANTINED");
    expect(result.candidate.revision).toBe(2);
    expect(result.candidate.outbox[result.candidate.outbox.length - 1]).toEqual(
      expect.objectContaining({
        kind: "freeze",
        deadline: "2026-09-10T11:00:30.000Z",
      }),
    );
  });

  it.each([
    [
      "wrong actor",
      dispatchCommand({ actor: "builder", actorProof: actorProof("builder") }),
      "ACTOR_MISMATCH",
    ],
    [
      "stale revision",
      dispatchCommand({
        envelope: { ...dispatchCommand().envelope, expectedRevision: 3 },
      }),
      "REVISION_MISMATCH",
    ],
    [
      "stale fencing epoch",
      dispatchCommand({
        envelope: { ...dispatchCommand().envelope, fencingEpoch: 6 },
      }),
      "FENCING_EPOCH_MISMATCH",
    ],
    [
      "changed source",
      dispatchCommand({
        envelope: { ...dispatchCommand().envelope, sourceSha: "source-other" },
      }),
      "SOURCE_MISMATCH",
    ],
    [
      "changed policy",
      dispatchCommand({
        envelope: { ...dispatchCommand().envelope, policySha256: "policy-other" },
      }),
      "POLICY_MISMATCH",
    ],
    [
      "missing guard evidence",
      dispatchCommand({
        guardEvidence: {
          "valid-envelope": proof("valid-envelope"),
          "current-lease": proof("current-lease"),
          "current-source": proof("current-source"),
        },
      }),
      "GUARD_EVIDENCE_MISSING",
    ],
    [
      "missing effect deadline",
      dispatchCommand({ effectDeadline: undefined }),
      "EFFECT_DEADLINE_REQUIRED",
    ],
  ])("rejects %s", (_label, command, code) => {
    expectRejection(() => applyEvent(workflow, candidate(), command, authorities), code);
  });

  it("rejects a self-asserted guard proof", () => {
    const command = dispatchCommand();
    command.guardEvidence["budget-reserved"] = {
      ...proof("budget-reserved"),
      signature: "self-asserted",
    };

    expectRejection(
      () => applyEvent(workflow, candidate(), command, authorities),
      "GUARD_EVIDENCE_INVALID",
    );
  });

  it("rejects a self-asserted actor proof", () => {
    const command = dispatchCommand({
      actorProof: { ...actorProof("controller"), signature: "self-asserted" },
    });

    expectRejection(
      () => applyEvent(workflow, candidate(), command, authorities),
      "ACTOR_PROOF_INVALID",
    );
  });

  it("rejects unsupported event and workflow schema versions", () => {
    const command = dispatchCommand({
      envelope: { ...dispatchCommand().envelope, schemaVersion: "2.0" },
    });
    expectRejection(
      () => applyEvent(workflow, candidate(), command, authorities),
      "SCHEMA_VERSION_UNSUPPORTED",
    );
    expectRejection(
      () => compileWorkflow({ ...workflowJson, schemaVersion: "2.0" }),
      "SCHEMA_VERSION_UNSUPPORTED",
    );
  });

  it("requires and consumes a verified cohort permit before promotion", () => {
    const releaseCandidate: CandidateSnapshot = {
      ...candidate(),
      state: "RELEASE_READY",
    };
    const eventId = "event-promote";
    const required = [
      "valid-envelope",
      "current-lease",
      "current-source",
      "permit-current",
      "gates-passed",
      "lkg-admissible",
      "budget-reserved",
      "cohort-scope",
      "new-single-use-permit",
    ];
    const permit: ReleasePermit = {
      permitId: "permit-cohort-1",
      nonce: "nonce-cohort-1",
      phase: "cohort",
      runId: "run-001",
      fencingEpoch: 7,
      sourceSha: "source-abc",
      policySha256: "policy-def",
      manifestSha256: "manifest-123",
      issuer: "trusted-release-verifier",
      issuedAt: "2026-09-10T10:59:00.000Z",
      expiresAt: "2026-09-10T11:05:00.000Z",
      signature: "trusted:permit-cohort-1",
    };
    const command: EventCommand = {
      envelope: {
        ...dispatchCommand().envelope,
        eventId,
        eventType: "permit_issued",
      },
      actor: "release-verifier",
      actorProof: actorProof("release-verifier", eventId),
      guardEvidence: Object.fromEntries(required.map((guard) => [guard, proof(guard, eventId)])),
      effectDeadline: "2026-09-10T11:10:00.000Z",
      permit,
    };

    expectRejection(
      () => applyEvent(workflow, releaseCandidate, { ...command, permit: undefined }, authorities),
      "PERMIT_REQUIRED",
    );

    const result = applyEvent(workflow, releaseCandidate, command, authorities);
    expect(result.candidate.state).toBe("PROMOTING");
    expect(result.candidate.consumedPermitNonces).toEqual(["nonce-cohort-1"]);
    expect(result.receipt.permitId).toBe("permit-cohort-1");

    expectRejection(
      () =>
        applyEvent(
          workflow,
          {
            ...releaseCandidate,
            consumedPermitNonces: ["nonce-cohort-1"],
          },
          command,
          authorities,
        ),
      "PERMIT_REUSED",
    );
  });

  it("rejects ambiguous state and event handlers at compile time", () => {
    const invalid: WorkflowDefinition = {
      ...workflowJson,
      transitions: [
        ...workflowJson.transitions,
        {
          from: ["QUEUED"],
          event: "dispatch",
          to: "FAILED",
          actor: "watchdog",
          guards: [],
          effect: "none",
        },
      ],
    };

    expectRejection(() => compileWorkflow(invalid), "AMBIGUOUS_TRANSITION");
  });

  it("freezes the compiled workflow against runtime mutation", () => {
    expect(Object.isFrozen(workflow.definition)).toBe(true);
    expect(Object.isFrozen(workflow.definition.transitions)).toBe(true);
    expect(() => workflow.definition.transitions.push(workflow.definition.transitions[0])).toThrow();
  });

  it("allows ledger writes only through validated transitions", () => {
    const ledger = new InMemoryCandidateLedger(candidate());
    const first = ledger.dispatch(workflow, dispatchCommand(), authorities);
    const eventId = "event-002";
    const staleCommand = dispatchCommand({
      envelope: {
        ...dispatchCommand().envelope,
        eventId,
        expectedRevision: 0,
      },
      actorProof: actorProof("controller", eventId),
      guardEvidence: Object.fromEntries(
        ["valid-envelope", "current-lease", "current-source", "budget-reserved"].map(
          (guard) => [guard, proof(guard, eventId)],
        ),
      ),
    });

    expect(first.candidate.state).toBe("PREFLIGHT");
    expectRejection(
      () => ledger.dispatch(workflow, staleCommand, authorities),
      "REVISION_MISMATCH",
    );
    expect(ledger.read().state).toBe("PREFLIGHT");
  });
});