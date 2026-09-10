import { describe, expect, it } from 'vitest';
import { CURRENT_RELEASE, RELEASE_NOTES } from './releaseNotes';

describe('release notes', () => {
  it('keeps the current version visible and user-focused', () => {
    expect(CURRENT_RELEASE).toBe(RELEASE_NOTES[0]);
    expect(CURRENT_RELEASE.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(CURRENT_RELEASE.changes.length).toBeGreaterThan(0);
    expect(CURRENT_RELEASE.changes.every((change) => change.length <= 120)).toBe(true);
  });
});