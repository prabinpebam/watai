import { AppError } from '../domain/errors';
import { validateReplayCursor } from '../domain/syncCursor';
import type { CreateThreadInput, UpdateThreadInput } from '../domain/thread';
import type { ListOptions, ThreadRecord, ThreadStore, ThreadLockStore, ThreadCreateStore } from '../ports/threadStore';

export interface ServiceClock {
  now: () => string;
  newId: () => string;
}

/**
 * Application service for threads. Enforces ownership (identity comes from the caller's
 * token, never the body) and the temporary-threads-are-local-only invariant.
 */
export class ThreadService {
  constructor(
    private readonly store: ThreadStore & ThreadLockStore & ThreadCreateStore,
    private readonly clock: ServiceClock,
  ) {}

  async create(userId: string, input: CreateThreadInput): Promise<ThreadRecord> {
    if (input.temporary) {
      throw new AppError('validation', 'Temporary threads are local-only and are not synced.');
    }
    if (input.id) {
      const existing = await this.store.get(userId, input.id);
      if (existing) return existing; // idempotent create — client-supplied ids make sync retries safe
    }
    const ts = this.clock.now();
    const record: ThreadRecord = {
      id: input.id ?? this.clock.newId(),
      userId,
      title: input.title,
      pinned: false,
      archived: false,
      temporary: false,
      messageCount: 0,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    const created = await this.store.createIfAbsent(record);
    if (created) return created;
    const winner = await this.store.get(userId, record.id);
    if (!winner) throw new AppError('conflict', 'Thread changed during creation. Retry from the current state.');
    return winner;
  }

  async get(userId: string, id: string): Promise<ThreadRecord> {
    const record = await this.store.get(userId, id);
    if (!record || record.deletedAt) {
      throw new AppError('not_found', 'Thread not found.');
    }
    return record;
  }

  async list(userId: string, opts?: ListOptions): Promise<ThreadRecord[]> {
    return this.store.list(userId, opts);
  }

  /**
   * Delta pull for the sync engine: every change (including archived rows and
  * soft-deleted tombstones) at or after the cursor. Replaying the boundary is
  * intentional: clients de-duplicate by id, while a delayed equal-time write is never lost.
   */
  async listChanges(userId: string, since?: string): Promise<ThreadRecord[]> {
    return this.store.list(userId, {
      includeArchived: true,
      includeDeleted: true,
      since: validateReplayCursor(since),
    });
  }

  async update(userId: string, id: string, patch: UpdateThreadInput): Promise<ThreadRecord> {
    return this.mutate(userId, id, current => ({
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
      updatedAt: this.clock.now(),
    }));
  }

  async softDelete(userId: string, id: string): Promise<void> {
    await this.mutate(userId, id, current => {
      const ts = this.clock.now();
      return { ...current, deletedAt: ts, updatedAt: ts };
    });
  }

  private async mutate(userId: string, id: string, change: (current: ThreadRecord) => ThreadRecord): Promise<ThreadRecord> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.store.getForUpdate(userId, id);
      if (!current || current.record.deletedAt) throw new AppError('not_found', 'Thread not found.');
      if (!current.etag) throw new AppError('conflict', 'Thread version unavailable. Reload before retrying.');
      const saved = await this.store.putIfMatch(change(current.record), current.etag);
      if (saved) return saved;
    }
    throw new AppError('conflict', 'Thread changed repeatedly. Reload before retrying.');
  }
}
