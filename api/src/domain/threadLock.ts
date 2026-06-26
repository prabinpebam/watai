import { z } from 'zod';
import { parseOrThrow } from './validate';

/**
 * A per-thread run lock. While one device is generating an assistant reply for a thread it
 * holds the lock, so no other device starts a second, concurrent generation in the same thread.
 * The lock rides on the thread record (so it syncs to other devices via the normal delta pull),
 * and is refreshed by a periodic heartbeat while the run is active. A lock whose heartbeat has
 * not been renewed within `LOCK_TTL_MS` is considered stale (the holder crashed / closed the tab)
 * and may be taken over by another device — so a thread can never be locked forever.
 */
export interface ThreadLock {
  /** Stable per-device id of the holder (never the user id — one user has many devices). */
  deviceId: string;
  /** Human-friendly holder label for the "locked" UX, e.g. "Chrome on Windows". */
  deviceLabel: string;
  /** When the holder first took the lock (preserved across heartbeats). */
  acquiredAt: string;
  /** Last heartbeat; staleness is measured from here. */
  heartbeatAt: string;
}

/** A lock older than this (no heartbeat) is stale and may be stolen by another device. */
export const LOCK_TTL_MS = 120_000;

/** Has the lock's heartbeat gone stale relative to `now` (ms epoch)? */
export function isLockStale(lock: ThreadLock, now: number): boolean {
  return now - Date.parse(lock.heartbeatAt) > LOCK_TTL_MS;
}

/** May `deviceId` take or keep the lock given the current state and time? */
export function canAcquire(lock: ThreadLock | null | undefined, deviceId: string, now: number): boolean {
  if (!lock) return true; // free
  if (lock.deviceId === deviceId) return true; // already mine — renew
  return isLockStale(lock, now); // someone else's, but abandoned
}

const lockSchema = z
  .object({
    deviceId: z.string().min(1).max(64),
    deviceLabel: z.string().min(1).max(80),
  })
  .strict();

export type LockRequestInput = z.infer<typeof lockSchema>;

export function parseLockRequest(input: unknown): LockRequestInput {
  return parseOrThrow(lockSchema, input);
}
