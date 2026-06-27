import { isActiveImage } from '../domain/imageGen';
import { isAiError } from '../ai/errors';
import {
  generateImage as defaultGenerateImage,
  editImage as defaultEditImage,
  type ImageGenParams,
  type ImageEditParams,
  type ImageResult,
} from '../ai/image';
import type { ImageError } from '../domain/imageGen';
import type { ImageGenRecord, ImageStore } from '../ports/imageStore';
import type { SasMinter } from '../ports/sasMinter';
import type { SignalRSender } from '../adapters/azure/signalr';
import type { DecryptedCredentials } from './credentialService';
import type { ServiceClock } from './threadService';
import { toImageDto } from './imageDto';

export interface CredentialReader {
  getDecrypted(userId: string): Promise<DecryptedCredentials>;
}

export interface ImageWorkerDeps {
  imageStore: ImageStore;
  credentials: CredentialReader;
  /** Mints read SAS (source download) + write SAS (output upload). */
  minter: SasMinter;
  clock: ServiceClock;
  /** Realtime push to the owning user on each status change. Optional (poll is the fallback). */
  signalr?: SignalRSender;
  /** Injectable generators for tests. */
  generateImage?: (p: ImageGenParams) => Promise<ImageResult[]>;
  editImage?: (p: ImageEditParams) => Promise<ImageResult[]>;
  fetchImpl?: typeof fetch;
}

function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function extFor(format: ImageGenRecord['outputFormat']): string {
  return format === 'jpeg' ? 'jpg' : format === 'webp' ? 'webp' : 'png';
}

function contentTypeFor(format: ImageGenRecord['outputFormat']): string {
  return format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
}

function toImageError(e: unknown): ImageError {
  if (isAiError(e)) return { code: e.code, message: e.message };
  return { code: 'internal', message: e instanceof Error ? e.message : 'Image generation failed.' };
}

async function downloadBlob(
  minter: SasMinter,
  blobPath: string,
  fetchImpl: typeof fetch,
): Promise<Uint8Array> {
  const { url } = await minter.mint({ blobPath, op: 'read', ttlSeconds: 300 });
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Source image download failed (${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

async function uploadBlob(
  minter: SasMinter,
  blobPath: string,
  bytes: Uint8Array,
  contentType: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const { url } = await minter.mint({ blobPath, op: 'write', contentType, ttlSeconds: 300 });
  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': contentType },
    body: bytes as unknown as RequestInit['body'],
  });
  if (!res.ok) throw new Error(`Image upload failed (${res.status}).`);
}

async function push(deps: ImageWorkerDeps, record: ImageGenRecord): Promise<void> {
  if (!deps.signalr) return;
  const dto = await toImageDto(deps.minter, record);
  await deps.signalr.sendToUser(record.userId, 'image', { image: dto });
}

/**
 * Finalize the record with an error status (re-reading first so a delete that landed mid-flight is
 * not resurrected), then push.
 */
async function finalizeError(
  deps: ImageWorkerDeps,
  record: ImageGenRecord,
  error: ImageError,
): Promise<void> {
  const current = await deps.imageStore.get(record.userId, record.id);
  if (!current) return; // deleted while generating — do not resurrect
  const errored: ImageGenRecord = { ...current, status: 'error', error, updatedAt: deps.clock.now() };
  await deps.imageStore.put(errored);
  await push(deps, errored);
}

/**
 * Process one image job end-to-end on the server, independently of any client: load the user's
 * decrypted credentials, generate (or remix-edit) the image, upload the bytes to Blob Storage, and
 * mark the record `ready` (or `error`). Idempotent: a redelivered message that finds a terminal
 * record is a no-op.
 */
export async function processImageJob(
  deps: ImageWorkerDeps,
  userId: string,
  imageId: string,
): Promise<void> {
  const { imageStore, credentials, minter, clock } = deps;
  const genImage = deps.generateImage ?? defaultGenerateImage;
  const edit = deps.editImage ?? defaultEditImage;
  const fetchImpl = deps.fetchImpl ?? fetch;

  const rec = await imageStore.get(userId, imageId);
  if (!rec || !isActiveImage(rec.status)) return; // already finalized / deleted — idempotent

  const generating: ImageGenRecord = { ...rec, status: 'generating', updatedAt: clock.now() };
  await imageStore.put(generating);
  await push(deps, generating);

  try {
    const creds = await credentials.getDecrypted(userId);
    if (!creds.models.image) {
      await finalizeError(deps, generating, {
        code: 'no_image_model',
        message: 'No image model is configured.',
      });
      return;
    }

    let results: ImageResult[];
    if (rec.sourceImageId && rec.useReference) {
      const source = await imageStore.get(userId, rec.sourceImageId);
      if (!source?.blobPath) {
        await finalizeError(deps, generating, {
          code: 'source_missing',
          message: 'The source image is no longer available.',
        });
        return;
      }
      const bytes = await downloadBlob(minter, source.blobPath, fetchImpl);
      results = await edit({
        baseUrl: creds.baseUrl,
        key: creds.key,
        model: creds.models.image,
        prompt: rec.prompt,
        image: bytes,
        imageContentType: contentTypeFor(source.outputFormat),
        size: rec.size,
        ...(rec.quality ? { quality: rec.quality } : {}),
        fetchImpl,
      });
    } else {
      results = await genImage({
        baseUrl: creds.baseUrl,
        key: creds.key,
        model: creds.models.image,
        prompt: rec.prompt,
        size: rec.size,
        outputFormat: rec.outputFormat,
        ...(rec.quality ? { quality: rec.quality } : {}),
        fetchImpl,
      });
    }

    if (!results.length) {
      await finalizeError(deps, generating, { code: 'no_image', message: 'No image was generated.' });
      return;
    }

    const first = results[0];
    const bytes = b64ToBytes(first.b64);
    const blobPath = `${userId}/images/${rec.id}.${extFor(rec.outputFormat)}`;
    await uploadBlob(minter, blobPath, bytes, contentTypeFor(rec.outputFormat), fetchImpl);

    // Re-read so a delete that landed mid-generation is not resurrected.
    const current = await imageStore.get(userId, imageId);
    if (!current) return;
    const ready: ImageGenRecord = {
      ...current,
      status: 'ready',
      blobPath,
      ...(first.revisedPrompt ? { revisedPrompt: first.revisedPrompt } : {}),
      error: null,
      updatedAt: clock.now(),
    };
    await imageStore.put(ready);
    await push(deps, ready);
  } catch (e) {
    await finalizeError(deps, generating, toImageError(e));
  }
}
