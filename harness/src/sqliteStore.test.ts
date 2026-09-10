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
import type { GatewayResponse } from "./worker";

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

const providerReceipt = (receiptId: string) => ({
  receiptId,
  runId: "run-sqlite",
  effectId: "run-sqlite:event-sqlite:1:preflight",
  reservationId: "reservation-complete",
  providerId: "github-copilot",
  model: "gpt-5.4",
  resolvedModelVersion: "gpt-5.4-test",
  premiumRequestCost: 1,
  aiCredits: 1,
  usage: { usd: 0.5, inputTokens: 700, outputTokens: 80, requests: 1 },
  outputSha256: "d".repeat(64),
  completedAt: "2026-09-10T11:01:00.000Z",
  issuer: "usage-verifier",
  issuedAt: "2026-09-10T11:01:00.000Z",
  expiresAt: "2026-09-10T11:05:00.000Z",
  signature: `trusted:${receiptId}`,
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

  it("atomically reserves and claims an effect before dispatch across restart", async () => {
    const path = await databasePath();
    const first = new SqliteHarnessStore(path);
    first.createCandidate(workflow, {
      runId: "run-sqlite",
      fencingEpoch: 1,
      sourceSha: "source-sqlite",
      policySha256: "policy-sqlite",
    });
    first.apply(workflow, command(), authorities);
    first.createBudget("run-sqlite", { usd: 0, inputTokens: 1_000, outputTokens: 100, requests: 2 });
    const effectId = first.pendingEffects("run-sqlite")[0].effectId;
    const started = first.beginEffectDispatch(
      "run-sqlite",
      effectId,
      "queryable",
      {
        reservationId: "reservation-dispatch",
        runId: "run-sqlite",
        effectId,
        fencingEpoch: 1,
        worstCase: { usd: 0, inputTokens: 1_000, outputTokens: 100, requests: 2 },
        status: "reserved",
      },
      {
        workerId: "worker-1",
        fencingEpoch: 1,
        now: "2026-09-10T11:00:00.000Z",
        leaseUntil: "2026-09-10T11:02:00.000Z",
        minimumLeaseMs: 30_000,
        maxAttempts: 3,
      },
    );
    first.bindEffectSession(effectId, started.effect.revision, "session-1", "2026-09-10T11:00:01.000Z");
    first.close();

    const restarted = new SqliteHarnessStore(path);
    expect(restarted.readEffect(effectId)).toMatchObject({ status: "claimed", revision: 1 });
    expect(restarted.listEffects("run-sqlite", ["claimed"])).toHaveLength(1);
    expect(restarted.readEffectSessionId(effectId)).toBe("session-1");
    expect(restarted.readBudget("run-sqlite").reservations[0].status).toBe("dispatched");
    expect(restarted.pendingEffects("run-sqlite")).toEqual([]);
    restarted.close();
  });

  it("settles effect and usage atomically and rolls both back on stale budget CAS", async () => {
    const path = await databasePath();
    const store = new SqliteHarnessStore(path);
    store.createCandidate(workflow, {
      runId: "run-sqlite",
      fencingEpoch: 1,
      sourceSha: "source-sqlite",
      policySha256: "policy-sqlite",
    });
    store.apply(workflow, command(), authorities);
    store.createBudget("run-sqlite", { usd: 1, inputTokens: 1_000, outputTokens: 100, requests: 2 });
    const effectId = store.pendingEffects("run-sqlite")[0].effectId;
    const started = store.beginEffectDispatch(
      "run-sqlite",
      effectId,
      "queryable",
      {
        reservationId: "reservation-complete",
        runId: "run-sqlite",
        effectId,
        fencingEpoch: 1,
        worstCase: { usd: 1, inputTokens: 1_000, outputTokens: 100, requests: 2 },
        status: "reserved",
      },
      {
        workerId: "worker-1",
        fencingEpoch: 1,
        now: "2026-09-10T11:00:00.000Z",
        leaseUntil: "2026-09-10T11:02:00.000Z",
        minimumLeaseMs: 30_000,
        maxAttempts: 3,
      },
    );
    expect(() => store.completeEffect(
      "run-sqlite",
      effectId,
      started.effect.revision,
      1,
      started.budget.revision - 1,
      "reservation-complete",
      providerReceipt("receipt-1"),
    )).toThrow();
    expect(store.readEffect(effectId).status).toBe("claimed");
    expect(store.readBudget("run-sqlite").reservations[0].status).toBe("dispatched");

    expect(() => store.completeEffect(
      "run-sqlite",
      effectId,
      started.effect.revision,
      1,
      started.budget.revision,
      "reservation-complete",
      { ...providerReceipt("receipt-wrong-effect"), effectId: "another-effect" },
    )).toThrowError(expect.objectContaining({ code: "PROVIDER_RECEIPT_BINDING_MISMATCH" }));
    expect(store.readEffect(effectId).status).toBe("claimed");
    expect(store.readBudget("run-sqlite").reservations[0].status).toBe("dispatched");
    expect(() => store.readProviderUsageReceipt(effectId)).toThrowError(SqliteStoreError);

    const completed = store.completeEffect(
      "run-sqlite",
      effectId,
      started.effect.revision,
      1,
      started.budget.revision,
      "reservation-complete",
      providerReceipt("receipt-1"),
    );
    expect(completed.effect.status).toBe("completed");
    expect(completed.budget.reservations[0]).toMatchObject({ status: "settled", actual: { inputTokens: 700 } });
    expect(store.readProviderUsageReceipt(effectId)).toMatchObject({
      receiptId: "receipt-1",
      providerId: "github-copilot",
      model: "gpt-5.4",
      resolvedModelVersion: "gpt-5.4-test",
      aiCredits: 1,
      usage: { usd: 0.5, inputTokens: 700, outputTokens: 80, requests: 1 },
      signature: "trusted:receipt-1",
    });
    store.close();
  });

  it("persists completed and uncertain gateway requests across restart", async () => {
    const path = await databasePath();
    const first = new SqliteHarnessStore(path);
    first.createCandidate(workflow, {
      runId: "run-sqlite", fencingEpoch: 1, sourceSha: "source-sqlite", policySha256: "policy-sqlite",
    });
    const receipts = first.gatewayReceiptStore();
    expect(await receipts.begin({
      requestId: "request-complete", runId: "run-sqlite", fingerprint: "a".repeat(64),
      tool: "watai_read_file",
      createdAt: "2026-09-10T11:00:00.000Z",
    })).toBeUndefined();
    const response: GatewayResponse = {
      schemaVersion: "1.0", requestId: "request-complete", runId: "run-sqlite",
      manifestSha256: "b".repeat(64), status: "success", result: { accepted: true }, resultSha256: "c".repeat(64),
    };
    await receipts.complete(
      "run-sqlite", "request-complete", "a".repeat(64), response, "2026-09-10T11:00:01.000Z",
    );
    expect(await receipts.begin({
      requestId: "request-pending", runId: "run-sqlite", fingerprint: "d".repeat(64),
      tool: "watai_git_diff",
      createdAt: "2026-09-10T11:00:02.000Z",
    })).toBeUndefined();
    first.close();

    const restarted = new SqliteHarnessStore(path);
    const persisted = await restarted.gatewayReceiptStore().list("run-sqlite");
    restarted.close();
    expect(persisted[0]).toEqual(expect.objectContaining({ requestId: "request-complete", status: "completed", response }));
    expect(persisted[1]).toEqual(expect.objectContaining({ requestId: "request-pending", status: "pending" }));
    expect(persisted[1]).not.toHaveProperty("response");
  });

  it.each(["dispatch-after-budget", "dispatch-after-effect", "dispatch-after-outbox"])(
    "rolls back atomic dispatch at %s",
    async (faultPoint) => {
      const path = await databasePath();
      const store = new SqliteHarnessStore(path, {
        injectFault: (point) => { if (point === faultPoint) throw new Error(faultPoint); },
      });
      store.createCandidate(workflow, {
        runId: "run-sqlite", fencingEpoch: 1, sourceSha: "source-sqlite", policySha256: "policy-sqlite",
      });
      store.apply(workflow, command(), authorities);
      store.createBudget("run-sqlite", { usd: 0, inputTokens: 1_000, outputTokens: 100, requests: 2 });
      const effectId = store.pendingEffects("run-sqlite")[0].effectId;
      expect(() => store.beginEffectDispatch(
        "run-sqlite", effectId, "queryable",
        {
          reservationId: "reservation-fault", runId: "run-sqlite", effectId, fencingEpoch: 1,
          worstCase: { usd: 0, inputTokens: 1_000, outputTokens: 100, requests: 2 }, status: "reserved",
        },
        {
          workerId: "worker-1", fencingEpoch: 1, now: "2026-09-10T11:00:00.000Z",
          leaseUntil: "2026-09-10T11:02:00.000Z", minimumLeaseMs: 30_000, maxAttempts: 3,
        },
      )).toThrow(faultPoint);
      expect(store.readBudget("run-sqlite").reservations).toEqual([]);
      expect(store.pendingEffects("run-sqlite")).toHaveLength(1);
      expect(() => store.readEffect(effectId)).toThrowError(SqliteStoreError);
      store.close();
    },
  );

  it.each(["settle-after-effect", "settle-after-budget", "settle-after-outbox"])(
    "rolls back atomic settlement at %s",
    async (faultPoint) => {
      const path = await databasePath();
      const setup = new SqliteHarnessStore(path);
      setup.createCandidate(workflow, {
        runId: "run-sqlite", fencingEpoch: 1, sourceSha: "source-sqlite", policySha256: "policy-sqlite",
      });
      setup.apply(workflow, command(), authorities);
      setup.createBudget("run-sqlite", { usd: 1, inputTokens: 1_000, outputTokens: 100, requests: 2 });
      const effectId = setup.pendingEffects("run-sqlite")[0].effectId;
      const started = setup.beginEffectDispatch(
        "run-sqlite", effectId, "queryable",
        {
          reservationId: "reservation-fault", runId: "run-sqlite", effectId, fencingEpoch: 1,
          worstCase: { usd: 1, inputTokens: 1_000, outputTokens: 100, requests: 2 }, status: "reserved",
        },
        {
          workerId: "worker-1", fencingEpoch: 1, now: "2026-09-10T11:00:00.000Z",
          leaseUntil: "2026-09-10T11:02:00.000Z", minimumLeaseMs: 30_000, maxAttempts: 3,
        },
      );
      setup.close();
      const store = new SqliteHarnessStore(path, {
        injectFault: (point) => { if (point === faultPoint) throw new Error(faultPoint); },
      });
      expect(() => store.completeEffect(
        "run-sqlite", effectId, started.effect.revision, 1, started.budget.revision, "reservation-fault",
        {
          ...providerReceipt("receipt-fault"),
          effectId,
          reservationId: "reservation-fault",
        },
      )).toThrow(faultPoint);
      expect(store.readEffect(effectId).status).toBe("claimed");
      expect(store.readBudget("run-sqlite").reservations[0].status).toBe("dispatched");
      expect(() => store.readProviderUsageReceipt(effectId)).toThrowError(SqliteStoreError);
      store.close();
    },
  );
});