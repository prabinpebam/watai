import { AppError } from '../domain/errors';
import type { CreateThreadInput, UpdateThreadInput } from '../domain/thread';
import type { ListOptions, ThreadRecord, ThreadStore } from '../ports/threadStore';

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
    private readonly store: ThreadStore,
    private readonly clock: ServiceClock,
  ) {}

  async create(userId: string, input: CreateThreadInput): Promise<ThreadRecord> {
    if (input.temporary) {
      throw new AppError('validation', 'Temporary threads are local-only and are not synced.');
    }
    const ts = this.clock.now();
    const record: ThreadRecord = {
      id: this.clock.newId(),
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
    return this.store.put(record);
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
   * soft-deleted tombstones) with `updatedAt` strictly after the cursor. Clients
   * apply these last-write-wins and drop tombstoned threads locally.
   */
  async listChanges(userId: string, since?: string): Promise<ThreadRecord[]> {
    return this.store.list(userId, { includeArchived: true, includeDeleted: true, since });
  }

  async update(userId: string, id: string, patch: UpdateThreadInput): Promise<ThreadRecord> {
    const current = await this.get(userId, id);
    const next: ThreadRecord = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
      updatedAt: this.clock.now(),
    };
    return this.store.put(next);
  }

  async softDelete(userId: string, id: string): Promise<void> {
    const current = await this.get(userId, id);
    const ts = this.clock.now();
    await this.store.put({ ...current, deletedAt: ts, updatedAt: ts });
  }
}
