export interface ReleaseNote {
  version: string;
  deployedAt: string;
  apiDeployedAt: string;
  title: string;
  changes: string[];
}

export function formatDeploymentTimestamp(value: string): string {
  return value.replace('T', ' ').replace('Z', ' UTC');
}

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: '0.2.1',
    deployedAt: '2026-09-11T03:53:57Z',
    apiDeployedAt: '2026-09-11T03:50:53Z',
    title: 'History that reliably catches up after reconnecting',
    changes: [
      'Delayed messages with matching timestamps are no longer skipped during sync',
      'Older invalid sync cursors automatically recover through a bounded full resync',
      'Message order remains stable and replayed records are deduplicated',
    ],
  },
  {
    version: '0.2.0',
    deployedAt: '2026-09-10T20:23:54Z',
    apiDeployedAt: '2026-09-10T20:19:45Z',
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