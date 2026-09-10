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
  agentRuntime: { providerId: "copilot", model: "gpt-5" },
  validationCommands: [],
  modelNetworkHosts: ["api.githubcopilot.com"], toolNetworkHosts: [], deniedAuthorities: ["production-network"],
  requiredGates: ["G02"], requiredAcceptanceIds: ["S36-A"],
  requiredAcceptance: [{ id: "S36-A", gate: "G02", check: "Mute cancels capture." }],
  requiredEvidenceKinds: ["regression"], requiredModelEvaluationIds: [], negativeControlIds: ["NC-1"], visibleOutcome: "Mute cancels",
  rolloutProfile: "frontend-only", rolloutSteps: ["Implement"], rollback: "Disable voice",
  budgets: { maxAttempts: 3, maxActiveMinutes: 360, maxAttemptMinutes: 45, maxUsd: 0, maxInputTokens: 1000, maxOutputTokens: 100, maxRequests: 2, maxAiCredits: 2 },
  preparedAt: "2026-09-10T11:00:00.000Z", deadline: "2026-09-10T12:00:00.000Z",
  taskSpecSha256: digest("8"),
  lock: { lockId: "lock", taskSpecSha256: digest("8"), runId: "run-agent", sliceId: "S36", sourceSha: "a".repeat(40), policySha256: digest("d"), issuer: "locker", issuedAt: "2026-09-10T10:59:00.000Z", expiresAt: "2026-09-10T11:05:00.000Z", signature: "signed" },
} as LockedTaskSpec;

const manifest = {
  schemaVersion: "1.0", status: "LAUNCH_READY", releaseEligible: false,
  runId: "run-agent", taskSpecSha256: digest("8"), sourceSha: "a".repeat(40), policySha256: digest("d"), fencingEpoch: 1,
  runtime: {
    sdkVersion: "1.0.13", bundledCliVersion: "1.0.83", runtimeImageSha256: digest("9"),
    containerDependencyDirectory: "/opt/watai/node_modules", model: "gpt-5",
    providerId: "copilot", maxAiCredits: 2, brokerScratchDirectory: "C:/scratch", brokerHomeDirectory: "C:/home",
    brokerEnvironment: { PATH: "C:/bin" }, credentialReference: "secretref://copilot",
    gatewayTools: task.allowedTools, validationCommands: [], memoryMb: 1024, cpuCount: 1, pidsLimit: 64,
  },
  sandbox: { engine: "docker-linux", networkMode: "none", allowedReadRoot: "/workspace/source", allowedWriteRoots: task.allowedPaths, validationCommandIds: [], memoryMb: 1024, cpuCount: 1, pidsLimit: 64 },
  broker: { model: "gpt-5", providerId: "copilot", allowedHosts: task.modelNetworkHosts, credentialReference: "secretref://copilot", workspaceMounted: false },
  deadline: task.deadline, manifestSha256: digest("0"),
} as WorkerLaunchManifest;

const transport: GatewayTransport = {
  invoke: vi.fn(),
  getSubmission: vi.fn().mockResolvedValue({
    receiptId: "submission-1",
    runId: "run-agent",
    diffSha256: digest("a"),
    changedPaths: ["src/features/voice/VoiceMode.tsx"],
    validationCommandIds: [],
    summary: "done",
    completedAt: "2026-09-10T11:00:30.000Z",
  }),
};
const broker = { gitHubTokenProvider: vi.fn() };

