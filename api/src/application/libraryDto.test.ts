import { describe, expect, it, vi } from 'vitest';
import { toLibraryItemDto } from './libraryDto';
import { libraryFixture } from '../test/libraryFixtures';
import type { SasMinter } from '../ports/sasMinter';

const minter: SasMinter = {
  async mint({ blobPath, op }) {
    return { url: `https://blob.example/${blobPath}?${op}=1&sig=secret`, expiresAt: '2026-07-19T13:00:00.000Z' };
  },
};

describe('Library DTO', () => {
  it('redacts ownership/idempotency fields and enriches active primary/thumbnail URLs', async () => {
    const item = libraryFixture({
      id: 'image-1',
      kind: 'image',
      origin: 'chat_generated_image',
      state: 'active',
      derivatives: [{
        kind: 'thumbnail',
        blobPath: 'user-1/library/image-1.thumb.webp',
        mime: 'image/webp',
        bytes: 100,
        width: 512,
        height: 512,
      }],
    });
    const dto = await toLibraryItemDto(minter, item);
    expect(dto).not.toHaveProperty('userId');
    expect(dto).not.toHaveProperty('ingestionKey');
    expect(dto).not.toHaveProperty('blobPath');
    expect(dto.derivatives?.[0]).not.toHaveProperty('blobPath');
    expect(dto.url).toContain('image-1.bin?read=1');
    expect(dto.thumbnailUrl).toContain('image-1.thumb.webp?read=1');
  });

  it('never returns a blob path or URL for purged records', async () => {
    const dto = await toLibraryItemDto(minter, libraryFixture({
      id: 'purged-1',
      kind: 'image',
      origin: 'library_upload',
      state: 'purged',
    }));
    expect(dto).not.toHaveProperty('blobPath');
    expect(dto).not.toHaveProperty('url');
    expect(dto).not.toHaveProperty('thumbnailUrl');
    expect(dto).not.toHaveProperty('error');
  });

  it('degrades to safe metadata if SAS minting fails', async () => {
    const failing: SasMinter = { mint: async () => { throw new Error('no'); } };
    const dto = await toLibraryItemDto(failing, libraryFixture({ id: 'a', kind: 'pdf', origin: 'code_artifact', state: 'active' }));
    expect(dto.url).toBeUndefined();
    expect(dto.id).toBe('a');
  });

  it('does not mint a grant for a foreign persisted path', async () => {
    const mint = vi.fn(async () => ({ url: 'should-not-exist', expiresAt: '2026' }));
    const dto = await toLibraryItemDto({ mint }, libraryFixture({
      id: 'foreign',
      kind: 'pdf',
      origin: 'chat_upload',
      state: 'active',
      blobPath: 'user-2/library/foreign.pdf',
    }));
    expect(dto.url).toBeUndefined();
    expect(mint).not.toHaveBeenCalled();
  });
});
