// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { LockedTaskSpec } from "./taskSpec";
import { canonical, sha256 } from "./trust";
import {
  buildCopilotConfiguration,
  createGatewayProxyTools,
  createGatewayPermissionHandler,
  gatewayToolIds,
  prepareWorkerLaunch,
  type CredentialBrokerAttestation,
  type GatewayResponse,
  type WorkerIsolationAttestation,
  type WorkerRuntimePlan,
} from "./worker";

const now = Date.parse("2026-09-10T11:00:00.000Z");
const digest = (character: string) => character.repeat(64);
const task = (): LockedTaskSpec => ({
  schemaVersion: "1.0",
  status: "SPEC_LOCKED",
  releaseEligible: false,
  dispatchAuthorized: true,
  mode: "implementation",
  runId: "run-001",
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
    branch: "candidate/S36/run-001",
    baseSha: "a".repeat(40),
    sourceSha: "a".repeat(40),
    treeSha256: digest("a"),
    diffSha256: digest("b"),
    clean: true,
  },
  bindings: {
    backlogSha256: digest("c"),
    policySha256: digest("d"),
    workflowSha256: digest("e"),
    planSchemaSha256: digest("0"),
    controllerSha256: digest("8"),
    evaluatorPackSha256: digest("f"),
    testInventorySha256: digest("1"),
    fixtureManifestSha256: digest("2"),
    toolchainSha256: digest("3"),
    dependencyLockSha256: digest("4"),
    impactMapSha256: digest("5"),
    negativeControlIds: ["NC-1"],
  },
  dependencyClosure: ["H01", "H02", "H03", "H04"],
  dependencyReceipts: [],
  allowedPaths: ["src/features/voice"],
  nonGoals: ["No release"],
  allowedTools: [...gatewayToolIds],
  agentRuntime: { providerId: "copilot-subscription", model: "gpt-5" },
  validationCommands: [{
    id: "voice-tests",
    executable: "npm",
    args: ["test", "--", "src/features/voice"],
    cwd: "src/features/voice",
    timeoutMs: 10 * 60_000,
    maxOutputBytes: 1024 * 1024,
  }],
  modelNetworkHosts: ["api.githubcopilot.com"],
  toolNetworkHosts: [],
  deniedAuthorities: ["production-network"],
  requiredGates: ["G00", "G01", "G02", "G03", "G04", "G05", "G07", "G08", "G09"],
  requiredAcceptanceIds: ["S36-A", "S36-B"],
  requiredAcceptance: [
    { id: "S36-A", gate: "G07", check: "Mute cancels capture." },
    { id: "S36-B", gate: "G07", check: "Navigation remains bounded." },
  ],
  requiredEvidenceKinds: ["regression", "browser", "adversarial"],
  requiredModelEvaluationIds: [],
  negativeControlIds: ["NC-1"],
  visibleOutcome: "Mute stops capture",
  rolloutProfile: "frontend-only",
  rolloutSteps: ["Implement"],
  rollback: "Disable voice start",
  budgets: {
    maxAttempts: 3,
    maxActiveMinutes: 360,
    maxAttemptMinutes: 45,
    maxUsd: 0,
    maxInputTokens: 100_000,
    maxOutputTokens: 10_000,
    maxRequests: 20,
    maxAiCredits: 2,
  },
  preparedAt: "2026-09-10T11:00:00.000Z",
  deadline: "2026-09-10T17:00:00.000Z",
  taskSpecSha256: digest("6"),
  lock: {
    lockId: "lock-001",
    taskSpecSha256: digest("6"),
    runId: "run-001",
    sliceId: "S36",
    sourceSha: "a".repeat(40),
    policySha256: digest("d"),
    issuer: "spec-locker",
    issuedAt: "2026-09-10T10:59:00.000Z",
    expiresAt: "2026-09-10T11:05:00.000Z",
    signature: "signed",
  },
});

