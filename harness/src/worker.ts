import {
  DisableBypassPermissionsModes,
  type CopilotClientOptions,
  type GitHubTokenProvider,
  type PermissionHandler,
  type SessionConfig,
  type Tool,
} from "@github/copilot-sdk";

import type { LockedTaskSpec, TaskValidationCommand } from "./taskSpec.js";
import { canonical, sha256 } from "./trust.js";

export const gatewayToolIds = [
  "watai_read_file",
  "watai_search_text",
  "watai_apply_patch",
  "watai_run_validation",
  "watai_git_diff",
  "watai_submit_result",
] as const;

export type GatewayToolId = typeof gatewayToolIds[number];

export type FixedValidationCommand = TaskValidationCommand;

export interface WorkerRuntimePlan {
  sdkVersion: "1.0.13";
  bundledCliVersion: "1.0.83";
  runtimeImageSha256: string;
  containerDependencyDirectory: "/opt/watai/node_modules";
  model: string;
  providerId: string;
  maxAiCredits: number;
  brokerScratchDirectory: string;
  brokerHomeDirectory: string;
  brokerEnvironment: Record<string, string>;
  credentialReference: string;
  gatewayTools: GatewayToolId[];
  validationCommands: FixedValidationCommand[];
  memoryMb: number;
  cpuCount: number;
  pidsLimit: number;
}

