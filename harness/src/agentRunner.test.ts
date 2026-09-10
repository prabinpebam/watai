// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { runAgentAttempt, type AgentClientPort, type AgentSessionPort } from "./agentRunner";
import type { LockedTaskSpec } from "./taskSpec";
import type { GatewayTransport, WorkerLaunchManifest } from "./worker";

const digest = (character: string) => character.repeat(64);
const task = {
  schemaVersion: "1.0",
  status: "SPEC_LOCKED",
  releaseEligible: false,
  dispatchAuthorized: true,
  mode: "implementation",
  runId: "run-agent",
  sliceId: "S36",
  title: "Voice mute",
  milestone: "M1",
  risk: "high",
  ownerRole: "builder",
  executionDomain: "product",
  mutationClass: "candidate",
  fencingEpoch: 1,
  source: {
    repositoryId: "prabinpebam/watai",
    branch: "candidate/S36/run-agent",
    baseSha: "a".repeat(40),
    sourceSha: "a".repeat(40),
    treeSha256: digest("a"),
    diffSha256: digest("b"),
    clean: true,
  },
  bindings: {
    backlogSha256: digest("c"), policySha256: digest("d"), workflowSha256: digest("e"),
    planSchemaSha256: digest("f"), controllerSha256: digest("1"), evaluatorPackSha256: digest("2"),
    testInventorySha256: digest("3"), fixtureManifestSha256: digest("4"), toolchainSha256: digest("5"),
    dependencyLockSha256: digest("6"), impactMapSha256: digest("7"), negativeControlIds: ["NC-1"],
  },
  dependencyClosure: [], dependencyReceipts: [], allowedPaths: ["src/features/voice"],
  nonGoals: ["No release"],
  allowedTools: ["watai_read_file", "watai_search_text", "watai_apply_patch", "watai_run_validation", "watai_git_diff", "watai_submit_result"],
  modelNetworkHosts: ["api.githubcopilot.com"], toolNetworkHosts: [], deniedAuthorities: ["production-network"],
  requiredGates: ["G02"], requiredAcceptanceIds: ["S36-A"],
  requiredAcceptance: [{ id: "S36-A", gate: "G02", check: "Mute cancels capture." }],
  requiredEvidenceKinds: ["regression"], negativeControlIds: ["NC-1"], visibleOutcome: "Mute cancels",
  rolloutProfile: "frontend-only", rolloutSteps: ["Implement"], rollback: "Disable voice",
  budgets: { maxAttempts: 3, maxActiveMinutes: 360, maxAttemptMinutes: 45, maxUsd: 0, maxInputTokens: 1000, maxOutputTokens: 100, maxRequests: 2 },
  preparedAt: "2026-09-10T11:00:00.000Z", deadline: "2026-09-10T12:00:00.000Z",
  taskSpecSha256: digest("8"),
  lock: { lockId: "lock", taskSpecSha256: digest("8"), runId: "run-agent", sliceId: "S36", sourceSha: "a".repeat(40), policySha256: digest("d"), issuer: "locker", issuedAt: "2026-09-10T10:59:00.000Z", expiresAt: "2026-09-10T11:05:00.000Z", signature: "signed" },
} as LockedTaskSpec;

const manifest = {
  schemaVersion: "1.0", status: "LAUNCH_READY", releaseEligible: false,
  runId: "run-agent", taskSpecSha256: digest("8"), sourceSha: "a".repeat(40), policySha256: digest("d"), fencingEpoch: 1,
  runtime: {
    sdkVersion: "1.0.13", bundledCliVersion: "1.0.83", runtimeImageSha256: digest("9"), model: "gpt-5",
    providerId: "copilot", brokerScratchDirectory: "C:/scratch", brokerHomeDirectory: "C:/home",
    brokerEnvironment: { PATH: "C:/bin" }, credentialReference: "secretref://copilot",
    gatewayTools: task.allowedTools, validationCommands: [], memoryMb: 1024, cpuCount: 1, pidsLimit: 64,
  },
  sandbox: { engine: "docker-linux", networkMode: "none", allowedReadRoot: "/workspace/source", allowedWriteRoots: task.allowedPaths, validationCommandIds: [], memoryMb: 1024, cpuCount: 1, pidsLimit: 64 },
  broker: { model: "gpt-5", providerId: "copilot", allowedHosts: task.modelNetworkHosts, credentialReference: "secretref://copilot", workspaceMounted: false },
  deadline: task.deadline, manifestSha256: digest("0"),
} as WorkerLaunchManifest;

const transport: GatewayTransport = { invoke: vi.fn() };
const broker = { gitHubTokenProvider: vi.fn() };

function fakeClient(): { client: AgentClientPort; session: AgentSessionPort } {
  const session: AgentSessionPort = {
    sessionId: "session-agent",
    sendAndWait: vi.fn().mockResolvedValue({ data: { content: "done" } }),
    disconnect: vi.fn().mockResolvedValue(undefined),
  };
  const client: AgentClientPort = {
    start: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue(session),
    resumeSession: vi.fn().mockResolvedValue(session),
    stop: vi.fn().mockResolvedValue([]),
    forceStop: vi.fn().mockResolvedValue(undefined),
  };
  return { client, session };
}

describe("agent attempt runner", () => {
  it("runs one bounded new session and cleans it up", async () => {
    const fake = fakeClient();
    const result = await runAgentAttempt({
      task, manifest, credentialBroker: broker, gatewayTransport: transport,
      now: () => Date.parse("2026-09-10T11:00:00.000Z"), createClient: () => fake.client,
    });
    expect(result).toMatchObject({ status: "completed", assistantContent: "done" });
    expect(fake.client.createSession).toHaveBeenCalledOnce();
    expect(fake.session.disconnect).toHaveBeenCalledOnce();
    expect(fake.client.stop).toHaveBeenCalledOnce();
  });

  it("reinjects policy on resume and never continues pending work", async () => {
    const fake = fakeClient();
    await runAgentAttempt({
      task, manifest, credentialBroker: broker, gatewayTransport: transport, resumeSessionId: "session-agent",
      now: () => Date.parse("2026-09-10T11:00:00.000Z"), createClient: () => fake.client,
    });
    expect(fake.client.resumeSession).toHaveBeenCalledWith("session-agent", expect.objectContaining({
      enableManagedSettings: true,
      continuePendingWork: false,
      availableTools: task.allowedTools,
    }));
  });

  it("rejects a stale or misbound launch before constructing the client", async () => {
    const createClient = vi.fn();
    await expect(runAgentAttempt({
      task, manifest: { ...manifest, sourceSha: "b".repeat(40) }, credentialBroker: broker,
      gatewayTransport: transport, now: () => Date.parse("2026-09-10T11:00:00.000Z"), createClient,
    })).rejects.toMatchObject({ code: "MANIFEST_BINDING_MISMATCH" });
    expect(createClient).not.toHaveBeenCalled();
  });
});