import { LocalRepository } from './local/localRepository';
import type { Repository } from './repository';
import { buildSeed } from '../mocks/seed';

// Single Repository instance for the whole app (the swap seam). The Azure adapter
// would implement the same interface later with zero UI changes.
export const repo: Repository = new LocalRepository();

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
