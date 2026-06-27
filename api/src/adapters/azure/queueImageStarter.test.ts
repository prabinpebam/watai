import { describe, it, expect } from 'vitest';
import { decodeImageJob, IMAGE_QUEUE } from './queueImageStarter';

describe('decodeImageJob', () => {
  const job = { imageId: 'img1', userId: 'userA' };

  it('uses the queue name image-jobs', () => {
    expect(IMAGE_QUEUE).toBe('image-jobs');
  });

  it('decodes an already-parsed object', () => {
    expect(decodeImageJob(job)).toEqual(job);
  });

  it('decodes a base64-encoded JSON message (the on-wire form)', () => {
    const encoded = Buffer.from(JSON.stringify(job), 'utf8').toString('base64');
    expect(decodeImageJob(encoded)).toEqual(job);
  });

  it('decodes a raw JSON string', () => {
    expect(decodeImageJob(JSON.stringify(job))).toEqual(job);
  });
});
