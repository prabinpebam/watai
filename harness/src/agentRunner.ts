import { CopilotClient, type AssistantMessageEvent, type SessionConfig } from "@github/copilot-sdk";

import type { LockedTaskSpec } from "./taskSpec.js";
import {
  buildCopilotConfiguration,
  type GatewayTransport,
  type SessionCredentialBroker,
  type WorkerLaunchManifest,
} from "./worker.js";

export interface AgentSessionPort {
  sessionId: string;
  sendAndWait(options: { prompt: string }, timeout?: number): Promise<AssistantMessageEvent | undefined>;
  rpc: {
    ui: {
      handlePendingSessionLimitsExhausted(input: {
        requestId: string;
        response: { action: "cancel" };
      }): Promise<unknown>;
    };
    usage: {
      getMetrics(): Promise<{
        totalPremiumRequestCost: number;
        totalUserRequests: number;
        totalApiDurationMs: number;
        totalNanoAiu?: number;
        currentModel?: string;
        modelMetrics: Record<string, {
          requests: { count: number; cost: number };
          usage: { inputTokens: number; outputTokens: number };
        } | undefined>;
      }>;
    };
  };
  on(
    eventType: "session_limits_exhausted.requested",
    handler: (event: { data: { requestId: string } }) => void,
  ): () => void;
  on(
    eventType: "assistant.usage",
    handler: (event: {
      data: {
        inputTokens?: number;
        outputTokens?: number;
        copilotUsage?: { totalNanoAiu: number };
      };
    }) => void,
  ): () => void;
  disconnect(): Promise<void>;
}

export interface AgentClientPort {
  start(): Promise<void>;
  createSession(config: SessionConfig): Promise<AgentSessionPort>;
  resumeSession(sessionId: string, config: SessionConfig & {
    continuePendingWork?: boolean;
    suppressResumeEvent?: boolean;
  }): Promise<AgentSessionPort>;
  stop(): Promise<Error[]>;
  forceStop(): Promise<void>;
}

export interface AgentAttemptInput {
  task: LockedTaskSpec;
  manifest: WorkerLaunchManifest;
  credentialBroker: SessionCredentialBroker;
  gatewayTransport: GatewayTransport;
  resumeSessionId?: string;
  onSessionStarted?(sessionId: string): Promise<void>;
  renewLease?(): Promise<void>;
  heartbeatIntervalMs?: number;
  forceStopOnCleanup?: boolean;
  now(): number;
  createClient?: (options: ConstructorParameters<typeof CopilotClient>[0]) => AgentClientPort;
}

export interface AgentAttemptResult {
  status: "completed" | "no-assistant-message";
  sessionId: string;
  assistantContent: string | null;
  submission: NonNullable<Awaited<ReturnType<GatewayTransport["getSubmission"]>>>;
  usage: {
    inputTokens: number;
    outputTokens: number;
    requests: number;
    premiumRequestCost: number;
    aiCredits: number;
    apiDurationMs: number;
    currentModel: string | null;
    modelIds: string[];
  };
  cleanupErrors: string[];
}

export class AgentRunnerError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly observedUsage?: {
      inputTokens: number;
      outputTokens: number;
      requests: number;
      aiCredits: number;
    },
  ) {
    super(message);
    this.name = "AgentRunnerError";
  }
}

function buildPrompt(task: LockedTaskSpec): string {
  return [
    `Run: ${task.runId}`,
    `Slice: ${task.sliceId} - ${task.title}`,
    `Source: ${task.source.sourceSha}`,
    `TaskSpec: ${task.taskSpecSha256}`,
    `Visible outcome: ${task.visibleOutcome}`,
    `Allowed paths: ${task.allowedPaths.join(", ")}`,
    `Acceptance: ${task.requiredAcceptance.map((item) => `${item.id}: ${item.check}`).join(" | ")}`,
    `Non-goals: ${task.nonGoals.join(" | ")}`,
    "Use only the provided Watai gateway tools. Read the current diff immediately before every patch and pass its diffSha256 as expectedDiffSha256. Submit a result only after fixed validation commands have run.",
    "Run each fixed validation command at most once after the final diff. When a validation returns passed=true, do not repeat it. If every fixed validation has passed, call watai_submit_result immediately; do not call any other tool first.",
  ].join("\n");
}

