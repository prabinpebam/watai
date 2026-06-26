import { AppError } from '../domain/errors';
import { canAcquire, type LockRequestInput, type ThreadLock } from '../domain/threadLock';
import type { ThreadLockStore, ThreadRecord } from '../ports/threadStore';
import type { ServiceClock } from './threadService';

const MAX_CAS_ATTEMPTS = 5;

/**
 * Coordinates the per-thread run lock. Acquiring is a compare-and-set against the thread
 * record: read it (with its concurrency token), decide whether the caller may take the lock,
 * then write conditionally. If another writer won the race the write is retried against the
 * fresh record — so two devices can never both believe they hold the lock. The lock rides on
 * the thread record, so releasing/refreshing it propagates to other devices via the normal
 * thread delta pull. Ownership is enforced via the thread (a caller can only lock a thread it
 * owns), mirroring the rest of the API.
 */
export class ThreadLockService {
  constructor(
    private readonly store: ThreadLockStore,
    private readonly clock: ServiceClock,
  ) {}

  /** Take or renew the lock. Throws `conflict` (with the current holder in `details.lock`) when
   *  another, still-live device holds it. */
  async acquire(
    userId: string,
    threadId: string,
    input: LockRequestInput,
  ): Promise<{ thread: ThreadRecord; lock: ThreadLock }> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const found = await this.store.getForUpdate(userId, threadId);
      if (!found || found.record.deletedAt) throw new AppError('not_found', 'Thread not found.');

      const current = found.record.lock ?? null;
      if (!canAcquire(current, input.deviceId, Date.now())) {
        throw new AppError('conflict', 'Another device is generating a response in this thread.', {
          lock: current,
        });
      }

      const nowIso = this.clock.now();
      const renewing = current?.deviceId === input.deviceId;
      const lock: ThreadLock = {
        deviceId: input.deviceId,
        deviceLabel: input.deviceLabel,
        acquiredAt: renewing && current ? current.acquiredAt : nowIso,
        heartbeatAt: nowIso,
      };
      const saved = await this.store.putIfMatch(
        { ...found.record, lock, updatedAt: nowIso },
        found.etag,
      );
      if (saved) return { thread: saved, lock };
      // Lost the compare-and-set race — re-read and re-evaluate.
    }
    throw new AppError('conflict', 'Could not acquire the thread lock. Please try again.');
  }

  /** Release the lock if the caller holds it. Idempotent: releasing a free thread, or one held
   *  by another device, is a no-op (the holder's own heartbeat/release stays authoritative). */
  async release(userId: string, threadId: string, deviceId: string): Promise<ThreadRecord> {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const found = await this.store.getForUpdate(userId, threadId);
      if (!found || found.record.deletedAt) throw new AppError('not_found', 'Thread not found.');

      const current = found.record.lock ?? null;
      if (!current || current.deviceId !== deviceId) return found.record; // not ours to release

      const saved = await this.store.putIfMatch(
        { ...found.record, lock: null, updatedAt: this.clock.now() },
        found.etag,
      );
      if (saved) return saved;
      // Lost the race — re-read and retry.
    }
    throw new AppError('conflict', 'Could not release the thread lock. Please try again.');
  }
}
