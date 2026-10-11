import { AppError } from '../domain/errors';
import { ALLOWED_CONTENT_TYPES, type AllowedContentType } from '../domain/asset';
import type { ThreadRecord, ThreadStore, ThreadLockStore, ThreadFileMeta } from '../ports/threadStore';
import type { AoaiCreds, AoaiFiles, VectorFileStatus } from '../ai/files';
import type { DecryptedCredentials } from './credentialService';
import type { ServiceClock } from './threadService';
import { libraryItemIdFor } from '../domain/library';
import { validatedAiUrl } from '../ai/http';

/** Just the decrypt capability this service needs from the credential vault. */
export interface CredentialDecryptor {
  getDecrypted(userId: string): Promise<DecryptedCredentials>;
}

export interface ThreadFileUpload {
  name: string;
  mime: string;
  /** The file bytes, base64-encoded (a `data:` prefix is tolerated). */
  dataBase64: string;
}

export interface ThreadFilesOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  uploadOriginal?: (
    userId: string,
    threadId: string,
    assetId: string,
    bytes: Uint8Array,
    contentType: AllowedContentType,
  ) => Promise<string>;
  resolveLibraryItem?: (userId: string, itemId: string) => Promise<{ name: string; mime: string; bytes: Uint8Array } | null>;
  recordLibraryItem?: (input: { userId: string; thread: ThreadRecord; file: ThreadFileMeta }) => Promise<void>;
  /** Indexing poll cadence + bound (defaults ~18s total). */
  pollMs?: number;
  maxPolls?: number;
}

/** 25 MB cap per document — generous for text/PDF/office docs, bounded for a function body. */
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_ENCODED_LENGTH = 4 * Math.ceil(MAX_BYTES / 3);
const MAX_DATA_URL_PREFIX = 150;

function decodeBase64(data: string): Uint8Array {
  if (data.length > MAX_ENCODED_LENGTH + MAX_DATA_URL_PREFIX) {
    throw new AppError('validation', 'The file exceeds the 25 MB limit.');
  }
  const prefix = data.startsWith('data:') ? /^data:[^;,]{0,128};base64,/.exec(data) : null;
  if (data.startsWith('data:') && !prefix) throw new AppError('validation', 'The file payload is not valid base64.');
  const encoded = prefix ? data.slice(prefix[0].length) : data;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const decodedLength = Math.floor(encoded.length * 3 / 4) - padding;
  if (decodedLength > MAX_BYTES) throw new AppError('validation', 'The file exceeds the 25 MB limit.');
  if (encoded.length % 4 === 1 || (padding > 0 && encoded.length % 4 !== 0) || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new AppError('validation', 'The file payload is not valid base64.');
  }
  return Buffer.from(encoded, 'base64');
}

function allowedContentType(mime: string): AllowedContentType | null {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(mime) ? mime as AllowedContentType : null;
}

/**
 * Manages a thread's knowledge base: uploads documents to the Azure OpenAI Files API, attaches
 * them to a per-thread vector store (created on first upload), and records the file metadata on
 * the thread so `file_search` can ground on them. Ownership is enforced by the caller's userId
 * (the thread is read from that user's partition); credentials come from the encrypted vault.
 */
export class ThreadFilesService {
  constructor(
    private readonly threads: ThreadStore & ThreadLockStore,
    private readonly credentials: CredentialDecryptor,
    private readonly files: AoaiFiles,
    private readonly clock: ServiceClock,
    private readonly opts: ThreadFilesOptions = {},
  ) {}

  private async load(userId: string, threadId: string): Promise<ThreadRecord> {
    const t = await this.threads.get(userId, threadId);
    if (!t || t.deletedAt) throw new AppError('not_found', 'Thread not found.');
    return t;
  }

  private toCreds(c: DecryptedCredentials): AoaiCreds {
    return { baseUrl: c.baseUrl, key: c.key, fetchImpl: this.opts.fetchImpl };
  }

