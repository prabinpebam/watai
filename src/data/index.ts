import { LocalRepository } from './local/localRepository';
import type { Repository } from './repository';
import { WataiApiClient } from './cloud/apiClient';
import { SkillsApiClient } from './cloud/skillsApi';
import { RealtimeClient } from './cloud/realtime';
import { SyncRepository } from './sync/syncRepository';
import { idbKvStore } from './sync/kvStore';
import { getCloudToken } from '../auth/cloudAuth';
import type { Message } from '../lib/types';
import { useUi } from '../state/store';

// Local store is the source of truth for the UI; the sync engine wraps it and
// mirrors changes to the cloud only when Settings.data.sync is on AND a user is
// signed in. With sync off it is a transparent passthrough to the local store.
const local = new LocalRepository();
const cloud = new WataiApiClient({ getToken: getCloudToken });
const sync = new SyncRepository(local, cloud, idbKvStore());

// Single Repository instance for the whole app (the swap seam).
export const repo: Repository = sync;

/** Cloud API client for non-repository calls (access status + admin invite management). */
export const cloudApi = cloud;

/** Skills API client (`/api/skills`) — default + user-managed Agent Skills. */
export const skillsApi = new SkillsApiClient({ getToken: getCloudToken });

/** Realtime push (SignalR) for server-authoritative runs — connects lazily on the first server
 *  run and streams assistant/thread updates straight into the UI. */
export const realtime = new RealtimeClient(() => cloud.negotiate());

/** Push local changes + pull remote deltas (no-op unless sync is on and signed in). Resolves
 *  with the set of thread ids whose local state changed during the pull, so callers can refresh. */
export async function syncNow(): Promise<Set<string>> {
  useUi.getState().beginThreadSync();
  try {
    return await sync.sync();
  } finally {
    useUi.getState().endThreadSync();
  }
}

/** Write a server-authored message into the local store verbatim (no re-queue). Used by the
 *  server-run streaming finalizer to land the finished reply, since the bulk pull cursor skips it. */
export function saveServerMessage(m: Message): Promise<void> {
  return sync.mergeServerMessage(m);
}

/** Enqueue all existing local data for upload — call once when the user turns sync on. */
export function backfillSync(): Promise<void> {
  return sync.backfill();
}

/** Remove demo threads (stable `seed-` ids) + their messages from the local store. Production
 *  calls this on startup so users who visited an earlier (demo-seeded) build don't keep
 *  placeholder chats; real user data is never touched. */
export async function purgeDemoData(): Promise<void> {
  await local.purgeSeedThreads();
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
  // Demo content is loaded lazily so it stays out of the production bundle entirely.
  const { buildSeed } = await import('../mocks/seed');
  for (const { thread, messages } of buildSeed()) {
    await repo.createThread(thread);
    for (const m of messages) {
      await repo.appendMessage(m);
    }
  }
  localStorage.setItem(SEED_FLAG, '1');
}

export type { Repository };
