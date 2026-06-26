import { describe, it, expect, beforeEach } from 'vitest';
import { getDeviceId, getDeviceLabel } from './device';

describe('getDeviceId', () => {
  beforeEach(() => localStorage.clear());

  it('generates a non-empty id and persists it (stable across calls)', () => {
    const a = getDeviceId();
    const b = getDeviceId();
    expect(a).toBeTruthy();
    expect(a).toBe(b);
    expect(localStorage.getItem('watai.deviceId')).toBe(a);
  });

  it('reuses an already-stored id', () => {
    localStorage.setItem('watai.deviceId', 'fixed-id');
    expect(getDeviceId()).toBe('fixed-id');
  });
});

describe('getDeviceLabel', () => {
  it('returns a non-empty human label', () => {
    const label = getDeviceLabel();
    expect(typeof label).toBe('string');
    expect(label.length).toBeGreaterThan(0);
  });
});