const runtime = (): WorkerRuntimePlan => ({
  sdkVersion: "1.0.13",
  bundledCliVersion: "1.0.83",
  runtimeImageSha256: digest("7"),
  containerDependencyDirectory: "/opt/watai/node_modules",
  model: "gpt-5",
  providerId: "copilot-subscription",
  maxAiCredits: 2,
  brokerScratchDirectory: "C:/harness/broker/run-001",
  brokerHomeDirectory: "C:/harness/home/run-001",
  brokerEnvironment: { PATH: "C:/harness/bin" },
  credentialReference: "secretref://copilot/run-001",
  gatewayTools: [...gatewayToolIds],
  validationCommands: [{
    id: "voice-tests",
    executable: "npm",
    args: ["test", "--", "src/features/voice"],
    cwd: "src/features/voice",
    timeoutMs: 10 * 60_000,
    maxOutputBytes: 1024 * 1024,
  }],
  memoryMb: 4096,
  cpuCount: 2,
  pidsLimit: 256,
});

const isolation = (): WorkerIsolationAttestation => ({
  attestationId: "isolation-001",
  taskSpecSha256: digest("6"),
  policySha256: digest("d"),
  runtimeImageSha256: digest("7"),
  engine: "docker-linux",
  networkMode: "none",
  rootFilesystemReadOnly: true,
  sourceMountReadOnly: true,
  writesThroughGateway: true,
  nonRootUser: true,
  noNewPrivileges: true,
  droppedCapabilities: ["ALL"],
  dockerSocketMounted: false,
  hostHomeMounted: false,
  credentialEnvironmentEmpty: true,
  issuer: "sandbox-verifier",
  issuedAt: "2026-09-10T10:59:00.000Z",
  expiresAt: "2026-09-10T11:05:00.000Z",
  signature: "trusted:isolation-001",
});

const broker = (): CredentialBrokerAttestation => ({
  attestationId: "broker-001",
  taskSpecSha256: digest("6"),
  policySha256: digest("d"),
  providerId: "copilot-subscription",
  providerHosts: ["api.githubcopilot.com"],
  noWorkspaceMount: true,
  tokenStorage: "memory-only",
  ambientLoginDisabled: true,
  toolProcessReceivesCredentials: false,
  issuer: "broker-verifier",
  issuedAt: "2026-09-10T10:59:00.000Z",
  expiresAt: "2026-09-10T11:05:00.000Z",
  signature: "trusted:broker-001",
});

const authorities = {
  now: () => now,
  verifyWorkerIsolation: (value: WorkerIsolationAttestation) => value.signature === `trusted:${value.attestationId}`,
  verifyCredentialBroker: (value: CredentialBrokerAttestation) => value.signature === `trusted:${value.attestationId}`,
};

