import { describe, it, expect } from 'vitest';
import { parseCreateInvite, normalizeEmail } from './invite';
import { AppError } from './errors';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

describe('parseCreateInvite', () => {
  it('accepts a valid email and normalizes (trim + lowercase)', () => {
    expect(parseCreateInvite({ email: '  Friend@Example.COM ' })).toEqual({ email: 'friend@example.com' });
  });

  it('rejects an invalid email', () => {
    expect(code(() => parseCreateInvite({ email: 'not-an-email' }))).toBe('validation');
  });

  it('rejects unknown fields (strict)', () => {
    expect(code(() => parseCreateInvite({ email: 'a@b.com', evil: 1 }))).toBe('validation');
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  ME@Example.com ')).toBe('me@example.com');
  });
});
