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
  releaseId?: string;
  executionToken?: string;
  dispatchAttempt?: number;
}

export interface RunDispatchRecord {
  runId: string;
  threadId: string;
  userId: string;
  releaseId: string;
  executionToken: string;
  attempt: number;
  state: 'pending' | 'sent';
  createdAt: string;
  updatedAt: string;
}

export interface RunAdmissionRequest {
  run: RunRecord;
  idempotencyKey: string;
  requestFingerprint: string;
  legacyMessageExists: boolean;
}

export type RunAdmissionResult =
  | { outcome: 'accepted'; run: RunRecord }
  | { outcome: 'replay'; run: RunRecord }
  | { outcome: 'payload_mismatch' }
  | { outcome: 'legacy_conflict' }
  | { outcome: 'active_conflict' };

export type RunTransitionResult =
  | { outcome: 'updated'; run: RunRecord }
  | { outcome: 'unchanged'; run: RunRecord }
  | { outcome: 'missing' };

export interface RunStore {
  get(userId: string, threadId: string, runId: string): Promise<RunRecord | null>;
  admit(request: RunAdmissionRequest): Promise<RunAdmissionResult>;
  acknowledgeStart(userId: string, threadId: string, runId: string, instanceId: string): Promise<RunRecord | null>;
  transition(
    userId: string,
    threadId: string,
    runId: string,
    expectedStatuses: RunStatus[],
    patch: Partial<Omit<RunRecord, 'id' | 'userId' | 'threadId'>>,
  ): Promise<RunTransitionResult>;
  listPendingDispatch(limit?: number): Promise<RunDispatchRecord[]>;
  listStaleActive(before: string, limit?: number): Promise<RunRecord[]>;
  markDispatchSent(record: RunDispatchRecord, sentAt: string): Promise<void>;
  put(record: RunRecord): Promise<RunRecord>;
  /** Active (queued|running) runs for a thread — enforces one run per thread. */
  listActive(userId: string, threadId: string): Promise<RunRecord[]>;
  deleteByThread(userId: string, threadId: string): Promise<void>;
}
