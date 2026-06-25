// File-search vector-store lifecycle (browser → AI plane). Uploaded bytes go to the user's
// own AI endpoint/project — never to Watai's backend. The persistence plane only stores the
// opaque vector-store id (in ApiConfig.tools.vectorStoreId). See
// documentation/agentic/08-implementation-plan.md §8.
import { aiFetch, v1Url } from './http';
import { getApiConfig } from '../data/secureStore';
import { normalizeHttpError } from './errors';

type Requester = typeof aiFetch;
type GetConfig = typeof getApiConfig;

interface Deps {
  request?: Requester;
  getConfig?: GetConfig;
}

async function subPath(getConfig: GetConfig, sub: string): Promise<string> {
  const config = await getConfig();
  return v1Url(config?.baseUrl ?? '', sub);
}

/** Upload a document to the AI endpoint; returns its file id. */
export async function uploadFile(file: Blob, name: string, deps: Deps = {}): Promise<string> {
  const request = deps.request ?? aiFetch;
  const form = new FormData();
  form.append('purpose', 'assistants');
  form.append('file', file, name);
  const res = await request({ path: '/files', form });
  if (!res.ok) throw await normalizeHttpError(res);
  return (await res.json()).id as string;
}

/** Create a vector store; returns its id. */
export async function createVectorStore(name: string, deps: Deps = {}): Promise<string> {
  const request = deps.request ?? aiFetch;
  const res = await request({ path: '/vector_stores', body: { name } });
  if (!res.ok) throw await normalizeHttpError(res);
  return (await res.json()).id as string;
}

/** Attach an uploaded file to a vector store (begins server-side indexing). */
export async function addFileToStore(
  vectorStoreId: string,
  fileId: string,
  deps: Deps = {},
): Promise<void> {
  const request = deps.request ?? aiFetch;
  const getConfig = deps.getConfig ?? getApiConfig;
  const url = await subPath(getConfig, `/vector_stores/${vectorStoreId}/files`);
  const res = await request({ path: '/vector_stores', url, body: { file_id: fileId } });
  if (!res.ok) throw await normalizeHttpError(res);
}

export interface PollDeps extends Deps {
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}
/** Poll a vector-store file (GET) until it finishes indexing. Returns true on success. */
export async function pollIndex(
  vectorStoreId: string,
  fileId: string,
  deps: PollDeps = {},
): Promise<boolean> {
  const request = deps.request ?? aiFetch;
  const getConfig = deps.getConfig ?? getApiConfig;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = deps.maxAttempts ?? 30;
  const url = await subPath(getConfig, `/vector_stores/${vectorStoreId}/files/${fileId}`);
  for (let i = 0; i < maxAttempts; i++) {
    const res = await request({ path: '/vector_stores', url, method: 'GET' });
    if (!res.ok) throw await normalizeHttpError(res);
    const status = (await res.json()).status as string;
    if (status === 'completed') return true;
    if (status === 'failed' || status === 'cancelled') return false;
    await sleep(1000);
  }
  return false;
}

/** One file in a vector store, as returned by the list endpoint. */
export interface VectorStoreFile {
  id: string;
  status: string;
}

/** List the files in a vector store (GET) with their indexing status. */
export async function listStoreFiles(
  vectorStoreId: string,
  deps: Deps = {},
): Promise<VectorStoreFile[]> {
  const request = deps.request ?? aiFetch;
  const getConfig = deps.getConfig ?? getApiConfig;
  const url = await subPath(getConfig, `/vector_stores/${vectorStoreId}/files`);
  const res = await request({ path: '/vector_stores', url, method: 'GET' });
  if (!res.ok) throw await normalizeHttpError(res);
  const data = ((await res.json()).data ?? []) as Array<{ id?: string; status?: string }>;
  return data
    .filter((f): f is { id: string; status?: string } => typeof f.id === 'string')
    .map((f) => ({ id: f.id, status: f.status ?? 'unknown' }));
}

/** Detach + delete one file from a vector store (DELETE). */
export async function removeFileFromStore(
  vectorStoreId: string,
  fileId: string,
  deps: Deps = {},
): Promise<void> {
  const request = deps.request ?? aiFetch;
  const getConfig = deps.getConfig ?? getApiConfig;
  const url = await subPath(getConfig, `/vector_stores/${vectorStoreId}/files/${fileId}`);
  const res = await request({ path: '/vector_stores', url, method: 'DELETE' });
  if (!res.ok) throw await normalizeHttpError(res);
}

/** Delete an entire vector store (DELETE) — used to clear the knowledge base. */
export async function deleteVectorStore(vectorStoreId: string, deps: Deps = {}): Promise<void> {
  const request = deps.request ?? aiFetch;
  const getConfig = deps.getConfig ?? getApiConfig;
  const url = await subPath(getConfig, `/vector_stores/${vectorStoreId}`);
  const res = await request({ path: '/vector_stores', url, method: 'DELETE' });
  if (!res.ok) throw await normalizeHttpError(res);
}

/**
 * Upload a document into a vector store (creating one if needed) and wait for indexing.
 * Returns the store id used so the caller can persist it in ApiConfig.tools.vectorStoreId.
 */
export async function indexFileIntoStore(
  file: Blob,
  name: string,
  existingStoreId?: string,
): Promise<{ vectorStoreId: string; fileId: string; indexed: boolean }> {
  const fileId = await uploadFile(file, name);
  const vectorStoreId = existingStoreId ?? (await createVectorStore('Watai knowledge base'));
  await addFileToStore(vectorStoreId, fileId);
  const indexed = await pollIndex(vectorStoreId, fileId);
  return { vectorStoreId, fileId, indexed };
}
