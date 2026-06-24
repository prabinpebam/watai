import { describe, it, expect } from 'vitest';
import { parseSasRequest, extForContentType } from './asset';
import { AppError } from './errors';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

describe('parseSasRequest', () => {
  it('accepts a valid write request', () => {
    const input = { threadId: 't1', assetId: 'a1', op: 'write', contentType: 'image/png' };
    expect(parseSasRequest(input)).toEqual(input);
  });

  it('rejects disallowed content types', () => {
    expect(
      code(() => parseSasRequest({ threadId: 't1', assetId: 'a1', op: 'write', contentType: 'application/pdf' })),
    ).toBe('validation');
  });

  it('rejects bad ops, missing fields, and unknown fields', () => {
    expect(code(() => parseSasRequest({ threadId: 't1', assetId: 'a1', op: 'delete', contentType: 'image/png' }))).toBe('validation');
    expect(code(() => parseSasRequest({ assetId: 'a1', op: 'read', contentType: 'image/png' }))).toBe('validation');
    expect(code(() => parseSasRequest({ threadId: 't1', assetId: 'a1', op: 'read', contentType: 'image/png', evil: 1 }))).toBe('validation');
  });
});

describe('extForContentType', () => {
  it('maps mime types to file extensions', () => {
    expect(extForContentType('image/png')).toBe('png');
    expect(extForContentType('image/jpeg')).toBe('jpg');
    expect(extForContentType('audio/mpeg')).toBe('mp3');
  });
});
