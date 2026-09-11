export interface ReleaseNote {
  version: string;
  date: string;
  title: string;
  changes: string[];
}

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: '0.2.2',
    date: '2026-09-11',
    title: 'Stable chat chronology throughout a response',
    changes: [
      'Submitted prompts remain visible while background history refreshes',
      'Prompt and reply order stays fixed from the first bubble through server streaming',
      'Late updates from an older response cannot replace the current reply',
      'Completed replies remain visible until persisted history takes over',
      'Frontend hotfix published: 2026-09-11 12:30:37 UTC',
      'API hotfix package published: 2026-09-11 12:29:18 UTC; healthy after restart at 12:29:55 UTC',
    ],
  },
  {
    version: '0.2.1',
    date: '2026-09-11',
    title: 'History that reliably catches up after reconnecting',
    changes: [
      'Delayed messages with matching timestamps are no longer skipped during sync',
      'Older invalid sync cursors automatically recover through a bounded full resync',
      'Message order remains stable and replayed records are deduplicated',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-09-11',
    title: 'Safer sync, memory, voice, and everyday recovery',
    changes: [
      'Safer account-isolated sync and durable chat submission',
      'Revision-safe settings and saved-memory controls',
      'Voice capture now stops reliably on mute, exit, and device loss',
      'Search opens the exact matched message and collections resist stale results',
      'Local export and clear-device controls now state and enforce their real scope',
      'Loading failures offer recovery without dropping drafts or active work',
      'Improved keyboard navigation, dialog focus, contrast, and narrow-screen reachability',
    ],
  },
] as const;

export const CURRENT_RELEASE = RELEASE_NOTES[0];