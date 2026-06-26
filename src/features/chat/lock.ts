import type { ThreadLock } from '../../lib/types';
import { getDeviceId } from '../../lib/device';

/** A lock older than this (no heartbeat) is treated as abandoned. Mirrors the api `LOCK_TTL_MS`. */
export const LOCK_TTL_MS = 120_000;

/** Has the lock's heartbeat gone stale relative to `now` (ms epoch)? */
export function isLockStale(lock: ThreadLock, now: number): boolean {
  return now - Date.parse(lock.heartbeatAt) > LOCK_TTL_MS;
}

/**
 * The lock if it is held by a *different*, still-live device — i.e. the case where this device's
 * composer should be disabled with a "someone else is responding" explanation. Returns null when
 * the thread is free, the lock is this device's own, or the lock is stale (abandoned).
 */
export function lockHeldByOther(
  lock: ThreadLock | null | undefined,
  now: number = Date.now(),
): ThreadLock | null {
  if (!lock) return null;
  if (lock.deviceId === getDeviceId()) return null;
  if (isLockStale(lock, now)) return null;
  return lock;
}