export async function runAgentAttempt(input: AgentAttemptInput): Promise<AgentAttemptResult> {
  if (
    input.manifest.status !== "LAUNCH_READY" ||
    input.manifest.taskSpecSha256 !== input.task.taskSpecSha256 ||
    input.manifest.sourceSha !== input.task.source.sourceSha ||
    input.manifest.policySha256 !== input.task.bindings.policySha256 ||
    input.manifest.fencingEpoch !== input.task.fencingEpoch
  ) {
    throw new AgentRunnerError("MANIFEST_BINDING_MISMATCH", "Worker manifest does not match the locked TaskSpec.");
  }
  const now = input.now();
  const deadline = Date.parse(input.manifest.deadline);
  if (!Number.isFinite(now) || !Number.isFinite(deadline) || deadline <= now) {
    throw new AgentRunnerError("ATTEMPT_DEADLINE_EXPIRED", "Agent attempt deadline is invalid or expired.");
  }
  const timeoutMs = Math.min(
    deadline - now,
    input.task.budgets.maxAttemptMinutes * 60_000,
  );
  if (timeoutMs < 1) throw new AgentRunnerError("ATTEMPT_DEADLINE_EXPIRED", "No attempt budget remains.");
  if (Date.parse(input.task.lock.expiresAt) <= now) {
    throw new AgentRunnerError("TASK_LOCK_EXPIRED", "TaskSpec lock expired before agent dispatch.");
  }
  const prompt = buildPrompt(input.task);
  if (Buffer.byteLength(prompt, "utf8") > 32 * 1024) {
    throw new AgentRunnerError("TASK_PROMPT_TOO_LARGE", "Task prompt exceeds the 32 KiB control-plane limit.");
  }

  const credential = await Promise.resolve(input.credentialBroker.gitHubTokenProvider({
    host: "https://github.com",
    sessionId: input.task.runId,
    reason: "initial",
  })).catch(() => ({ kind: "cancelled" as const }));
  if (
    credential.kind !== "token" ||
    !credential.accessToken ||
    /\s/.test(credential.accessToken) ||
    !Number.isFinite(credential.expiresIn) ||
    credential.expiresIn * 1_000 <= timeoutMs + 60_000
  ) {
    throw new AgentRunnerError(
      "AGENT_CREDENTIAL_UNAVAILABLE",
      "Credential broker did not supply a valid token for the complete bounded attempt.",
    );
  }
  const configuration = buildCopilotConfiguration(
    input.manifest,
    credential.accessToken,
    input.gatewayTransport,
  );
  const createClient = input.createClient ?? ((options) => new CopilotClient(options) as AgentClientPort);
  const client = createClient(configuration.client);
  let session: AgentSessionPort | undefined;
  let unsubscribeLimit: (() => void) | undefined;
  let unsubscribeUsage: (() => void) | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let attemptTimer: ReturnType<typeof setTimeout> | undefined;
  let attemptTimedOut = false;
  let heartbeatActive = false;
  let heartbeatPromise: Promise<void> | undefined;
  let heartbeatError: unknown;
  let limitExhausted = false;
  let observedInputTokens = 0;
  let observedOutputTokens = 0;
  let observedRequests = 0;
  let observedAiCredits = 0;
  let usageBudgetExceeded: AgentRunnerError | undefined;
  let primaryError: unknown;
  try {
    await client.start();
    session = input.resumeSessionId
      ? await client.resumeSession(input.resumeSessionId, {
          ...configuration.session,
          continuePendingWork: false,
          suppressResumeEvent: false,
        })
      : await client.createSession(configuration.session);
    await input.onSessionStarted?.(session.sessionId);
    unsubscribeLimit = session.on("session_limits_exhausted.requested", (event) => {
      limitExhausted = true;
      void session!.rpc.ui.handlePendingSessionLimitsExhausted({
        requestId: event.data.requestId,
        response: { action: "cancel" },
      }).catch(() => undefined);
    });
    unsubscribeUsage = session.on("assistant.usage", (event) => {
      observedInputTokens += event.data.inputTokens ?? 0;
      observedOutputTokens += event.data.outputTokens ?? 0;
      observedRequests += 1;
      observedAiCredits += (event.data.copilotUsage?.totalNanoAiu ?? 0) / 1_000_000_000;
      const observedUsage = () => ({
        inputTokens: observedInputTokens,
        outputTokens: observedOutputTokens,
        requests: observedRequests,
        aiCredits: observedAiCredits,
      });
      const exceeded = observedInputTokens > input.task.budgets.maxInputTokens
        ? new AgentRunnerError("AGENT_INPUT_TOKEN_BUDGET_EXCEEDED", "Copilot input tokens crossed the TaskSpec ceiling.", observedUsage())
        : observedOutputTokens > input.task.budgets.maxOutputTokens
          ? new AgentRunnerError("AGENT_OUTPUT_TOKEN_BUDGET_EXCEEDED", "Copilot output tokens crossed the TaskSpec ceiling.", observedUsage())
          : observedRequests > input.task.budgets.maxRequests
            ? new AgentRunnerError("AGENT_REQUEST_BUDGET_EXCEEDED", "Copilot requests crossed the TaskSpec ceiling.", observedUsage())
            : observedAiCredits > input.task.budgets.maxAiCredits
              ? new AgentRunnerError("AGENT_AI_CREDIT_BUDGET_EXCEEDED", "Copilot AI credits crossed the TaskSpec ceiling.", observedUsage())
              : undefined;
      if (exceeded) {
        usageBudgetExceeded = exceeded;
        void client.forceStop().catch(() => undefined);
      }
    });
    if (input.renewLease) {
      const intervalMs = input.heartbeatIntervalMs ?? 20_000;
      if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
        throw new AgentRunnerError("HEARTBEAT_INTERVAL_INVALID", "Lease heartbeat interval must be at least one second.");
      }
      heartbeatTimer = setInterval(() => {
        if (heartbeatActive || heartbeatError) return;
        heartbeatActive = true;
        heartbeatPromise = input.renewLease!().catch((error) => {
          heartbeatError = error;
          void client.forceStop().catch(() => undefined);
        }).finally(() => {
          heartbeatActive = false;
        });
      }, intervalMs);
    }
    attemptTimer = setTimeout(() => {
      attemptTimedOut = true;
      void client.forceStop().catch(() => undefined);
    }, timeoutMs);
    const message = await bounded(
      session.sendAndWait({ prompt }, timeoutMs),
      timeoutMs + 5_000,
      "Copilot attempt did not stop after its deadline.",
    );
    await heartbeatPromise;
    if (attemptTimedOut) throw new AgentRunnerError("ATTEMPT_DEADLINE_EXPIRED", "Copilot attempt exceeded its hard deadline.");
    if (heartbeatError) throw new AgentRunnerError("EFFECT_LEASE_LOST", "Effect lease renewal failed during agent execution.");
    if (limitExhausted) throw new AgentRunnerError("AGENT_AI_CREDIT_LIMIT_EXHAUSTED", "Copilot stopped at the configured AI-credit ceiling.");
    if (usageBudgetExceeded) throw usageBudgetExceeded;
    const metrics = await session.rpc.usage.getMetrics().catch((error) => {
      throw new AgentRunnerError(
        "AGENT_USAGE_UNAVAILABLE",
        error instanceof Error ? error.message : "Copilot session usage is unavailable.",
      );
    });
    const modelMetrics = Object.entries(metrics.modelMetrics)
      .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => Boolean(entry[1]));
    const inputTokens = modelMetrics.reduce((sum, [, metric]) => sum + metric.usage.inputTokens, 0);
    const outputTokens = modelMetrics.reduce((sum, [, metric]) => sum + metric.usage.outputTokens, 0);
    const requests = modelMetrics.reduce((sum, [, metric]) => sum + metric.requests.count, 0);
    const aiCredits = metrics.totalNanoAiu === undefined
      ? metrics.totalPremiumRequestCost
      : metrics.totalNanoAiu / 1_000_000_000;
    if (inputTokens > input.task.budgets.maxInputTokens) {
      throw new AgentRunnerError("AGENT_INPUT_TOKEN_BUDGET_EXCEEDED", "Observed Copilot input tokens exceeded the TaskSpec ceiling.");
    }
    if (outputTokens > input.task.budgets.maxOutputTokens) {
      throw new AgentRunnerError("AGENT_OUTPUT_TOKEN_BUDGET_EXCEEDED", "Observed Copilot output tokens exceeded the TaskSpec ceiling.");
    }
    if (requests > input.task.budgets.maxRequests) {
      throw new AgentRunnerError("AGENT_REQUEST_BUDGET_EXCEEDED", "Observed Copilot requests exceeded the TaskSpec ceiling.");
    }
    if (aiCredits > input.task.budgets.maxAiCredits) {
      throw new AgentRunnerError("AGENT_AI_CREDIT_BUDGET_EXCEEDED", "Observed Copilot AI credits exceeded the TaskSpec ceiling.");
    }
    const submission = await input.gatewayTransport.getSubmission(input.task.runId);
    if (!submission || submission.runId !== input.task.runId) {
      throw new AgentRunnerError("AGENT_SUBMISSION_MISSING", "Agent finished without an accepted durable gateway submission.");
    }
    return {
      status: message ? "completed" : "no-assistant-message",
      sessionId: session.sessionId,
      assistantContent: message?.data.content ?? null,
      submission,
      usage: {
        inputTokens,
        outputTokens,
        requests,
        premiumRequestCost: metrics.totalPremiumRequestCost,
        aiCredits,
        apiDurationMs: metrics.totalApiDurationMs,
        currentModel: metrics.currentModel ?? null,
        modelIds: modelMetrics.map(([modelId]) => modelId).sort(),
      },
      cleanupErrors: [],
    };
  } catch (error) {
    primaryError = usageBudgetExceeded ?? error;
    throw primaryError;
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (attemptTimer) clearTimeout(attemptTimer);
    unsubscribeLimit?.();
    unsubscribeUsage?.();
    const cleanupErrors: Error[] = [];
    if (input.forceStopOnCleanup) {
      try {
        await bounded(client.forceStop(), 5_000, "Copilot client force-stop timed out.");
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
      }
    } else {
      try {
        cleanupErrors.push(...await bounded(client.stop(), 5_000, "Copilot client stop timed out."));
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
        await client.forceStop().catch(() => undefined);
      }
    }
    if (!primaryError && cleanupErrors.length > 0) {
      throw new AgentRunnerError(
        "AGENT_CLEANUP_FAILED",
        cleanupErrors.map((error) => error.message).join("; "),
      );
    }
  }
}

async function bounded<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}