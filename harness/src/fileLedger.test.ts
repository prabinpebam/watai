// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import workflowJson from "../../documentation/implementation/2026-09-10-autonomous-delivery/contracts/workflow.json";
import {
  compileWorkflow,
  createCandidate,
  type ActorProof,
  type EventCommand,
  type GuardProof,
  type HarnessAuthorities,
  type WorkflowDefinition,
} from "./controller";
import { FileCandidateLedger, FileLedgerError } from "./fileLedger";

const directories: string[] = [];
const workflow = compileWorkflow(workflowJson as WorkflowDefinition);
const now = Date.parse("2026-09-10T11:00:00.000Z");
const authorities: HarnessAuthorities = {
  now: () => now,
  limits: {
    maxClockSkewMs: 5_000,
    maxGuardProofLifetimeMs: 15 * 60_000,
    maxPermitLifetimeMs: 15 * 60_000,
    maxEffectLifetimeMs: 20 * 60_000,
  },
  verifyActor: (value) => value.signature === `trusted:${value.role}`,
  verifyGuard: (proof) => proof.signature === `trusted:${proof.guard}`,
  verifyPermit: () => false,
};

const actorProof = (): ActorProof => ({
  role: "controller",
  identity: "trusted-controller",
  runId: "run-file-001",
  eventId: "event-file-001",
  fencingEpoch: 3,
  sourceSha: "source-file",
  policySha256: "policy-file",
  issuedAt: "2026-09-10T10:59:00.000Z",
  expiresAt: "2026-09-10T11:05:00.000Z",
  signature: "trusted:controller",
});

const proof = (guard: string): GuardProof => ({
  guard,
  runId: "run-file-001",
  eventId: "event-file-001",
  fencingEpoch: 3,
  sourceSha: "source-file",
  policySha256: "policy-file",
  evidenceSha256: `evidence:${guard}`,
  issuer: "trusted-test-evaluator",
  issuedAt: "2026-09-10T10:59:00.000Z",
  expiresAt: "2026-09-10T11:05:00.000Z",
  signature: `trusted:${guard}`,
});

const command = (): EventCommand => ({
  envelope: {
    schemaVersion: "1.0",
    runId: "run-file-001",
    eventId: "event-file-001",
    expectedRevision: 0,
    fencingEpoch: 3,
    sourceSha: "source-file",
    policySha256: "policy-file",
    eventType: "dispatch",
    payloadSha256: "payload-file",
  },
  actor: "controller",
  actorProof: actorProof(),
  guardEvidence: Object.fromEntries(
    ["valid-envelope", "current-lease", "current-source", "budget-reserved"].map(
      (guard) => [guard, proof(guard)],
    ),
  ),
  effectDeadline: "2026-09-10T11:10:00.000Z",
});

async function ledgerPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "watai-harness-"));
  directories.push(directory);
  return join(directory, "candidate.json");
}

const initialCandidate = () =>
  createCandidate(workflow, {
    runId: "run-file-001",
    fencingEpoch: 3,
    sourceSha: "source-file",
    policySha256: "policy-file",
  });

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("file candidate ledger", () => {
  it("survives restart with one append-only transition record", async () => {
    const path = await ledgerPath();
    const firstProcess = await FileCandidateLedger.open(path, initialCandidate());
    await firstProcess.dispatch(workflow, command(), authorities);

    const secondProcess = await FileCandidateLedger.open(path, initialCandidate());
    expect(await secondProcess.read()).toEqual(
      expect.objectContaining({ state: "PREFLIGHT", revision: 1 }),
    );
    expect(await secondProcess.historyLength()).toBe(2);
  });

  it("does not append a second record for an exact replay", async () => {
    const path = await ledgerPath();
    const ledger = await FileCandidateLedger.open(path, initialCandidate());
    await ledger.dispatch(workflow, command(), authorities);
    const replay = await ledger.dispatch(workflow, command(), authorities);

    expect(replay.kind).toBe("replayed");
    expect(await ledger.historyLength()).toBe(2);
  });

  it("detects on-disk snapshot corruption", async () => {
    const path = await ledgerPath();
    const ledger = await FileCandidateLedger.open(path, initialCandidate());
    const document = JSON.parse(await readFile(path, "utf8"));
    document.records[0].snapshot.state = "SHIPPED";
    await writeFile(path, JSON.stringify(document), "utf8");

    await expect(ledger.read()).rejects.toMatchObject({
      code: "LEDGER_CORRUPT",
    });
  });

  it("rejects malformed nested state before creating a ledger", async () => {
    const path = await ledgerPath();
    const malformed = {
      ...initialCandidate(),
      revision: 1,
      events: [{ eventId: "partial-receipt" }],
    };

    await expect(
      FileCandidateLedger.open(path, malformed as ReturnType<typeof initialCandidate>),
    ).rejects.toMatchObject({ code: "LEDGER_CORRUPT" });
  });

  it("rejects an active competing writer", async () => {
    const path = await ledgerPath();
    const ledger = await FileCandidateLedger.open(path, initialCandidate());
    await writeFile(
      `${path}.lock`,
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
      "utf8",
    );

    await expect(ledger.dispatch(workflow, command(), authorities)).rejects.toMatchObject({
      code: "LEDGER_LOCKED",
    });
    expect((await ledger.read()).state).toBe("QUEUED");
  });

  it("rejects reuse for a different candidate identity", async () => {
    const path = await ledgerPath();
    await FileCandidateLedger.open(path, initialCandidate());

    await expect(
      FileCandidateLedger.open(path, { ...initialCandidate(), runId: "other-run" }),
    ).rejects.toMatchObject({ code: "LEDGER_IDENTITY_MISMATCH" });

    await expect(
      FileCandidateLedger.open(path, { ...initialCandidate(), fencingEpoch: 4 }),
    ).rejects.toMatchObject({ code: "LEDGER_IDENTITY_MISMATCH" });
  });

  it("fails closed on a stale-looking lock instead of racing to remove it", async () => {
    const path = await ledgerPath();
    const ledger = await FileCandidateLedger.open(path, initialCandidate());
    await writeFile(
      `${path}.lock`,
      JSON.stringify({ pid: 2_147_483_647, createdAt: "2000-01-01T00:00:00.000Z" }),
      "utf8",
    );

    await expect(ledger.dispatch(workflow, command(), authorities)).rejects.toMatchObject({
      code: "LEDGER_LOCKED",
    });
  });
});