export interface WorkerIsolationAttestation {
  attestationId: string;
  taskSpecSha256: string;
  policySha256: string;
  runtimeImageSha256: string;
  engine: "docker-linux";
  networkMode: "none";
  rootFilesystemReadOnly: true;
  sourceMountReadOnly: true;
  writesThroughGateway: true;
  nonRootUser: true;
  noNewPrivileges: true;
  droppedCapabilities: ["ALL"];
  dockerSocketMounted: false;
  hostHomeMounted: false;
  credentialEnvironmentEmpty: true;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface CredentialBrokerAttestation {
  attestationId: string;
  taskSpecSha256: string;
  policySha256: string;
  providerId: string;
  providerHosts: string[];
  noWorkspaceMount: true;
  tokenStorage: "memory-only";
  ambientLoginDisabled: true;
  toolProcessReceivesCredentials: false;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface WorkerAuthorities {
  now(): number;
  verifyWorkerIsolation(attestation: WorkerIsolationAttestation): boolean;
  verifyCredentialBroker(attestation: CredentialBrokerAttestation): boolean;
}

export interface SessionCredentialBroker {
  gitHubTokenProvider: GitHubTokenProvider;
}

export interface GatewayRequest {
  schemaVersion: "1.0";
  requestId: string;
  runId: string;
  taskSpecSha256: string;
  manifestSha256: string;
  fencingEpoch: number;
  tool: GatewayToolId;
  arguments: unknown;
}

export interface GatewayResponse {
  schemaVersion: "1.0";
  requestId: string;
  runId: string;
  manifestSha256: string;
  status: "success" | "failure";
  result: unknown;
  resultSha256: string;
}

export interface GatewayTransport {
  invoke(request: GatewayRequest, signal?: AbortSignal): Promise<GatewayResponse>;
  getSubmission(runId: string): Promise<{
    receiptId: string;
    runId: string;
    diffSha256: string;
    changedPaths: string[];
    validationCommandIds: string[];
    summary: string;
    completedAt: string;
  } | undefined>;
}

export interface WorkerLaunchManifest {
  schemaVersion: "1.0";
  status: "LAUNCH_READY";
  releaseEligible: false;
  runId: string;
  taskSpecSha256: string;
  sourceSha: string;
  policySha256: string;
  fencingEpoch: number;
  runtime: WorkerRuntimePlan;
  sandbox: {
    engine: "docker-linux";
    networkMode: "none";
    allowedReadRoot: string;
    allowedWriteRoots: string[];
    validationCommandIds: string[];
    memoryMb: number;
    cpuCount: number;
    pidsLimit: number;
  };
  broker: {
    model: string;
    providerId: string;
    allowedHosts: string[];
    credentialReference: string;
    workspaceMounted: false;
  };
  deadline: string;
  manifestSha256: string;
}

export interface WorkerPreparation {
  outcome: "LAUNCH_READY" | "BLOCKED_SAFE";
  blockers: Array<{ code: string; message: string }>;
  manifest?: WorkerLaunchManifest;
}

const digestPattern = /^[a-f0-9]{64}$/;
const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]{1,80}$/;
const forbiddenEnvironment = /(TOKEN|SECRET|PASSWORD|KEY|CREDENTIAL|HOME|USERPROFILE|GITHUB|AZURE)/i;

function safeValidationDirectory(value: string): boolean {
  const path = value.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (path === "" || path === ".") return true;
  return !path.startsWith("/") && !/^[A-Za-z]:/.test(path) &&
    !path.split("/").some((segment) => segment === ".." || segment === ".");
}

function currentAttestation(
  issuedAt: string,
  expiresAt: string,
  now: number,
): boolean {
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  return Number.isFinite(issued) && Number.isFinite(expires) && issued <= now && now < expires && issued < expires;
}

export function prepareWorkerLaunch(
  task: LockedTaskSpec,
  runtime: WorkerRuntimePlan,
  isolation: WorkerIsolationAttestation | undefined,
  broker: CredentialBrokerAttestation | undefined,
  authorities: WorkerAuthorities,
): WorkerPreparation {
  const blockers: WorkerPreparation["blockers"] = [];
  const block = (code: string, message: string) => blockers.push({ code, message });
  if (task.status !== "SPEC_LOCKED" || !task.dispatchAuthorized || task.mode !== "implementation") {
    block("TASK_NOT_DISPATCH_AUTHORIZED", "Only an implementation TaskSpec with an independent lock can launch.");
  }
  if (!task.source.clean) block("SOURCE_DIRTY", "Worker source binding is not clean.");
  if (task.mutationClass === "read-only") {
    block("NO_MUTATION_WORK", "Read-only and release tasks do not launch a builder worker.");
  }
  if (runtime.sdkVersion !== "1.0.13" || runtime.bundledCliVersion !== "1.0.83") {
    block("COPILOT_RUNTIME_UNPINNED", "Worker must use SDK 1.0.13 and its bundled CLI 1.0.83.");
  }
  if (!digestPattern.test(runtime.runtimeImageSha256)) {
    block("RUNTIME_IMAGE_UNPINNED", "Runtime image must be bound by SHA-256.");
  }
  if (runtime.containerDependencyDirectory !== "/opt/watai/node_modules") {
    block("CONTAINER_DEPENDENCIES_UNPINNED", "Worker dependencies must come from the pinned image path /opt/watai/node_modules.");
  }
  if (!runtime.model.trim() || !runtime.providerId.trim() || !runtime.credentialReference.trim()) {
    block("MODEL_CONFIGURATION_INCOMPLETE", "Model, provider and opaque credential reference are required.");
  }
  if (
    !task.agentRuntime ||
    task.agentRuntime.providerId !== runtime.providerId ||
    task.agentRuntime.model !== runtime.model
  ) {
    block("AGENT_RUNTIME_MISMATCH", "Worker provider/model does not match the locked TaskSpec.");
  }
  if (
    !Number.isFinite(runtime.maxAiCredits) ||
    runtime.maxAiCredits <= 0 ||
    runtime.maxAiCredits !== task.budgets.maxAiCredits
  ) {
    block("AI_CREDIT_LIMIT_INVALID", "SDK AI-credit limit must exactly match the locked TaskSpec ceiling.");
  }
  if (Object.keys(runtime.brokerEnvironment).some((name) => forbiddenEnvironment.test(name))) {
    block("BROKER_ENVIRONMENT_UNSAFE", "Broker environment contains a credential or ambient-home variable.");
  }
  if (
    runtime.memoryMb < 512 ||
    runtime.cpuCount <= 0 ||
    runtime.pidsLimit < 16 ||
    !Number.isFinite(runtime.memoryMb) ||
    !Number.isFinite(runtime.cpuCount) ||
    !Number.isSafeInteger(runtime.pidsLimit)
  ) {
    block("RESOURCE_LIMIT_INVALID", "Worker CPU, memory and PID ceilings must be explicit and positive.");
  }
  const tools = [...new Set(runtime.gatewayTools)];
  if (
    tools.length !== runtime.gatewayTools.length ||
    tools.some((tool) => !gatewayToolIds.includes(tool)) ||
    canonical([...task.allowedTools].sort()) !== canonical([...tools].sort())
  ) {
    block("TOOL_SET_INVALID", "Runtime tools must exactly cover the TaskSpec's known gateway-tool allowlist.");
  }
  if (task.toolNetworkHosts.length > 0) {
    block("TOOL_NETWORK_FORBIDDEN", "The tool sandbox must have zero network egress.");
  }
  const commandIds = new Set<string>();
  for (const command of runtime.validationCommands) {
    const invalid =
      !safeIdentifier.test(command.id) ||
      commandIds.has(command.id) ||
      !safeIdentifier.test(command.executable) ||
      command.args.some((arg) => /[\r\n\0]/.test(arg)) ||
      !safeValidationDirectory(command.cwd) ||
      command.timeoutMs <= 0 ||
      command.timeoutMs > task.budgets.maxAttemptMinutes * 60_000 ||
      command.maxOutputBytes <= 0 ||
      command.maxOutputBytes > 10 * 1024 * 1024;
    if (invalid) block("VALIDATION_COMMAND_INVALID", `Validation command ${command.id || "<unnamed>"} is unsafe.`);
    commandIds.add(command.id);
  }
  if (canonical(runtime.validationCommands) !== canonical(task.validationCommands)) {
    block("VALIDATION_COMMAND_SET_MISMATCH", "Worker validations do not exactly match the locked TaskSpec.");
  }

  const now = authorities.now();
  if (!Number.isFinite(Date.parse(task.deadline)) || Date.parse(task.deadline) <= now) {
    block("TASK_DEADLINE_EXPIRED", "TaskSpec deadline is invalid or expired.");
  }
  if (!isolation) {
    block("ISOLATION_ATTESTATION_MISSING", "A current independent sandbox attestation is required.");
  } else {
    const valid =
      isolation.taskSpecSha256 === task.taskSpecSha256 &&
      isolation.policySha256 === task.bindings.policySha256 &&
      isolation.runtimeImageSha256 === runtime.runtimeImageSha256 &&
      isolation.engine === "docker-linux" &&
      isolation.networkMode === "none" &&
      isolation.rootFilesystemReadOnly &&
      isolation.sourceMountReadOnly &&
      isolation.writesThroughGateway &&
      isolation.nonRootUser &&
      isolation.noNewPrivileges &&
      isolation.droppedCapabilities.length === 1 &&
      isolation.droppedCapabilities[0] === "ALL" &&
      !isolation.dockerSocketMounted &&
      !isolation.hostHomeMounted &&
      isolation.credentialEnvironmentEmpty &&
      currentAttestation(isolation.issuedAt, isolation.expiresAt, now) &&
      authorities.verifyWorkerIsolation(isolation);
    if (!valid) block("ISOLATION_ATTESTATION_INVALID", "Sandbox attestation is untrusted, stale or misbound.");
  }
  if (!broker) {
    block("CREDENTIAL_BROKER_ATTESTATION_MISSING", "A current independent credential-broker attestation is required.");
  } else {
    const expectedHosts = [...task.modelNetworkHosts].sort();
    const actualHosts = [...broker.providerHosts].sort();
    const valid =
      broker.taskSpecSha256 === task.taskSpecSha256 &&
      broker.policySha256 === task.bindings.policySha256 &&
      broker.providerId === runtime.providerId &&
      canonical(actualHosts) === canonical(expectedHosts) &&
      broker.noWorkspaceMount &&
      broker.tokenStorage === "memory-only" &&
      broker.ambientLoginDisabled &&
      !broker.toolProcessReceivesCredentials &&
      currentAttestation(broker.issuedAt, broker.expiresAt, now) &&
      authorities.verifyCredentialBroker(broker);
    if (!valid) block("CREDENTIAL_BROKER_ATTESTATION_INVALID", "Credential broker is untrusted, stale or misbound.");
  }
  if (blockers.length > 0) return { outcome: "BLOCKED_SAFE", blockers };

  const withoutDigest: Omit<WorkerLaunchManifest, "manifestSha256"> = {
    schemaVersion: "1.0",
    status: "LAUNCH_READY",
    releaseEligible: false,
    runId: task.runId,
    taskSpecSha256: task.taskSpecSha256,
    sourceSha: task.source.sourceSha,
    policySha256: task.bindings.policySha256,
    fencingEpoch: task.fencingEpoch,
    runtime,
    sandbox: {
      engine: "docker-linux",
      networkMode: "none",
      allowedReadRoot: "/workspace/source",
      allowedWriteRoots: [...task.allowedPaths],
      validationCommandIds: runtime.validationCommands.map((command) => command.id).sort(),
      memoryMb: runtime.memoryMb,
      cpuCount: runtime.cpuCount,
      pidsLimit: runtime.pidsLimit,
    },
    broker: {
      model: runtime.model,
      providerId: runtime.providerId,
      allowedHosts: [...task.modelNetworkHosts].sort(),
      credentialReference: runtime.credentialReference,
      workspaceMounted: false,
    },
    deadline: task.deadline,
  };
  return {
    outcome: "LAUNCH_READY",
    blockers: [],
    manifest: { ...withoutDigest, manifestSha256: sha256(canonical(withoutDigest)) },
  };
}

export function createGatewayPermissionHandler(allowedTools: readonly GatewayToolId[]): PermissionHandler {
  const allowed = new Set(allowedTools);
  return (request) => {
    if (request.managedApprovalRequired === true) {
      return { kind: "reject", feedback: "Managed policy requires unavailable human approval." };
    }
    if (request.kind === "custom-tool" && allowed.has(request.toolName as GatewayToolId)) {
      return { kind: "approve-once" };
    }
    return { kind: "reject", feedback: `Tool request denied by harness policy: ${request.kind}` };
  };
}

const gatewaySchemas: Record<GatewayToolId, Record<string, unknown>> = {
  watai_read_file: {
    type: "object",
    additionalProperties: false,
    required: ["path", "startLine", "endLine"],
    properties: {
      path: { type: "string", minLength: 1, maxLength: 512 },
      startLine: { type: "integer", minimum: 1 },
      endLine: { type: "integer", minimum: 1 },
    },
  },
  watai_search_text: {
    type: "object",
    additionalProperties: false,
    required: ["query", "isRegexp", "includePattern", "maxResults"],
    properties: {
      query: { type: "string", minLength: 1, maxLength: 2048 },
      isRegexp: { type: "boolean" },
      includePattern: { type: "string", minLength: 1, maxLength: 512 },
      maxResults: { type: "integer", minimum: 1, maximum: 200 },
    },
  },
  watai_apply_patch: {
    type: "object",
    additionalProperties: false,
    required: ["patch", "patchSha256", "expectedDiffSha256"],
    properties: {
      patch: { type: "string", minLength: 1, maxLength: 524288 },
      patchSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      expectedDiffSha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
    },
  },
  watai_run_validation: {
    type: "object",
    additionalProperties: false,
    required: ["commandId"],
    properties: { commandId: { type: "string", minLength: 1, maxLength: 80 } },
  },
  watai_git_diff: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  watai_submit_result: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "changedPaths", "validationCommandIds"],
    properties: {
      summary: { type: "string", minLength: 1, maxLength: 4000 },
      changedPaths: { type: "array", maxItems: 200, items: { type: "string", maxLength: 512 } },
      validationCommandIds: { type: "array", maxItems: 100, items: { type: "string", maxLength: 80 } },
    },
  },
};

