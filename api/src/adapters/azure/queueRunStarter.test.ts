import { describe, it, expect } from 'vitest';
import { decodeRunJob } from './queueRunStarter';

describe('decodeRunJob', () => {
  const job = { runId: 'r1', threadId: 't1', userId: 'u1' };

  it('decodes a base64-encoded JSON message (as the starter sends it)', () => {
    const b64 = Buffer.from(JSON.stringify(job)).toString('base64');
    expect(decodeRunJob(b64)).toEqual(job);
  });

  it('decodes a raw JSON string (if the host already base64-decoded)', () => {
    expect(decodeRunJob(JSON.stringify(job))).toEqual(job);
  });

  it('passes through an already-parsed object', () => {
    expect(decodeRunJob(job)).toEqual(job);
  });
});
