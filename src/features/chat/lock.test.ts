import { describe, it, expect, beforeEach } from 'vitest';
import { isLockStale, lockHeldByOther, LOCK_TTL_MS } from './lock';
import { getDeviceId } from '../../lib/device';
import type { ThreadLock } from '../../lib/types';

const lock = (over: Partial<ThreadLock> = {}): ThreadLock => ({
  deviceId: 'other-device',
  deviceLabel: 'Safari on iPhone',
  acquiredAt: new Date().toISOString(),
  heartbeatAt: new Date().toISOString(),
  ...over,
});

describe('isLockStale', () => {
  it('is fresh within the TTL', () => {
    expect(isLockStale(lock({ heartbeatAt: new Date().toISOString() }), Date.now())).toBe(false);
  });
  it('is stale past the TTL', () => {
    const old = new Date(Date.now() - LOCK_TTL_MS - 1000).toISOString();
    expect(isLockStale(lock({ heartbeatAt: old }), Date.now())).toBe(true);
  });
});

describe('lockHeldByOther', () => {
  beforeEach(() => localStorage.clear());

  it('returns the lock when another device holds it live', () => {
    expect(lockHeldByOther(lock({ deviceLabel: 'Edge on macOS' }))?.deviceLabel).toBe('Edge on macOS');
  });

  it('returns null for my own lock', () => {
    expect(lockHeldByOther(lock({ deviceId: getDeviceId() }))).toBeNull();
  });

  it('returns null for a stale (abandoned) foreign lock', () => {
    const old = new Date(Date.now() - LOCK_TTL_MS - 1000).toISOString();
    expect(lockHeldByOther(lock({ heartbeatAt: old }))).toBeNull();
  });

  it('returns null when the thread is free', () => {
    expect(lockHeldByOther(null)).toBeNull();
    expect(lockHeldByOther(undefined)).toBeNull();
  });
});
