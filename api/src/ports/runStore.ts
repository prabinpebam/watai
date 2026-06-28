import type { RunStatus, RunError } from '../domain/run';
import type { MessageAttachment } from '../domain/message';

/** Server-side run record (Cosmos `runs`, partition key /threadId). One row per generation. */
export interface RunRecord {
  id: string;
  threadId: string;
  userId: string;
  /** The assistant message this run is producing (stable id; the worker upserts it). */
  assistantMessageId: string;
  status: RunStatus;
  /** Durable orchestration instance id (set once the worker starts). */
  instanceId?: string | null;
  /** Tools enabled for this run. */
  tools: string[];
  /** Chat deployment override for this run. */
  model?: string;
  /** Destructive tools explicitly authorized for this run. */
  allowDestructive: string[];
  /** The user prompt that triggered the run (echoed for the worker). */
  prompt?: { text?: string; attachments?: MessageAttachment[] };
  error?: RunError | null;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  /** Liveness heartbeat for stale-run detection. */
  heartbeatAt: string;
}

export interface RunStore {
  get(threadId: string, runId: string): Promise<RunRecord | null>;
  put(record: RunRecord): Promise<RunRecord>;
  /** Active (queued|running) runs for a thread — enforces one run per thread. */
  listActive(threadId: string): Promise<RunRecord[]>;
}
