import { describe, it, expect, vi, afterEach } from 'vitest';
import { newId, shortId } from './ids';

const CROCKFORD = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/;

describe('ids', () => {
  afterEach(() => vi.restoreAllMocks());

  it('newId is 26 Crockford-base32 chars', () => {
    const id = newId();
    expect(id).toHaveLength(26);
    expect(id).toMatch(CROCKFORD);
  });

  it('newId values are unique', () => {
    const set = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(set.size).toBe(1000);
  });

  it('newId time prefix is monotonic with the clock', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const earlier = newId().slice(0, 10);
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    const later = newId().slice(0, 10);
    expect(later >= earlier).toBe(true);
  });

  it('shortId is 8 Crockford-base32 chars', () => {
    const id = shortId();
    expect(id).toHaveLength(8);
    expect(id).toMatch(CROCKFORD);
  });
});