  async list(userId: string, threadId: string): Promise<ThreadFileMeta[]> {
    return (await this.load(userId, threadId)).files ?? [];
  }

  async upload(userId: string, threadId: string, input: ThreadFileUpload): Promise<ThreadFileMeta> {
    const name = input.name?.trim() || 'document';
    const bytes = decodeBase64(input.dataBase64 ?? '');
    if (!bytes.byteLength) throw new AppError('validation', 'The file is empty.');
    if (bytes.byteLength > MAX_BYTES) throw new AppError('validation', 'The file exceeds the 25 MB limit.');

    return this.indexBytes(userId, threadId, name, input.mime || 'application/octet-stream', bytes, true);
  }

  async attachLibraryItem(userId: string, threadId: string, itemId: string): Promise<ThreadFileMeta> {
    if (!this.opts.resolveLibraryItem) throw new AppError('conflict', 'Library document reuse is unavailable.');
    const resolved = await this.opts.resolveLibraryItem(userId, itemId);
    if (!resolved) throw new AppError('not_found', 'Library item not found.');
    if (!resolved.bytes.byteLength || resolved.bytes.byteLength > MAX_BYTES) throw new AppError('validation', 'Library item cannot be indexed.');
    return this.indexBytes(userId, threadId, resolved.name, resolved.mime, resolved.bytes, false, itemId);
  }

  private async indexBytes(
    userId: string,
    threadId: string,
    name: string,
    mime: string,
    bytes: Uint8Array,
    persistOriginal: boolean,
    libraryItemId?: string,
  ): Promise<ThreadFileMeta> {
    const thread = await this.load(userId, threadId);
    const creds = this.toCreds(await this.credentials.getDecrypted(userId));
    const providerEndpoint = new URL(validatedAiUrl(creds.baseUrl, '/files')).origin;

    // 1. upload the bytes; 2. ensure a thread vector store; 3. attach + briefly await indexing.
    const up = await this.files.uploadFile(creds, {
      bytes,
      filename: name,
      mime,
    });
    const vectorStoreId = thread.vectorStoreId && thread.vectorStoreEndpoint === providerEndpoint
      ? thread.vectorStoreId
      : await this.files.createVectorStore(creds, `thread:${threadId}`);
    const attached = await this.files.addFile(creds, vectorStoreId, up.id);
    const status = await this.waitForReady(creds, vectorStoreId, up.id, attached);
    const live = await this.load(userId, threadId);
    if (live.vectorStoreId !== thread.vectorStoreId || live.vectorStoreEndpoint !== thread.vectorStoreEndpoint) {
      throw new AppError('conflict', 'Thread files changed during upload. Retry from the current thread.');
    }
    const contentType = allowedContentType(mime);
    const blobPath = persistOriginal && contentType && this.opts.uploadOriginal
      ? await this.opts.uploadOriginal(userId, threadId, up.id, bytes, contentType).catch(() => undefined)
      : undefined;

    const meta: ThreadFileMeta = {
      fileId: up.id,
      providerEndpoint,
      ...(libraryItemId
        ? { libraryItemId }
        : blobPath
          ? { libraryItemId: libraryItemIdFor(userId, 'thread_document', up.id) }
          : {}),
      name,
      bytes: up.bytes,
      status,
      createdAt: this.clock.now(),
      ...(blobPath ? { blobPath } : {}),
      ...(contentType ? { mime: contentType } : {}),
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.threads.getForUpdate(userId, threadId);
      if (!current || current.record.deletedAt) throw new AppError('not_found', 'Thread not found.');
      if (!current.etag || current.record.vectorStoreId !== thread.vectorStoreId || current.record.vectorStoreEndpoint !== thread.vectorStoreEndpoint) {
        throw new AppError('conflict', 'Thread files changed during upload. Retry from the current thread.');
      }
      const saved = await this.threads.putIfMatch({
        ...current.record,
        vectorStoreId,
        vectorStoreEndpoint: providerEndpoint,
        files: [...(current.record.files ?? []).filter(file => file.fileId !== meta.fileId), meta],
        updatedAt: this.clock.now(),
      }, current.etag);
      if (!saved) continue;
      if (persistOriginal && blobPath && meta.libraryItemId && this.opts.recordLibraryItem) {
        await this.opts.recordLibraryItem({ userId, thread: saved, file: meta });
      }
      return meta;
    }
    throw new AppError('conflict', 'Thread changed repeatedly during upload. Retry from the current thread.');
  }

