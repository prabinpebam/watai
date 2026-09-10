import type { RunAdmissionRequest, RunAdmissionResult, RunRecord, RunStore, RunTransitionResult } from '../../ports/runStore';
import type { RunStatus } from '../../domain/run';
import { isActive } from '../../domain/run';

/** In-memory RunStore for unit tests and local dev (keyed by owner + threadId + runId). */
export class InMemoryRunStore implements RunStore {
  private byKey = new Map<string, RunRecord>();
  private activeSlots = new Map<string, string>();
  private admissions = new Map<string, { requestFingerprint: string; runId: string }>();

  private key(userId: string, threadId: string, runId: string): string {
    return `${userId}\u0000${threadId}\u0000${runId}`;
  }

  private threadKey(userId: string, threadId: string): string {
    return `${userId}\u0000${threadId}`;
  }

  async get(userId: string, threadId: string, runId: string): Promise<RunRecord | null> {
    return this.byKey.get(this.key(userId, threadId, runId)) ?? null;
  }

  async admit(request: RunAdmissionRequest): Promise<RunAdmissionResult> {
    const { run, idempotencyKey, requestFingerprint } = request;
    const admissionKey = this.key(run.userId, run.threadId, idempotencyKey);
    const previous = this.admissions.get(admissionKey);
    if (previous) {
      if (previous.requestFingerprint !== requestFingerprint) return { outcome: 'payload_mismatch' };
      const existing = await this.get(run.userId, run.threadId, previous.runId);
      return existing ? { outcome: 'replay', run: existing } : { outcome: 'active_conflict' };
    }
    if (request.legacyMessageExists) return { outcome: 'legacy_conflict' };
    const threadKey = this.threadKey(run.userId, run.threadId);
    if (this.activeSlots.has(threadKey)) return { outcome: 'active_conflict' };
    this.byKey.set(this.key(run.userId, run.threadId, run.id), { ...run });
    this.admissions.set(admissionKey, { requestFingerprint, runId: run.id });
    this.activeSlots.set(threadKey, run.id);
    return { outcome: 'accepted', run };
  }

  async acknowledgeStart(userId: string, threadId: string, runId: string, instanceId: string): Promise<RunRecord | null> {
    const key = this.key(userId, threadId, runId);
    const current = this.byKey.get(key);
    if (!current || current.status !== 'queued') return current ?? null;
    const updated = { ...current, instanceId };
    this.byKey.set(key, updated);
    return updated;
  }

  async transition(
    userId: string,
    threadId: string,
    runId: string,
    expectedStatuses: RunStatus[],
    patch: Partial<Omit<RunRecord, 'id' | 'userId' | 'threadId'>>,
  ): Promise<RunTransitionResult> {
    const key = this.key(userId, threadId, runId);
    const current = this.byKey.get(key);
    if (!current) return { outcome: 'missing' };
    if (!expectedStatuses.includes(current.status)) return { outcome: 'unchanged', run: current };
    const updated = { ...current, ...patch };
    this.byKey.set(key, updated);
    const threadKey = this.threadKey(userId, threadId);
    if (isActive(updated.status)) this.activeSlots.set(threadKey, runId);
    else if (this.activeSlots.get(threadKey) === runId) this.activeSlots.delete(threadKey);
    return { outcome: 'updated', run: updated };
  }

  async put(record: RunRecord): Promise<RunRecord> {
    this.byKey.set(this.key(record.userId, record.threadId, record.id), { ...record });
    const threadKey = this.threadKey(record.userId, record.threadId);
    if (isActive(record.status)) this.activeSlots.set(threadKey, record.id);
    else if (this.activeSlots.get(threadKey) === record.id) this.activeSlots.delete(threadKey);
    return record;
  }

  async listActive(userId: string, threadId: string): Promise<RunRecord[]> {
    return [...this.byKey.values()].filter((r) => r.userId === userId && r.threadId === threadId && isActive(r.status));
  }

  async deleteByThread(userId: string, threadId: string): Promise<void> {
    for (const [key, run] of [...this.byKey.entries()]) {
      if (run.userId === userId && run.threadId === threadId) this.byKey.delete(key);
    }
    this.activeSlots.delete(this.threadKey(userId, threadId));
    for (const key of [...this.admissions.keys()]) {
      if (key.startsWith(`${userId}\u0000${threadId}\u0000`)) this.admissions.delete(key);
    }
  }
}