export function createGatewayProxyTools(
  manifest: WorkerLaunchManifest,
  transport: GatewayTransport,
): Tool[] {
  const passedValidationIds = new Set<string>();
  const activeValidationIds = new Set<string>();
  const descriptions: Record<GatewayToolId, string> = {
    watai_read_file: "Read one tracked source-file range through the Watai gateway.",
    watai_search_text: "Search tracked source text through the Watai gateway.",
    watai_apply_patch: "Apply one expected-diff-bound patch through the Watai gateway.",
    watai_run_validation: `Run one fixed validation command (${manifest.runtime.validationCommands.map((command) => command.id).join(", ")}). Never repeat a command after it returns passed=true; submit immediately once all fixed validations pass.`,
    watai_git_diff: "Read the current changed paths, diff, and diff digest through the Watai gateway.",
    watai_submit_result: `Submit the terminal result after all fixed validations pass. This is the required final tool call. validationCommandIds must be exactly [${manifest.runtime.validationCommands.map((command) => command.id).join(", ")}], and changedPaths must exactly match the current Git diff.`,
  };
  return manifest.runtime.gatewayTools.map((name): Tool => ({
    name,
    description: descriptions[name],
    parameters: name === "watai_run_validation"
      ? {
          ...gatewaySchemas[name],
          properties: {
            commandId: {
              type: "string",
              enum: manifest.runtime.validationCommands.map((command) => command.id),
            },
          },
        }
      : name === "watai_submit_result"
        ? {
            ...gatewaySchemas[name],
            properties: {
              ...(gatewaySchemas[name].properties as Record<string, unknown>),
              validationCommandIds: {
                type: "array",
                minItems: manifest.runtime.validationCommands.length,
                maxItems: manifest.runtime.validationCommands.length,
                uniqueItems: true,
                items: {
                  type: "string",
                  enum: manifest.runtime.validationCommands.map((command) => command.id),
                },
              },
            },
          }
      : gatewaySchemas[name],
    defer: "never",
    handler: async (args, invocation) => {
      const validationId = name === "watai_run_validation" &&
        typeof (args as { commandId?: unknown }).commandId === "string"
        ? (args as { commandId: string }).commandId
        : undefined;
      if (validationId && passedValidationIds.has(validationId)) {
        throw new Error(
          `Validation ${validationId} already passed for the current diff. Do not repeat it; call watai_submit_result immediately.`,
        );
      }
      if (validationId && activeValidationIds.has(validationId)) {
        throw new Error(
          `Validation ${validationId} is already running. Do not start a duplicate; wait for its result.`,
        );
      }
      if (Buffer.byteLength(canonical(args), "utf8") > 1024 * 1024) {
        throw new Error(`Gateway arguments exceed the one-megabyte ceiling: ${name}`);
      }
      const request: GatewayRequest = {
        schemaVersion: "1.0",
        requestId: invocation.toolCallId,
        runId: manifest.runId,
        taskSpecSha256: manifest.taskSpecSha256,
        manifestSha256: manifest.manifestSha256,
        fencingEpoch: manifest.fencingEpoch,
        tool: name,
        arguments: args,
      };
      if (validationId) activeValidationIds.add(validationId);
      let response: GatewayResponse;
      try {
        response = await transport.invoke(request, invocation.signal);
      } finally {
        if (validationId) activeValidationIds.delete(validationId);
      }
      const valid =
        response.schemaVersion === "1.0" &&
        response.requestId === request.requestId &&
        response.runId === request.runId &&
        response.manifestSha256 === request.manifestSha256 &&
        response.resultSha256 === sha256(canonical(response.result));
      if (!valid) throw new Error(`Gateway returned an invalid or misbound response: ${name}`);
      if (response.status !== "success") throw new Error(`Gateway rejected ${name}`);
      if (Buffer.byteLength(canonical(response.result), "utf8") > 1024 * 1024) {
        throw new Error(`Gateway result exceeds the one-megabyte ceiling: ${name}`);
      }
      if (
        validationId &&
        typeof response.result === "object" &&
        response.result !== null &&
        (response.result as { passed?: unknown }).passed === true
      ) {
        passedValidationIds.add(validationId);
      }
      return response.result;
    },
  }));
}

