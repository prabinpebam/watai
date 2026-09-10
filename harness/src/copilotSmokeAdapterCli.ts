import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAgentAttempt } from "./agentRunner.js";
import { createLocalGhTokenProvider } from "./credentialBroker.js";
import { GatewayService, MemoryGatewayReceiptStore } from "./gatewayService.js";
import type { LockedTaskSpec } from "./taskSpec.js";
import type { WorkerLaunchManifest } from "./worker.js";

interface Request {
  contract: {
    id: string;
    providerId: string;
    requestedModel: string;
    thresholds: { maximumP95LatencyMs: number };
  };
  definition: {
    id: string;
    input: string;
    oracle: { kind: "gateway-contract"; requiredTools: string[]; requireSubmission: boolean; expectedChangedPaths?: string[] };
  };
  repetition: number;
}

let activeRequest: Request | undefined;
let activeStartedAt = Date.now();
let activeReceipts: MemoryGatewayReceiptStore | undefined;
let activeRunId: string | undefined;

async function stdin(): Promise<string> {
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += chunk;
  return value;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function main(): Promise<void> {
  const request = JSON.parse(await stdin()) as Request;
  activeRequest = request;
  activeStartedAt = Date.now();
  if (request.contract.id !== "implementation-agent-smoke" || request.contract.providerId !== "github-copilot") {
    throw new Error("Copilot smoke adapter accepts only implementation-agent-smoke.");
  }
  const imageSha256 = process.env.WATAI_WORKER_IMAGE_SHA256?.trim();
  if (!imageSha256 || !/^[a-f0-9]{64}$/.test(imageSha256)) {
    throw new Error("WATAI_WORKER_IMAGE_SHA256 must be an approved image SHA-256.");
  }
  const root = await mkdtemp(join(tmpdir(), "watai-copilot-smoke-"));
  try {
    await mkdir(join(root, "src"));
    const brokerScratchDirectory = join(root, "broker");
    const brokerHomeDirectory = join(root, "home");
    await Promise.all([
      mkdir(brokerScratchDirectory),
      mkdir(brokerHomeDirectory),
    ]);
    await writeFile(join(root, "src", "value.ts"), "export const value = 1;\n", "utf8");
    git(root, ["init", "-q"]);
    git(root, ["add", "."]);
    git(root, ["-c", "user.name=watai-evaluator", "-c", "user.email=evaluator@invalid", "commit", "-qm", "fixture"]);
    const sourceSha = git(root, ["rev-parse", "HEAD"]);
    const runId = `copilot-smoke-${request.definition.id}-${request.repetition}-${randomUUID()}`;
    activeRunId = runId;
    const requiredTools = [...new Set(request.definition.oracle.requiredTools)];
    const taskSpecSha256 = sha256({ runId, sourceSha, input: request.definition.input });
    const validationCommands = [{
      id: "fixture-validation",
      executable: "node",
      args: ["-e", "const fs=require('node:fs');const v=fs.readFileSync('value.ts','utf8');if(!/value = [12]/.test(v))process.exit(1)"],
      cwd: "src",
      timeoutMs: 30_000,
      maxOutputBytes: 64 * 1024,
    }];
    const task = {
      schemaVersion: "1.0",
      status: "SPEC_LOCKED",
      releaseEligible: false,
      dispatchAuthorized: true,
      mode: "implementation",
      runId,
      sliceId: "E01",
      title: request.definition.id,
      milestone: "M1",
      risk: "high",
      ownerRole: "builder",
      executionDomain: "product",
      mutationClass: "candidate",
      fencingEpoch: 1,
      source: {
        repositoryId: "watai/evaluator-fixture",
        branch: `candidate/E01/${runId}`,
        baseSha: sourceSha,
        sourceSha,
        treeSha256: "a".repeat(64),
        diffSha256: "b".repeat(64),
        clean: true,
      },
      bindings: {
        backlogSha256: "a".repeat(64), policySha256: "b".repeat(64), workflowSha256: "c".repeat(64),
        planSchemaSha256: "d".repeat(64), controllerSha256: "e".repeat(64), evaluatorPackSha256: "f".repeat(64),
        testInventorySha256: "1".repeat(64), fixtureManifestSha256: "2".repeat(64), toolchainSha256: "3".repeat(64),
        dependencyLockSha256: "4".repeat(64), impactMapSha256: "5".repeat(64), negativeControlIds: ["NC-fixture"],
      },
      dependencyClosure: [],
      dependencyReceipts: [],
      allowedPaths: ["src"],
      nonGoals: ["No repository, cloud, deployment or release effects"],
      allowedTools: requiredTools,
      agentRuntime: { providerId: "github-copilot", model: request.contract.requestedModel },
      validationCommands,
      modelNetworkHosts: ["api.githubcopilot.com"],
      toolNetworkHosts: [],
      deniedAuthorities: ["production-network", "release-signing"],
      requiredGates: ["G00", "G08"],
      requiredAcceptanceIds: ["E01-smoke"],
      requiredAcceptance: [{ id: "E01-smoke", gate: "G00", check: request.definition.input }],
      requiredEvidenceKinds: ["model-eval"],
      requiredModelEvaluationIds: ["implementation-agent-smoke"],
      negativeControlIds: ["NC-fixture"],
      visibleOutcome: request.definition.input,
      rolloutProfile: "control-plane",
      rolloutSteps: ["Evaluate fixture only"],
      rollback: "Delete temporary fixture",
      budgets: {
        maxAttempts: 1, maxActiveMinutes: 5, maxAttemptMinutes: 4, maxUsd: 0,
        maxInputTokens: 30_000, maxOutputTokens: 3_000, maxRequests: 5, maxAiCredits: 30,
      },
      preparedAt: new Date().toISOString(),
      deadline: new Date(Date.now() + 4 * 60_000).toISOString(),
      taskSpecSha256,
      lock: {
        lockId: "evaluator-owned-fixture", taskSpecSha256, runId, sliceId: "E01", sourceSha,
        policySha256: "b".repeat(64), issuer: "evaluator", issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(), signature: "evaluator-fixture-only",
      },
    } as LockedTaskSpec;
    const manifest = {
      schemaVersion: "1.0", status: "LAUNCH_READY", releaseEligible: false,
      runId, taskSpecSha256, sourceSha, policySha256: task.bindings.policySha256, fencingEpoch: 1,
      runtime: {
        sdkVersion: "1.0.13", bundledCliVersion: "1.0.83", runtimeImageSha256: imageSha256,
        containerDependencyDirectory: "/opt/watai/node_modules",
        model: request.contract.requestedModel, providerId: "github-copilot", maxAiCredits: 30,
        brokerScratchDirectory, brokerHomeDirectory,
        brokerEnvironment: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
          WINDIR: process.env.WINDIR ?? "C:\\Windows",
          TEMP: brokerScratchDirectory,
          TMP: brokerScratchDirectory,
        },
        credentialReference: "local-gh-token-provider",
        gatewayTools: task.allowedTools, validationCommands, memoryMb: 1024, cpuCount: 1, pidsLimit: 64,
      },
      sandbox: {
        engine: "docker-linux", networkMode: "none", allowedReadRoot: "/workspace/source",
        allowedWriteRoots: ["src"], validationCommandIds: ["fixture-validation"],
        memoryMb: 1024, cpuCount: 1, pidsLimit: 64,
      },
      broker: {
        model: request.contract.requestedModel, providerId: "github-copilot",
        allowedHosts: ["api.githubcopilot.com"], credentialReference: "local-gh-token-provider", workspaceMounted: false,
      },
      deadline: task.deadline,
      manifestSha256: "6".repeat(64),
    } as WorkerLaunchManifest;
    const receipts = new MemoryGatewayReceiptStore();
    activeReceipts = receipts;
    const gateway = await GatewayService.create({ workspaceRoot: root, task, manifest, receiptStore: receipts });
    const startedAt = Date.now();
    const attempt = await runAgentAttempt({
      task,
      manifest,
      credentialBroker: { gitHubTokenProvider: createLocalGhTokenProvider() },
      gatewayTransport: gateway,
      now: Date.now,
      forceStopOnCleanup: true,
    });
    const stored = await receipts.list(runId);
    const toolIds = stored.filter((receipt) => receipt.status === "completed" && receipt.response?.status === "success")
      .map((receipt) => receipt.tool);
    writeSync(1, JSON.stringify({
      status: "completed",
      artifact: {
        kind: "gateway-contract",
        toolIds,
        submitted: true,
        changedPaths: attempt.submission.changedPaths,
      },
      latencyMs: Date.now() - startedAt,
      usage: {
        usd: 0,
        inputTokens: attempt.usage.inputTokens,
        outputTokens: attempt.usage.outputTokens,
        requests: attempt.usage.requests,
        aiCredits: attempt.usage.aiCredits,
      },
      responseSha256: attempt.assistantContent ? sha256(attempt.assistantContent) : null,
      resolvedModelVersion: attempt.usage.currentModel,
      errorCode: null,
      completedAt: new Date().toISOString(),
    }));
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().then(() => {
  process.exit(0);
}).catch(async (error) => {
  if (!activeRequest) {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const oracle = activeRequest.definition.oracle;
  const stored = activeReceipts && activeRunId ? await activeReceipts.list(activeRunId) : [];
  const attemptedToolIds = stored.map((receipt) => receipt.tool);
  const artifact = oracle.kind === "gateway-contract"
    ? { kind: "gateway-contract" as const, toolIds: attemptedToolIds, submitted: false, changedPaths: [] }
    : { kind: "gateway-contract" as const, toolIds: [], submitted: false, changedPaths: [] };
  const candidateCode = (error as { code?: unknown }).code;
  const message = error instanceof Error ? error.message : String(error);
  const errorCode = typeof candidateCode === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(candidateCode)
    ? candidateCode
    : /not authenticated|credential|token/i.test(message)
      ? "COPILOT_AUTHENTICATION_FAILED"
      : /minimum session limit/i.test(message)
        ? "COPILOT_SESSION_LIMIT_INVALID"
        : /model.*(unknown|unavailable|not found|unsupported)/i.test(message)
          ? "COPILOT_MODEL_UNAVAILABLE"
          : typeof candidateCode === "number"
            ? `COPILOT_RPC_${Math.abs(candidateCode)}`
            : "COPILOT_SMOKE_FAILED";
  writeSync(1, JSON.stringify({
    status: "failed",
    artifact,
    latencyMs: Date.now() - activeStartedAt,
    usage: { usd: 0, inputTokens: 0, outputTokens: 0, requests: 0, aiCredits: 0 },
    responseSha256: null,
    resolvedModelVersion: null,
    errorCode,
    completedAt: new Date().toISOString(),
  }));
  process.exit(0);
});