  async remove(userId: string, threadId: string, fileId: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.threads.getForUpdate(userId, threadId);
      if (!current || current.record.deletedAt) throw new AppError('not_found', 'Thread not found.');
      const detachedFile = (current.record.files ?? []).find(file => file.fileId === fileId);
      if (!detachedFile) {
        throw new AppError('not_found', 'Thread file not found.');
      }
      if (!current.etag) throw new AppError('conflict', 'Thread version unavailable. Reload before retrying.');
      const files = (current.record.files ?? []).filter(file => file.fileId !== fileId);
      const detachedStore = current.record.vectorStoreId;
      const removeStore = files.length === 0;
      const saved = await this.threads.putIfMatch({
        ...current.record, files,
        vectorStoreId: removeStore ? undefined : detachedStore,
        vectorStoreEndpoint: removeStore ? undefined : current.record.vectorStoreEndpoint,
        updatedAt: this.clock.now(),
      }, current.etag);
      if (!saved) continue;
      if (!detachedFile.providerEndpoint && !current.record.vectorStoreEndpoint) return;
      const creds = await this.tryCreds(userId);
      if (creds) {
        const endpoint = new URL(validatedAiUrl(creds.baseUrl, '/files')).origin;
        const fileMatches = detachedFile.providerEndpoint === endpoint;
        const storeMatches = !!detachedStore && current.record.vectorStoreEndpoint === endpoint;
        if (fileMatches && storeMatches) await this.files.removeFile(creds, detachedStore!, fileId).catch(() => {});
        if (fileMatches) await this.files.deleteFile(creds, fileId).catch(() => {});
        if (removeStore && storeMatches) await this.files.deleteVectorStore(creds, detachedStore!).catch(() => {});
      }
      return;
    }
    throw new AppError('conflict', 'Thread changed repeatedly during file removal. Reload before retrying.');
  }

  /** Best-effort provider cleanup when a thread is deleted (store + every file). */
  async cleanup(userId: string, threadId: string): Promise<void> {
    const thread = await this.threads.get(userId, threadId);
    if (!thread?.vectorStoreId && !(thread?.files?.length)) return;
    if (!thread?.vectorStoreEndpoint && !(thread?.files ?? []).some(file => file.providerEndpoint)) return;
    const creds = await this.tryCreds(userId);
    if (!creds) return;
    const endpoint = new URL(validatedAiUrl(creds.baseUrl, '/files')).origin;
    if (thread?.vectorStoreId && thread.vectorStoreEndpoint === endpoint) await this.files.deleteVectorStore(creds, thread.vectorStoreId).catch(() => {});
    for (const file of thread?.files ?? []) {
      if (file.providerEndpoint === endpoint) await this.files.deleteFile(creds, file.fileId).catch(() => {});
    }
  }

  private async tryCreds(userId: string): Promise<AoaiCreds | null> {
    try {
      return this.toCreds(await this.credentials.getDecrypted(userId));
    } catch {
      return null;
    }
  }

  private async waitForReady(
    creds: AoaiCreds,
    vectorStoreId: string,
    fileId: string,
    initial: VectorFileStatus,
  ): Promise<VectorFileStatus> {
    const sleep = this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const pollMs = this.opts.pollMs ?? 1500;
    const maxPolls = this.opts.maxPolls ?? 12;
    let status = initial;
    for (let n = 0; status === 'indexing' && n < maxPolls; n++) {
      await sleep(pollMs);
      status = await this.files.fileStatus(creds, vectorStoreId, fileId).catch(() => status);
    }
    return status;
  }
}
