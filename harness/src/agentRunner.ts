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
  now(): number;
  createClient?: (options: ConstructorParameters<typeof CopilotClient>[0]) => AgentClientPort;
}

export interface AgentAttemptResult {
  status: "completed" | "no-assistant-message";
  sessionId: string;
  assistantContent: string | null;
  cleanupErrors: string[];
}

export class AgentRunnerError extends Error {
  constructor(readonly code: string, message: string) {
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
    "Use only the provided Watai gateway tools. Submit a result only after fixed validation commands have run.",
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
  const prompt = buildPrompt(input.task);
  if (Buffer.byteLength(prompt, "utf8") > 32 * 1024) {
    throw new AgentRunnerError("TASK_PROMPT_TOO_LARGE", "Task prompt exceeds the 32 KiB control-plane limit.");
  }

  const configuration = buildCopilotConfiguration(
    input.manifest,
    input.credentialBroker,
    input.gatewayTransport,
  );
  const createClient = input.createClient ?? ((options) => new CopilotClient(options) as AgentClientPort);
  const client = createClient(configuration.client);
  let session: AgentSessionPort | undefined;
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
    const message = await session.sendAndWait({ prompt }, timeoutMs);
    return {
      status: message ? "completed" : "no-assistant-message",
      sessionId: session.sessionId,
      assistantContent: message?.data.content ?? null,
      cleanupErrors: [],
    };
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    const cleanupErrors: Error[] = [];
    if (session) {
      try {
        await session.disconnect();
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    try {
      cleanupErrors.push(...await client.stop());
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
      await client.forceStop().catch(() => undefined);
    }
    if (!primaryError && cleanupErrors.length > 0) {
      throw new AgentRunnerError(
        "AGENT_CLEANUP_FAILED",
        cleanupErrors.map((error) => error.message).join("; "),
      );
    }
  }
}