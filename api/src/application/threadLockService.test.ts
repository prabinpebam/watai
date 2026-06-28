import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ThreadLockService } from './threadLockService';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { LOCK_TTL_MS, type ThreadLock } from '../domain/threadLock';
import type { ThreadLockStore, ThreadRecord } from '../ports/threadStore';
import { AppError } from '../domain/errors';

const clock = { now: () => new Date().toISOString(), newId: () => 'id' };

async function seedThread(store: InMemoryThreadStore, over: Partial<ThreadRecord> = {}): Promise<void> {
  await store.put({
    id: 't1',
    userId: 'userA',
    title: 'T',
    pinned: false,
    archived: false,
    temporary: false,
    messageCount: 0,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    deletedAt: null,
    ...over,
  });
}

async function code(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

describe('ThreadLockService.acquire', () => {
  let store: InMemoryThreadStore;
  let svc: ThreadLockService;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    store = new InMemoryThreadStore();
    svc = new ThreadLockService(store, clock);
  });
  afterEach(() => vi.useRealTimers());

  it('takes a free thread and stamps the holder', async () => {
    await seedThread(store);
    const { lock } = await svc.acquire('userA', 't1', { deviceId: 'devA', deviceLabel: 'Chrome on Windows' });
    expect(lock).toMatchObject({ deviceId: 'devA', deviceLabel: 'Chrome on Windows' });
    expect(lock.acquiredAt).toBe(lock.heartbeatAt);
    const stored = await store.get('userA', 't1');
    expect(stored?.lock?.deviceId).toBe('devA');
    // Acquiring bumps updatedAt so the lock propagates to other devices via delta pull.
    expect(stored!.updatedAt).not.toBe(new Date(0).toISOString());
  });

  it('renews for the same device, preserving acquiredAt and advancing the heartbeat', async () => {
    await seedThread(store);
    const first = await svc.acquire('userA', 't1', { deviceId: 'devA', deviceLabel: 'Chrome' });
    vi.setSystemTime(new Date('2026-06-01T00:00:30Z'));
    const second = await svc.acquire('userA', 't1', { deviceId: 'devA', deviceLabel: 'Chrome' });
    expect(second.lock.acquiredAt).toBe(first.lock.acquiredAt);
    expect(Date.parse(second.lock.heartbeatAt)).toBeGreaterThan(Date.parse(first.lock.heartbeatAt));
  });

  it('rejects another device while the lock is live, naming the holder', async () => {
    await seedThread(store);
    await svc.acquire('userA', 't1', { deviceId: 'devA', deviceLabel: 'Chrome on Windows' });
    let thrown: AppError | undefined;
    try {
      await svc.acquire('userA', 't1', { deviceId: 'devB', deviceLabel: 'Safari on iPhone' });
    } catch (e) {
      thrown = e as AppError;
    }
    expect(thrown?.code).toBe('conflict');
    expect((thrown?.details as { lock: ThreadLock }).lock.deviceLabel).toBe('Chrome on Windows');
  });

  it('lets another device steal a stale (abandoned) lock', async () => {
    await seedThread(store);
    await svc.acquire('userA', 't1', { deviceId: 'devA', deviceLabel: 'Chrome' });
    vi.setSystemTime(new Date(Date.now() + LOCK_TTL_MS + 1000));
    const { lock } = await svc.acquire('userA', 't1', { deviceId: 'devB', deviceLabel: 'Safari' });
    expect(lock.deviceId).toBe('devB');
  });

  it('throws not_found for a missing or deleted thread', async () => {
    expect(await code(() => svc.acquire('userA', 'nope', { deviceId: 'd', deviceLabel: 'x' }))).toBe(
      'not_found',
    );
    await seedThread(store, { deletedAt: new Date().toISOString() });
    expect(await code(() => svc.acquire('userA', 't1', { deviceId: 'd', deviceLabel: 'x' }))).toBe(
      'not_found',
    );
  });

  it('retries the compare-and-set when another writer wins the race', async () => {
    await seedThread(store);
    let failuresLeft = 2;
    const racy: ThreadLockStore = {
      get: (u, id) => store.get(u, id),
      getForUpdate: (u, id) => store.getForUpdate(u, id),
      putIfMatch: (rec, etag) => (failuresLeft-- > 0 ? Promise.resolve(null) : store.putIfMatch(rec, etag)),
    };
    const racySvc = new ThreadLockService(racy, clock);
    const { lock } = await racySvc.acquire('userA', 't1', { deviceId: 'devA', deviceLabel: 'Chrome' });
    expect(lock.deviceId).toBe('devA');
    expect(failuresLeft).toBeLessThan(0); // it retried past the simulated failures
  });

  it('gives up with conflict after exhausting retries', async () => {
    await seedThread(store);
    const alwaysRacy: ThreadLockStore = {
      get: (u, id) => store.get(u, id),
      getForUpdate: (u, id) => store.getForUpdate(u, id),
      putIfMatch: () => Promise.resolve(null),
    };
    const racySvc = new ThreadLockService(alwaysRacy, clock);
    expect(await code(() => racySvc.acquire('userA', 't1', { deviceId: 'd', deviceLabel: 'x' }))).toBe(
      'conflict',
    );
  });
});

describe('ThreadLockService.get', () => {
  let store: InMemoryThreadStore;
  let svc: ThreadLockService;
  beforeEach(() => {
    store = new InMemoryThreadStore();
    svc = new ThreadLockService(store, clock);
  });

  it('returns null instead of throwing for missing or deleted threads', async () => {
    expect(await svc.get('userA', 'missing')).toEqual({ lock: null });
    await seedThread(store, { deletedAt: new Date().toISOString() });
    expect(await svc.get('userA', 't1')).toEqual({ lock: null });
  });

  it('returns the current lock for an existing thread', async () => {
    await seedThread(store);
    const { lock } = await svc.acquire('userA', 't1', { deviceId: 'devA', deviceLabel: 'Chrome' });
    expect(await svc.get('userA', 't1')).toEqual({ lock });
  });
});

describe('ThreadLockService.release', () => {
  let store: InMemoryThreadStore;
  let svc: ThreadLockService;
  beforeEach(() => {
    store = new InMemoryThreadStore();
    svc = new ThreadLockService(store, clock);
  });

  it('clears the lock when the holder releases it', async () => {
    await seedThread(store);
    await svc.acquire('userA', 't1', { deviceId: 'devA', deviceLabel: 'Chrome' });
    const after = await svc.release('userA', 't1', 'devA');
    expect(after.lock ?? null).toBeNull();
    expect((await store.get('userA', 't1'))?.lock ?? null).toBeNull();
  });

  it('is a no-op when a non-holder releases (lock stays)', async () => {
    await seedThread(store);
    await svc.acquire('userA', 't1', { deviceId: 'devA', deviceLabel: 'Chrome' });
    const after = await svc.release('userA', 't1', 'devB');
    expect(after.lock?.deviceId).toBe('devA');
  });

  it('is a no-op (no throw) when releasing a free thread', async () => {
    await seedThread(store);
    const after = await svc.release('userA', 't1', 'devA');
    expect(after.lock ?? null).toBeNull();
  });

  it('throws not_found for a missing thread', async () => {
    expect(await code(() => svc.release('userA', 'nope', 'devA'))).toBe('not_found');
  });
});
