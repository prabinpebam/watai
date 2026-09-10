// @vitest-environment node
import { describe, expect, it } from "vitest";

import examplesJson from "../../documentation/implementation/2026-09-10-autonomous-delivery/contracts/examples.json";
import workflowJson from "../../documentation/implementation/2026-09-10-autonomous-delivery/contracts/workflow.json";
import {
  applyEvent,
  compileWorkflow,
  createCandidate,
  type ActorProof,
  type EventCommand,
  type EventEnvelope,
  type GuardProof,
  type HarnessAuthorities,
  type ReleasePermit,
  type WorkflowDefinition,
  type WorkflowTransition,
} from "./controller";

interface Trace {
  id: string;
  start: string;
  events: string[];
  end: string;
}

const workflowDefinition = workflowJson as WorkflowDefinition;
const workflow = compileWorkflow(workflowDefinition);
const now = Date.parse("2026-09-10T11:00:00.000Z");
const sourceSha = "trace-source";
const policySha256 = "trace-policy";

const authorities: HarnessAuthorities = {
  now: () => now,
  limits: {
    maxClockSkewMs: 5_000,
    maxGuardProofLifetimeMs: 15 * 60_000,
    maxPermitLifetimeMs: 15 * 60_000,
    maxEffectLifetimeMs: 20 * 60_000,
  },
  verifyActor: (proof) => proof.signature === `trusted:${proof.role}`,
  verifyGuard: (proof) => proof.signature === `trusted:${proof.guard}`,
  verifyPermit: (permit) => permit.signature === `trusted:${permit.permitId}`,
};

const actorProof = (role: string, runId: string, eventId: string): ActorProof => ({
  role,
  identity: `trusted-${role}`,
  runId,
  eventId,
  fencingEpoch: 1,
  sourceSha,
  policySha256,
  issuedAt: "2026-09-10T10:59:00.000Z",
  expiresAt: "2026-09-10T11:05:00.000Z",
  signature: `trusted:${role}`,
});

const guardProof = (guard: string, runId: string, eventId: string): GuardProof => ({
  guard,
  runId,
  eventId,
  fencingEpoch: 1,
  sourceSha,
  policySha256,
  evidenceSha256: `evidence:${runId}:${eventId}:${guard}`,
  issuer: "trusted-trace-evaluator",
  issuedAt: "2026-09-10T10:59:00.000Z",
  expiresAt: "2026-09-10T11:05:00.000Z",
  signature: `trusted:${guard}`,
});

function findTransition(state: string, event: string): WorkflowTransition {
  const transition = workflowDefinition.transitions.find(
    (candidate) => candidate.event === event && candidate.from.includes(state),
  );
  if (!transition) throw new Error(`Trace has no ${event} transition from ${state}`);
  return transition;
}

function commandFor(
  runId: string,
  revision: number,
  state: string,
  eventType: string,
): EventCommand {
  const transition = findTransition(state, eventType);
  const eventId = `${runId}:${revision}:${eventType}`;
  const envelope: EventEnvelope = {
    schemaVersion: "1.0",
    runId,
    eventId,
    expectedRevision: revision,
    fencingEpoch: 1,
    sourceSha,
    policySha256,
    eventType,
    payloadSha256: `payload:${runId}:${revision}`,
  };
  const guards = [...new Set([
    ...workflowDefinition.transitionDefaults.requiredGuards,
    ...transition.guards,
  ])];
  const permitPhase = transition.effect === "promote"
    ? "cohort"
    : transition.effect === "expand"
      ? "full"
      : undefined;
  const permitId = `permit:${runId}:${revision}`;
  const permit: ReleasePermit | undefined = permitPhase
    ? {
        permitId,
        nonce: `nonce:${runId}:${revision}`,
        phase: permitPhase,
        runId,
        fencingEpoch: 1,
        sourceSha,
        policySha256,
        manifestSha256: `manifest:${runId}`,
        issuer: "trusted-release-verifier",
        issuedAt: "2026-09-10T10:59:00.000Z",
        expiresAt: "2026-09-10T11:05:00.000Z",
        signature: `trusted:${permitId}`,
      }
    : undefined;

  return {
    envelope,
    actor: transition.actor,
    actorProof: actorProof(transition.actor, runId, eventId),
    guardEvidence: Object.fromEntries(
      guards.map((guard) => [guard, guardProof(guard, runId, eventId)]),
    ),
    effectDeadline: transition.effect === "none"
      ? undefined
      : "2026-09-10T11:10:00.000Z",
    effectProvider: transition.effect === "worker"
      ? { providerId: "github-copilot", model: "gpt-5.4" }
      : undefined,
    permit,
  };
}

describe("declared workflow traces", () => {
  it.each(examplesJson.traces as Trace[])("executes $id to $end", (trace) => {
    let candidate = createCandidate(workflow, {
      runId: trace.id,
      fencingEpoch: 1,
      sourceSha,
      policySha256,
    });
    expect(candidate.state).toBe(trace.start);

    for (const event of trace.events) {
      candidate = applyEvent(
        workflow,
        candidate,
        commandFor(trace.id, candidate.revision, candidate.state, event),
        authorities,
      ).candidate;
    }

    expect(candidate.state).toBe(trace.end);
  });
});