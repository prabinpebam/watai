// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import workflowJson from "../../documentation/implementation/2026-09-10-autonomous-delivery/contracts/workflow.json";
import {
  compileWorkflow,
  type ActorProof,
  type EventCommand,
  type GuardProof,
  type HarnessAuthorities,
  type WorkflowDefinition,
} from "./controller";
import { SqliteHarnessStore, SqliteStoreError } from "./sqliteStore";

const workflow = compileWorkflow(workflowJson as WorkflowDefinition);
const directories: string[] = [];
const now = Date.parse("2026-09-10T11:00:00.000Z");
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
  verifyPermit: () => false,
};

const actorProof = (eventId: string): ActorProof => ({
  role: "controller",
  identity: "trusted-controller",
  runId: "run-sqlite",
  eventId,
  fencingEpoch: 1,
  sourceSha: "source-sqlite",
  policySha256: "policy-sqlite",
  issuedAt: "2026-09-10T10:59:00.000Z",
  expiresAt: "2026-09-10T11:05:00.000Z",
  signature: "trusted:controller",
});

const guardProof = (guard: string, eventId: string): GuardProof => ({
  guard,
  runId: "run-sqlite",
  eventId,
  fencingEpoch: 1,
  sourceSha: "source-sqlite",
  policySha256: "policy-sqlite",
  evidenceSha256: `evidence:${guard}`,
  issuer: "trusted-evaluator",
  issuedAt: "2026-09-10T10:59:00.000Z",
  expiresAt: "2026-09-10T11:05:00.000Z",
  signature: `trusted:${guard}`,
});

const command = (eventId = "event-sqlite", expectedRevision = 0): EventCommand => ({
  envelope: {
    schemaVersion: "1.0",
    runId: "run-sqlite",
    eventId,
    expectedRevision,
    fencingEpoch: 1,
    sourceSha: "source-sqlite",
    policySha256: "policy-sqlite",
    eventType: "dispatch",
    payloadSha256: "payload-sqlite",
  },
  actor: "controller",
  actorProof: actorProof(eventId),
  guardEvidence: Object.fromEntries(
    ["valid-envelope", "current-lease", "current-source", "budget-reserved"]
      .map((guard) => [guard, guardProof(guard, eventId)]),
  ),
  effectDeadline: "2026-09-10T11:10:00.000Z",
});

async function databasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "watai-sqlite-"));
  directories.push(directory);
  return join(directory, "harness.sqlite");
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("SQLite harness store", () => {
  it("atomically persists candidate, receipt and outbox across restart", async () => {
    const path = await databasePath();
    const first = new SqliteHarnessStore(path);
    first.createCandidate(workflow, {
      runId: "run-sqlite",
      fencingEpoch: 1,
      sourceSha: "source-sqlite",
      policySha256: "policy-sqlite",
    });
    const result = first.apply(workflow, command(), authorities);
    expect(result.candidate).toMatchObject({ state: "PREFLIGHT", revision: 1 });
    expect(first.pendingEffects("run-sqlite")).toHaveLength(1);
    first.close();

    const restarted = new SqliteHarnessStore(path);
    expect(restarted.readCandidate("run-sqlite")).toMatchObject({ state: "PREFLIGHT", revision: 1 });
    expect(restarted.pendingEffects("run-sqlite")[0]).toMatchObject({ status: "pending" });
    restarted.close();
  });

  it("returns one receipt and outbox effect across two controller connections", async () => {
    const path = await databasePath();
    const first = new SqliteHarnessStore(path);
    const second = new SqliteHarnessStore(path);
    first.createCandidate(workflow, {
      runId: "run-sqlite",
      fencingEpoch: 1,
      sourceSha: "source-sqlite",
      policySha256: "policy-sqlite",
    });
    expect(first.apply(workflow, command(), authorities).kind).toBe("applied");
    expect(second.apply(workflow, command(), authorities).kind).toBe("replayed");
    expect(second.pendingEffects("run-sqlite")).toHaveLength(1);
    first.close();
    second.close();
  });

  it("fences an old lease owner after expiry and takeover", async () => {
    const path = await databasePath();
    const store = new SqliteHarnessStore(path);
    const first = store.acquireLease("controller", "owner-a", 1_000, 100);
    expect(() => store.acquireLease("controller", "owner-b", 1_050, 100))
      .toThrowError(SqliteStoreError);
    const second = store.acquireLease("controller", "owner-b", 1_101, 100);
    expect(second.fencingEpoch).toBe(first.fencingEpoch + 1);
    expect(() => store.heartbeatLease(
      "controller",
      "owner-a",
      first.fencingEpoch,
      first.revision,
      1_102,
      100,
    )).toThrowError(SqliteStoreError);
    store.close();
  });

  it("persists worst-case budget reservations and rejects restart resets", async () => {
    const path = await databasePath();
    const first = new SqliteHarnessStore(path);
    first.createBudget("run-sqlite", {
      usd: 0,
      inputTokens: 1_000,
      outputTokens: 100,
      requests: 2,
    });
    first.reserve("run-sqlite", 0, {
      reservationId: "reservation-sqlite",
      runId: "run-sqlite",
      effectId: "effect-sqlite",
      fencingEpoch: 1,
      worstCase: { usd: 0, inputTokens: 1_000, outputTokens: 100, requests: 2 },
      status: "reserved",
    });
    first.close();

    const restarted = new SqliteHarnessStore(path);
    expect(restarted.readBudget("run-sqlite")).toMatchObject({ revision: 1 });
    expect(() => restarted.createBudget("run-sqlite", {
      usd: 0,
      inputTokens: 10_000,
      outputTokens: 1_000,
      requests: 20,
    })).not.toThrow();
    expect(restarted.readBudget("run-sqlite").limits.requests).toBe(2);
    expect(() => restarted.reserve("run-sqlite", 1, {
      reservationId: "reservation-other",
      runId: "run-sqlite",
      effectId: "effect-other",
      fencingEpoch: 1,
      worstCase: { usd: 0, inputTokens: 1, outputTokens: 1, requests: 1 },
      status: "reserved",
    })).toThrow();
    restarted.close();
  });
});