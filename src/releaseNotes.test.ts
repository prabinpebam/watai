import { describe, expect, it } from 'vitest';
import { CURRENT_RELEASE, formatDeploymentTimestamp, RELEASE_NOTES } from './releaseNotes';

describe('release notes', () => {
  it('keeps the current version visible and user-focused', () => {
    expect(CURRENT_RELEASE).toBe(RELEASE_NOTES[0]);
    expect(CURRENT_RELEASE.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(RELEASE_NOTES.every((release) => Number.isFinite(Date.parse(release.deployedAt)))).toBe(true);
    expect(RELEASE_NOTES.every((release) => Number.isFinite(Date.parse(release.apiDeployedAt)))).toBe(true);
    expect(formatDeploymentTimestamp(CURRENT_RELEASE.apiDeployedAt)).toBe('2026-10-11 05:43:48 UTC');
    expect(CURRENT_RELEASE.changes.length).toBeGreaterThan(0);
    expect(CURRENT_RELEASE.changes.every((change) => change.length <= 120)).toBe(true);
  });
});