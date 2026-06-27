// Azure OpenAI Files + Vector Stores API (server-side). Backs thread-scoped file search: the
// caller passes the vault-resolved baseUrl + key. A document is uploaded to the Files API, then
// attached to a (per-thread) vector store; the Responses API `file_search` tool then grounds on it.
// All calls are stateless (creds per call), matching the other `ai/*` modules.
import { aiFetch, v1Url } from './http';
import { normalizeHttpError } from './errors';

export interface AoaiCreds {
  baseUrl: string;
  key: string;
  fetchImpl?: typeof fetch;
}

export interface UploadedFile {
  id: string;
  bytes: number;
}

/** Vector-store file indexing status, normalized to the values we persist. */
export type VectorFileStatus = 'indexing' | 'ready' | 'error';

function mapStatus(raw: string | undefined): VectorFileStatus {
  if (raw === 'completed') return 'ready';
  if (raw === 'failed' || raw === 'cancelled') return 'error';
  return 'indexing'; // in_progress (or unknown) — still building
}

/** Abstraction over the AOAI files/vector-store calls so the service is unit-testable. */
export interface AoaiFiles {
  uploadFile(c: AoaiCreds, f: { bytes: Uint8Array; filename: string; mime: string }): Promise<UploadedFile>;
  createVectorStore(c: AoaiCreds, name: string): Promise<string>;
  addFile(c: AoaiCreds, vectorStoreId: string, fileId: string): Promise<VectorFileStatus>;
  fileStatus(c: AoaiCreds, vectorStoreId: string, fileId: string): Promise<VectorFileStatus>;
  removeFile(c: AoaiCreds, vectorStoreId: string, fileId: string): Promise<void>;
  deleteFile(c: AoaiCreds, fileId: string): Promise<void>;
  deleteVectorStore(c: AoaiCreds, vectorStoreId: string): Promise<void>;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) throw await normalizeHttpError(res, 'file_search');
  return (await res.json()) as T;
}

export const aoaiFiles: AoaiFiles = {
  // POST <base>/files (multipart: file + purpose) -> { id, bytes }
  async uploadFile({ baseUrl, key, fetchImpl }, { bytes, filename, mime }) {
    const form = new FormData();
    form.append('purpose', 'assistants');
    form.append('file', new Blob([bytes], mime ? { type: mime } : {}), filename);
    const res = await aiFetch({ baseUrl, key, path: '/files', body: form, fetchImpl, timeoutMs: 180_000 });
    const json = await jsonOrThrow<{ id: string; bytes?: number }>(res);
    return { id: json.id, bytes: json.bytes ?? bytes.byteLength };
  },

  // POST <base>/vector_stores { name } -> { id }
  async createVectorStore({ baseUrl, key, fetchImpl }, name) {
    const res = await aiFetch({ baseUrl, key, path: '/vector_stores', body: { name }, fetchImpl });
    const json = await jsonOrThrow<{ id: string }>(res);
    return json.id;
  },

  // POST <base>/vector_stores/{id}/files { file_id } -> { status }
  async addFile({ baseUrl, key, fetchImpl }, vectorStoreId, fileId) {
    const res = await aiFetch({
      baseUrl,
      key,
      url: v1Url(baseUrl, `/vector_stores/${encodeURIComponent(vectorStoreId)}/files`),
      body: { file_id: fileId },
      fetchImpl,
    });
    const json = await jsonOrThrow<{ status?: string }>(res);
    return mapStatus(json.status);
  },

  // GET <base>/vector_stores/{id}/files/{fileId} -> { status }
  async fileStatus({ baseUrl, key, fetchImpl }, vectorStoreId, fileId) {
    const res = await aiFetch({
      baseUrl,
      key,
      method: 'GET',
      url: v1Url(baseUrl, `/vector_stores/${encodeURIComponent(vectorStoreId)}/files/${encodeURIComponent(fileId)}`),
      fetchImpl,
    });
    const json = await jsonOrThrow<{ status?: string }>(res);
    return mapStatus(json.status);
  },

  // DELETE <base>/vector_stores/{id}/files/{fileId}
  async removeFile({ baseUrl, key, fetchImpl }, vectorStoreId, fileId) {
    const res = await aiFetch({
      baseUrl,
      key,
      method: 'DELETE',
      url: v1Url(baseUrl, `/vector_stores/${encodeURIComponent(vectorStoreId)}/files/${encodeURIComponent(fileId)}`),
      fetchImpl,
    });
    if (!res.ok && res.status !== 404) throw await normalizeHttpError(res, 'file_search');
  },

  // DELETE <base>/files/{fileId}
  async deleteFile({ baseUrl, key, fetchImpl }, fileId) {
    const res = await aiFetch({
      baseUrl,
      key,
      method: 'DELETE',
      url: v1Url(baseUrl, `/files/${encodeURIComponent(fileId)}`),
      fetchImpl,
    });
    if (!res.ok && res.status !== 404) throw await normalizeHttpError(res, 'file_search');
  },

  // DELETE <base>/vector_stores/{id}
  async deleteVectorStore({ baseUrl, key, fetchImpl }, vectorStoreId) {
    const res = await aiFetch({
      baseUrl,
      key,
      method: 'DELETE',
      url: v1Url(baseUrl, `/vector_stores/${encodeURIComponent(vectorStoreId)}`),
      fetchImpl,
    });
    if (!res.ok && res.status !== 404) throw await normalizeHttpError(res, 'file_search');
  },
};