function fakeClient(): { client: AgentClientPort; session: AgentSessionPort } {
  const session: AgentSessionPort = {
    sessionId: "session-agent",
    sendAndWait: vi.fn().mockResolvedValue({ data: { content: "done" } }),
    rpc: {
      ui: {
        handlePendingSessionLimitsExhausted: vi.fn().mockResolvedValue({}),
      },
      usage: {
        getMetrics: vi.fn().mockResolvedValue({
          totalPremiumRequestCost: 1,
          totalUserRequests: 1,
          totalApiDurationMs: 500,
          currentModel: "gpt-5",
          modelMetrics: {
            "gpt-5": {
              requests: { count: 1, cost: 1 },
              usage: { inputTokens: 800, outputTokens: 100 },
            },
          },
        }),
      },
    },
    on: vi.fn().mockReturnValue(() => undefined),
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
    expect(result).toMatchObject({
      status: "completed",
      assistantContent: "done",
      usage: { inputTokens: 800, outputTokens: 100, requests: 1, currentModel: "gpt-5" },
    });
    expect(fake.client.createSession).toHaveBeenCalledOnce();
    expect(fake.session.disconnect).not.toHaveBeenCalled();
    expect(fake.client.stop).toHaveBeenCalledOnce();
  });

  it("fails closed when session usage cannot be observed", async () => {
    const fake = fakeClient();
    vi.mocked(fake.session.rpc.usage.getMetrics).mockRejectedValue(new Error("usage unavailable"));
    await expect(runAgentAttempt({
      task, manifest, credentialBroker: broker, gatewayTransport: transport,
      now: () => Date.parse("2026-09-10T11:00:00.000Z"), createClient: () => fake.client,
    })).rejects.toMatchObject({ code: "AGENT_USAGE_UNAVAILABLE" });
  });

  it("fails closed when the agent never submits a validated result", async () => {
    const fake = fakeClient();
    const noSubmission = { ...transport, getSubmission: vi.fn().mockResolvedValue(undefined) };
    await expect(runAgentAttempt({
      task, manifest, credentialBroker: broker, gatewayTransport: noSubmission,
      now: () => Date.parse("2026-09-10T11:00:00.000Z"), createClient: () => fake.client,
    })).rejects.toMatchObject({ code: "AGENT_SUBMISSION_MISSING" });
  });

  it("cancels instead of extending an exhausted SDK session limit", async () => {
    const fake = fakeClient();
    vi.mocked(fake.session.on).mockImplementation((_event, handler) => {
      (handler as (event: { data: { requestId: string } }) => void)({ data: { requestId: "limit-1" } });
      return () => undefined;
    });
    await expect(runAgentAttempt({
      task, manifest, credentialBroker: broker, gatewayTransport: transport,
      now: () => Date.parse("2026-09-10T11:00:00.000Z"), createClient: () => fake.client,
    })).rejects.toMatchObject({ code: "AGENT_AI_CREDIT_LIMIT_EXHAUSTED" });
    expect(fake.session.rpc.ui.handlePendingSessionLimitsExhausted).toHaveBeenCalledWith({
      requestId: "limit-1",
      response: { action: "cancel" },
    });
  });

  it("force-stops when streaming usage crosses the locked token ceiling", async () => {
    const fake = fakeClient();
    vi.mocked(fake.session.on).mockImplementation((event, handler) => {
      if (event === "assistant.usage") {
        handler({ data: { inputTokens: 1_001, outputTokens: 0, copilotUsage: { totalNanoAiu: 1 } } });
      }
      return () => undefined;
    });
    await expect(runAgentAttempt({
      task, manifest, credentialBroker: broker, gatewayTransport: transport,
      now: () => Date.parse("2026-09-10T11:00:00.000Z"), createClient: () => fake.client,
    })).rejects.toMatchObject({ code: "AGENT_USAGE_BUDGET_EXCEEDED" });
    expect(fake.client.forceStop).toHaveBeenCalledOnce();
  });

  it("force-stops the broker when the hard attempt deadline elapses", async () => {
    const fake = fakeClient();
    vi.mocked(fake.session.sendAndWait).mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { data: { content: "late" } } as never;
    });
    await expect(runAgentAttempt({
      task: { ...task, budgets: { ...task.budgets, maxAttemptMinutes: 0.0001 } },
      manifest,
      credentialBroker: broker,
      gatewayTransport: transport,
      now: () => Date.parse("2026-09-10T11:00:00.000Z"),
      createClient: () => fake.client,
    })).rejects.toMatchObject({ code: "ATTEMPT_DEADLINE_EXPIRED" });
    expect(fake.client.forceStop).toHaveBeenCalled();
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