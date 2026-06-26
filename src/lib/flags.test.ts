import { describe, it, expect, beforeEach } from 'vitest';
import { isServerRunsEnabled, setServerRunsEnabled } from './flags';

describe('serverRuns feature flag', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to off', () => {
    expect(isServerRunsEnabled()).toBe(false);
  });

  it('persists when enabled and clears when disabled', () => {
    setServerRunsEnabled(true);
    expect(isServerRunsEnabled()).toBe(true);
    expect(localStorage.getItem('watai.flags.serverRuns')).toBe('on');

    setServerRunsEnabled(false);
    expect(isServerRunsEnabled()).toBe(false);
    expect(localStorage.getItem('watai.flags.serverRuns')).toBeNull();
  });

  it('treats any non-"on" stored value as off', () => {
    localStorage.setItem('watai.flags.serverRuns', 'true');
    expect(isServerRunsEnabled()).toBe(false);
  });
});
