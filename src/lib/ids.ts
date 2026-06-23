// Lexicographically-sortable, time-ordered IDs (ULID-ish). No external deps.

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

function randomChars(len: number): string {
  let out = '';
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) {
    out += ENCODING[bytes[i] & 31];
  }
  return out;
}

function encodeTime(time: number, len: number): string {
  let out = '';
  for (let i = len - 1; i >= 0; i--) {
    const mod = time % 32;
    out = ENCODING[mod] + out;
    time = (time - mod) / 32;
  }
  return out;
}

/** 26-char monotonic-ish ULID. */
export function newId(): string {
  return encodeTime(Date.now(), 10) + randomChars(16);
}

export function shortId(): string {
  return randomChars(8);
}
