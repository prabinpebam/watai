import { AppError } from '../domain/errors';
import { parseImageCreateInput } from '../domain/imageGen';
import type { ImageGenRecord, ImageListOptions, ImageStore } from '../ports/imageStore';
import type { ImageJobStarter } from '../ports/imageJobStarter';
import type { SasMinter } from '../ports/sasMinter';
import type { ServiceClock } from './threadService';
import type { CredentialReader } from './imageWorker';
import { toImageDto, type ImageDTO } from './imageDto';

/**
 * Creates and tracks server-side image generations. `create` persists queued records and enqueues
 * one job per image, then returns immediately so the client can disconnect — the queue worker owns
 * generation and writes the bytes to Blob Storage. `list`/`get` enrich `ready` records with a
 * short-lived read URL; `remove` deletes the record and its blob.
 */
export class ImageService {
  constructor(
    private readonly imageStore: ImageStore,
    private readonly credentials: CredentialReader,
    private readonly starter: ImageJobStarter,
    private readonly minter: SasMinter,
    private readonly clock: ServiceClock,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async create(userId: string, input: unknown): Promise<ImageDTO[]> {
    const parsed = parseImageCreateInput(input);
    const creds = await this.credentials.getDecrypted(userId);
    const model = creds.models.image;
    if (!model) throw new AppError('validation', 'No image model is configured.');

    // Remix lineage must reference one of the caller's own images.
    if (parsed.sourceImageId) {
      const source = await this.imageStore.get(userId, parsed.sourceImageId);
      if (!source) throw new AppError('not_found', 'Source image not found.');
    }

    const size = parsed.size ?? '1024x1024';
    const count = parsed.count ?? 1;
    const batchId = this.clock.newId();
    const ts = this.clock.now();
    const records: ImageGenRecord[] = [];

    for (let i = 0; i < count; i += 1) {
      const queued: ImageGenRecord = {
        id: this.clock.newId(),
        userId,
        batchId,
        status: 'queued',
        prompt: parsed.prompt,
        size,
        ...(parsed.quality ? { quality: parsed.quality } : {}),
        outputFormat: 'png',
        model,
        ...(parsed.sourceImageId ? { sourceImageId: parsed.sourceImageId } : {}),
        ...(parsed.useReference ? { useReference: true } : {}),
        error: null,
        createdAt: ts,
        updatedAt: ts,
      };
      const saved = await this.imageStore.put(queued);
      try {
        await this.starter.start({ imageId: saved.id, userId });
        records.push(saved);
      } catch {
        // Could not enqueue — fail the record so it isn't stuck "queued" forever.
        const errored: ImageGenRecord = {
          ...saved,
          status: 'error',
          error: { code: 'internal', message: 'Could not start generation.' },
          updatedAt: this.clock.now(),
        };
        await this.imageStore.put(errored);
        records.push(errored);
      }
    }

    return records.map((r) => ({ ...r }));
  }

  async list(
    userId: string,
    options: ImageListOptions = {},
  ): Promise<{ images: ImageDTO[]; cursor?: string }> {
    const { items, cursor } = await this.imageStore.list(userId, options);
    const images = await Promise.all(items.map((r) => toImageDto(this.minter, r)));
    return { images, ...(cursor ? { cursor } : {}) };
  }

  async get(userId: string, id: string): Promise<ImageDTO> {
    const rec = await this.imageStore.get(userId, id);
    if (!rec) throw new AppError('not_found', 'Image not found.');
    return toImageDto(this.minter, rec);
  }

  async remove(userId: string, id: string): Promise<void> {
    const rec = await this.imageStore.get(userId, id);
    if (!rec) return; // idempotent
    if (rec.blobPath) {
      try {
        const { url } = await this.minter.mint({ blobPath: rec.blobPath, op: 'delete', ttlSeconds: 120 });
        await this.fetchImpl(url, { method: 'DELETE' });
      } catch {
        /* best-effort blob cleanup; the record removal is the source of truth */
      }
    }
    await this.imageStore.delete(userId, id);
  }
}
