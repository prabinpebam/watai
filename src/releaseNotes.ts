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
    version: '0.2.5',
    deployedAt: '2026-10-11T06:40:00Z',
    apiDeployedAt: '2026-10-11T06:24:48Z',
    title: 'Server moved to a supported Node.js runtime',
    changes: [
      'The Watai API now runs on Node.js 24; Node.js 20 reached end of life in April 2026',
      'The app code and your data are unchanged from 0.2.4',
    ],
  },
  {
    version: '0.2.4',
    deployedAt: '2026-10-11T05:47:23Z',
    apiDeployedAt: '2026-10-11T05:43:48Z',
    title: 'More dependable memory, sync, uploads and voice',
    changes: [
      'Memory edits, filters and reads stay consistent; failed saves keep your draft and offer Retry',
      'Export saved memories to a file and preview an archive without changing your memory',
      'Replies use memories only if still allowed, current and not deleted, within size and time limits',
      'Clearing this device or switching accounts stops late sync, uploads and downloads from restoring data',
      'Library uploads and loads cancel cleanly, and image details can be retried',
      'Voice capture and onboarding checks stop reliably when you leave, mute or change settings',
      'Live updates reconnect when the tab returns online without duplicate connections',
      'Only HTTPS Azure AI endpoints (*.openai, *.cognitiveservices, *.services.ai) can be used',
      'Background memory indexing remains off; real provider behavior still needs manual validation',
    ],
  },
  {
    version: '0.2.3',
    deployedAt: '2026-09-13T12:00:27Z',
    apiDeployedAt: '2026-09-13T18:29:13Z',
    title: 'Transparent backgrounds for chat images',
    changes: [
      'Chat requests for transparent backgrounds or background removal can select native alpha transparency',
      'Image generation and edits send the background option and preserve PNG output',
      'Uses your configured image deployment and saved key; requires transparent-background support',
      'Provider-generated alpha pixels still require manual validation',
      'API worker activation verified through OneDeploy; earlier upload checks did not verify active code',
    ],
  },
  {
    version: '0.2.2',
    deployedAt: '2026-09-11T12:30:37Z',
    apiDeployedAt: '2026-09-11T12:29:18Z',
    title: 'Stable chat chronology throughout a response',
    changes: [
      'Submitted prompts remain visible while background history refreshes',
      'Prompt and reply order stays fixed from the first bubble through server streaming',
      'Late updates from an older response cannot replace the current reply',
      'Completed replies remain visible until persisted history takes over',
      'API package healthy after restart at 2026-09-11 12:29:55 UTC',
    ],
  },
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