import { LocalRepository } from './local/localRepository';
import type { Repository } from './repository';
import { buildSeed } from '../mocks/seed';
import { WataiApiClient } from './cloud/apiClient';
import { SyncRepository } from './sync/syncRepository';
import { idbKvStore } from './sync/kvStore';
import { getCloudToken } from '../auth/cloudAuth';

// Local store is the source of truth for the UI; the sync engine wraps it and
// mirrors changes to the cloud only when Settings.data.sync is on AND a user is
// signed in. With sync off it is a transparent passthrough to the local store.
const local = new LocalRepository();
const cloud = new WataiApiClient({ getToken: getCloudToken });
const sync = new SyncRepository(local, cloud, idbKvStore());

// Single Repository instance for the whole app (the swap seam).
export const repo: Repository = sync;

/** Push local changes + pull remote deltas (no-op unless sync is on and signed in). */
export function syncNow(): Promise<void> {
  return sync.sync();
}

/** Enqueue all existing local data for upload — call once when the user turns sync on. */
export function backfillSync(): Promise<void> {
  return sync.backfill();
}

const SEED_FLAG = 'watai.seeded';

/** Populate the local store with demo threads once, so the UI is reviewable without a key. */
export async function seedMockDataIfEmpty(force = false): Promise<void> {
  if (!force && localStorage.getItem(SEED_FLAG)) return;
  const existing = await repo.listThreads({ includeArchived: true });
  if (existing.length > 0 && !force) {
    localStorage.setItem(SEED_FLAG, '1');
    return;
  }
  for (const { thread, messages } of buildSeed()) {
    await repo.createThread(thread);
    for (const m of messages) {
      await repo.appendMessage(m);
    }
  }
  localStorage.setItem(SEED_FLAG, '1');
}

export type { Repository };
