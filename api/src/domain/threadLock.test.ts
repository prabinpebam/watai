import { describe, it, expect } from 'vitest';
import { canAcquire, isLockStale, LOCK_TTL_MS, parseLockRequest, type ThreadLock } from './threadLock';
import { AppError } from './errors';

const at = (ms: number): string => new Date(ms).toISOString();

function lock(over: Partial<ThreadLock> = {}): ThreadLock {
  return {
    deviceId: 'devA',
    deviceLabel: 'Chrome on Windows',
    acquiredAt: at(0),
    heartbeatAt: at(0),
    ...over,
  };
}

describe('isLockStale', () => {
  it('is fresh within the TTL', () => {
    expect(isLockStale(lock({ heartbeatAt: at(0) }), LOCK_TTL_MS - 1)).toBe(false);
  });
  it('is stale once the heartbeat is older than the TTL', () => {
    expect(isLockStale(lock({ heartbeatAt: at(0) }), LOCK_TTL_MS + 1)).toBe(true);
  });
});

describe('canAcquire', () => {
  it('allows acquiring a free thread', () => {
    expect(canAcquire(null, 'devA', 1000)).toBe(true);
    expect(canAcquire(undefined, 'devA', 1000)).toBe(true);
  });
  it('lets the current holder renew', () => {
    expect(canAcquire(lock({ deviceId: 'devA', heartbeatAt: at(0) }), 'devA', 1000)).toBe(true);
  });
  it('blocks another device while the lock is live', () => {
    expect(canAcquire(lock({ deviceId: 'devA', heartbeatAt: at(0) }), 'devB', 1000)).toBe(false);
  });
  it('lets another device steal a stale lock', () => {
    expect(canAcquire(lock({ deviceId: 'devA', heartbeatAt: at(0) }), 'devB', LOCK_TTL_MS + 1)).toBe(true);
  });
});

describe('parseLockRequest', () => {
  it('accepts a valid device id + label', () => {
    expect(parseLockRequest({ deviceId: 'd1', deviceLabel: 'Edge on macOS' })).toEqual({
      deviceId: 'd1',
      deviceLabel: 'Edge on macOS',
    });
  });
  it('rejects a missing device id', () => {
    expect(() => parseLockRequest({ deviceLabel: 'x' })).toThrow(AppError);
  });
  it('rejects unknown fields (strict)', () => {
    expect(() => parseLockRequest({ deviceId: 'd', deviceLabel: 'x', userId: 'sneaky' })).toThrow(
      AppError,
    );
  });
});