describe("worker launch contract", () => {
  it("prepares a pinned split broker/sandbox launch", () => {
    const result = prepareWorkerLaunch(task(), runtime(), isolation(), broker(), authorities);
    expect(result.outcome).toBe("LAUNCH_READY");
    expect(result.manifest).toEqual(expect.objectContaining({
      status: "LAUNCH_READY",
      releaseEligible: false,
      broker: expect.objectContaining({ workspaceMounted: false }),
      sandbox: expect.objectContaining({ networkMode: "none" }),
    }));
  });

  it.each([
    ["missing isolation", undefined, broker(), "ISOLATION_ATTESTATION_MISSING"],
    ["missing broker", isolation(), undefined, "CREDENTIAL_BROKER_ATTESTATION_MISSING"],
    ["networked tools", isolation(), broker(), "TOOL_NETWORK_FORBIDDEN"],
    ["extra runtime tool", isolation(), broker(), "TOOL_SET_INVALID"],
    ["changed model", isolation(), broker(), "AGENT_RUNTIME_MISMATCH"],
    ["changed validation", isolation(), broker(), "VALIDATION_COMMAND_SET_MISMATCH"],
  ])("blocks %s", (_label, isolationValue, brokerValue, code) => {
    const value = task();
    const runtimeValue = runtime();
    if (code === "TOOL_NETWORK_FORBIDDEN") value.toolNetworkHosts = ["example.com"];
    if (code === "TOOL_SET_INVALID") value.allowedTools = ["watai_read_file"];
    if (code === "AGENT_RUNTIME_MISMATCH") runtimeValue.model = "different-model";
    if (code === "VALIDATION_COMMAND_SET_MISMATCH") runtimeValue.validationCommands[0].args = ["test", "--", "other"];
    const result = prepareWorkerLaunch(value, runtimeValue, isolationValue, brokerValue, authorities);
    expect(result.outcome).toBe("BLOCKED_SAFE");
    expect(result.blockers.map((blocker) => blocker.code)).toContain(code);
  });

  it("denies every permission except an exact custom gateway tool", async () => {
    const handler = createGatewayPermissionHandler(["watai_read_file"]);
    await expect(Promise.resolve(handler({
      kind: "custom-tool",
      toolName: "watai_read_file",
      toolDescription: "Read a bounded file",
    }, { sessionId: "run-001" }))).resolves.toEqual({ kind: "approve-once" });
    await expect(Promise.resolve(handler({
      kind: "shell",
      commands: [],
      fullCommandText: "git push",
      hasWriteFileRedirection: false,
      intention: "push",
      possiblePaths: [],
      possibleUrls: [],
      canOfferSessionApproval: false,
    }, { sessionId: "run-001" }))).resolves.toMatchObject({ kind: "reject" });
  });

  it("builds empty-mode SDK configuration with no ambient auth or tools", () => {
    const launch = prepareWorkerLaunch(task(), runtime(), isolation(), broker(), authorities).manifest!;
    const configuration = buildCopilotConfiguration(launch, "synthetic-test-token", {
      invoke: async (request): Promise<GatewayResponse> => {
        const result = { ok: true };
        return {
          schemaVersion: "1.0",
          requestId: request.requestId,
          runId: request.runId,
          manifestSha256: request.manifestSha256,
          status: "success",
          result,
          resultSha256: "unused-in-config-test",
        };
      },
      getSubmission: async () => undefined,
    });

    expect(configuration.client).toMatchObject({
      mode: "empty", useLoggedInUser: false, gitHubToken: "synthetic-test-token",
    });
    expect(configuration.session).not.toHaveProperty("gitHubTokenProvider");
    expect(configuration.session).toMatchObject({
      enableSessionStore: false,
      enableHostGitOperations: false,
      enableSkills: false,
      remoteSession: "off",
      availableTools: [...gatewayToolIds],
      enableManagedSettings: true,
      sessionLimits: { maxAiCredits: 2 },
    });
    expect(configuration.session.tools?.find((tool) => tool.name === "watai_run_validation")?.description)
      .toContain("Never repeat");
  });

  it("rejects a gateway response that is not bound to the launch manifest", async () => {
    const launch = prepareWorkerLaunch(task(), runtime(), isolation(), broker(), authorities).manifest!;
    const tools = createGatewayProxyTools(launch, {
      invoke: async (request) => ({
        schemaVersion: "1.0",
        requestId: request.requestId,
        runId: request.runId,
        manifestSha256: "wrong-manifest",
        status: "success",
        result: { ok: true },
        resultSha256: "0".repeat(64),
      }),
      getSubmission: async () => undefined,
    });

    await expect(tools[0].handler?.({}, {
      sessionId: "run-001",
      toolCallId: "tool-call-001",
      toolName: tools[0].name,
      arguments: {},
    })).rejects.toThrow("misbound response");
  });

  it("rejects duplicate validation after a passing receipt without invoking the gateway twice", async () => {
    const launch = prepareWorkerLaunch(task(), runtime(), isolation(), broker(), authorities).manifest!;
    const invoke = vi.fn(async (request): Promise<GatewayResponse> => {
      const result = { commandId: "fixed", passed: true };
      return {
        schemaVersion: "1.0",
        requestId: request.requestId,
        runId: request.runId,
        manifestSha256: request.manifestSha256,
        status: "success",
        result,
        resultSha256: sha256(canonical(result)),
      };
    });
    const tool = createGatewayProxyTools(launch, { invoke, getSubmission: async () => undefined })
      .find((candidate) => candidate.name === "watai_run_validation")!;
    await tool.handler?.({ commandId: "fixed" }, {
      sessionId: launch.runId, toolCallId: "validation-1", toolName: tool.name, arguments: {},
    });
    await expect(tool.handler?.({ commandId: "fixed" }, {
      sessionId: launch.runId, toolCallId: "validation-2", toolName: tool.name, arguments: {},
    })).rejects.toThrow("call watai_submit_result immediately");
    expect(invoke).toHaveBeenCalledOnce();
  });
});