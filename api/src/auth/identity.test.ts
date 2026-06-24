import { describe, it, expect } from 'vitest';
import { identityFromClaims } from './identity';
import { AppError } from '../domain/errors';

describe('identityFromClaims', () => {
  it('derives userId from the subject claim', () => {
    const id = identityFromClaims({ sub: 'abc-123', name: 'Ada' });
    expect(id.userId).toBe('abc-123');
  });

  it('prefers oid when present (Entra object id)', () => {
    const id = identityFromClaims({ sub: 'pairwise-sub', oid: 'stable-oid' });
    expect(id.userId).toBe('stable-oid');
  });

  it('rejects claims without a subject', () => {
    expect(() => identityFromClaims({ name: 'no-sub' })).toThrow(AppError);
    try {
      identityFromClaims({});
    } catch (e) {
      expect((e as AppError).code).toBe('unauthorized');
    }
  });
});
