import { describe, it, expect } from 'vitest';
import { assertFetchableImageUrl, isPrivateHost } from './webImage';
import { AppError } from './errors';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

describe('isPrivateHost', () => {
  it('flags loopback, private, link-local and metadata hosts', () => {
    for (const h of [
      'localhost',
      '127.0.0.1',
      '127.5.5.5',
      '0.0.0.0',
      '10.0.0.1',
      '192.168.1.1',
      '172.16.0.1',
      '172.31.255.255',
      '169.254.169.254',
      '::1',
      '[::1]',
      'fe80::1',
      'fd12:3456::1',
      'metadata',
      'metadata.google.internal',
      'printer.local',
    ]) {
      expect(isPrivateHost(h), h).toBe(true);
    }
  });

  it('allows public hosts and public IP literals', () => {
    for (const h of ['images.unsplash.com', 'example.com', '8.8.8.8', '172.15.0.1', '172.32.0.1']) {
      expect(isPrivateHost(h), h).toBe(false);
    }
  });
});

describe('assertFetchableImageUrl', () => {
  it('returns the parsed URL for public http(s) image URLs', () => {
    expect(assertFetchableImageUrl('https://images.unsplash.com/photo-1.jpg').hostname).toBe('images.unsplash.com');
    expect(assertFetchableImageUrl('http://example.com/cat.png').protocol).toBe('http:');
  });

  it('rejects non-http(s) schemes', () => {
    expect(code(() => assertFetchableImageUrl('file:///etc/passwd'))).toBe('validation');
    expect(code(() => assertFetchableImageUrl('data:image/png;base64,AAAA'))).toBe('validation');
    expect(code(() => assertFetchableImageUrl('ftp://host/a.png'))).toBe('validation');
  });

  it('rejects credentials in the URL', () => {
    expect(code(() => assertFetchableImageUrl('https://user:pass@example.com/a.png'))).toBe('validation');
  });

  it('rejects internal / metadata hosts', () => {
    expect(code(() => assertFetchableImageUrl('http://169.254.169.254/latest/meta-data'))).toBe('validation');
    expect(code(() => assertFetchableImageUrl('http://localhost:8080/a.png'))).toBe('validation');
    expect(code(() => assertFetchableImageUrl('http://10.0.0.5/a.png'))).toBe('validation');
  });

  it('rejects malformed URLs', () => {
    expect(code(() => assertFetchableImageUrl('not a url'))).toBe('validation');
  });
});