export function buildCopilotConfiguration(
  manifest: WorkerLaunchManifest,
  gitHubToken: string,
  gatewayTransport: GatewayTransport,
): { client: CopilotClientOptions; session: SessionConfig } {
  const tools = createGatewayProxyTools(manifest, gatewayTransport);

  const client: CopilotClientOptions = {
    mode: "empty",
    workingDirectory: manifest.runtime.brokerScratchDirectory,
    baseDirectory: manifest.runtime.brokerHomeDirectory,
    env: { ...manifest.runtime.brokerEnvironment },
    gitHubToken,
    useLoggedInUser: false,
    logLevel: "warning",
  };
  const session: SessionConfig = {
    sessionId: manifest.runId,
    model: manifest.runtime.model,
    workingDirectory: manifest.runtime.brokerScratchDirectory,
    tools,
    availableTools: [...manifest.runtime.gatewayTools],
    excludedTools: ["builtin:*", "mcp:*"],
    onPermissionRequest: createGatewayPermissionHandler(manifest.runtime.gatewayTools),
    managedSettings: {
      permissions: {
        disableBypassPermissionsMode: DisableBypassPermissionsModes.Disable,
      },
    },
    enableManagedSettings: true,
    enableConfigDiscovery: false,
    enableExperimentalMode: false,
    enableSessionStore: false,
    enableSessionTelemetry: false,
    sessionLimits: { maxAiCredits: manifest.runtime.maxAiCredits },
    largeOutput: {
      enabled: true,
      maxSizeBytes: 1024 * 1024,
      outputDirectory: manifest.runtime.brokerScratchDirectory,
    },
    enableSkills: false,
    skipEmbeddingRetrieval: true,
    embeddingCacheStorage: "in-memory",
    skipCustomInstructions: true,
    customAgentsLocalOnly: true,
    coauthorEnabled: false,
    manageScheduleEnabled: false,
    requestExtensions: false,
    requestCanvasRenderer: false,
    includedBuiltinSkills: [],
    skillDirectories: [],
    pluginDirectories: [],
    instructionDirectories: [],
    mcpServers: {},
    remoteSession: "off",
    enableHostGitOperations: false,
    enableFileHooks: false,
    enableOnDemandInstructionDiscovery: false,
    infiniteSessions: { enabled: false },
  };
  return { client, session };
}