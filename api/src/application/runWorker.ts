import { isActive } from '../domain/run';
import type { ServiceClock } from './threadService';
import type { DecryptedCredentials } from './credentialService';
import type { RunStore } from '../ports/runStore';
import type { MessageRecord, MessageStore } from '../ports/messageStore';
import type { MessageToolCall, MessageCitation, MessageImage, MessageArtifact } from '../domain/message';
import { artifactKindForMime } from '../domain/message';
import { ALLOWED_CONTENT_TYPES } from '../domain/asset';
import type { Settings } from '../domain/settings';
import type { ThreadStore, ThreadFileMeta } from '../ports/threadStore';
import type { SignalRSender } from '../adapters/azure/signalr';
import {
  runAgent as defaultRunAgent,
  type AgentEvent,
  type RunAgentParams,
  type ToolExecute,
  type Turn,
} from '../ai/orchestrator';
import type { ResponsesCitation, ResponsesTool } from '../ai/responses';
import { tavilySearch } from '../ai/tavily';
import { generateImage } from '../ai/image';
import { listContainerFiles, getContainerFile, mimeForFilename } from '../ai/containerFiles';
import { selectSkills, codeInterpreterSection } from './skillService';
import { completeChat } from '../ai/chat';

export interface CredentialReader {
  getDecrypted(userId: string): Promise<DecryptedCredentials>;
}

export interface SettingsReader {
  get(userId: string): Promise<Settings>;
}

export interface RunWorkerDeps {
  runStore: RunStore;
  messageStore: MessageStore;
  threadStore: ThreadStore;
  credentials: CredentialReader;
  /** Per-user settings (personalization) for the system prompt. Optional. */
  settings?: SettingsReader;
  /** The agentic loop (Responses API). Injectable for tests. */
  runAgent?: (p: RunAgentParams) => AsyncGenerator<AgentEvent>;
  clock: ServiceClock;
  /** ms between throttled incremental message upserts (default 250). */
  flushIntervalMs?: number;
  /** Injectable fetch for the web-search / image executors (tests). */
  fetchImpl?: typeof fetch;
  /** Realtime push to the running user (token-by-token snapshots + thread updates). Optional;
   *  the client's sync poll is the fallback when push isn't configured. */
  signalr?: SignalRSender;
  /** Upload generated image bytes to Blob Storage; returns the blob path. Without it, image
   *  events are dropped (the text answer still completes). */
  uploadImage?: (
    userId: string,
    threadId: string,
    imageId: string,
    bytes: Uint8Array,
    contentType: string,
  ) => Promise<string>;
  /** Upload a generated artifact (code interpreter output) to Blob Storage; returns the blob
   *  path. Same SAS-write helper as `uploadImage`; without it, artifacts are skipped. */
  uploadArtifact?: (
    userId: string,
    threadId: string,
    artifactId: string,
    bytes: Uint8Array,
    contentType: string,
  ) => Promise<string>;
}

const DEFAULT_FLUSH_MS = 250;
/** Per-run artifact guards (code interpreter outputs persisted to Blob Storage). */
const MAX_ARTIFACTS = 16;
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

/** Build the system prompt from the user's personalization (about-you / response-style) plus a
 *  base persona and light tool guidance. */
function systemPrompt(creds: DecryptedCredentials, settings?: Settings, skillsSection?: string): string {
  const lines = ['You are Watai, a helpful AI assistant. Be accurate and concise.'];
  const p = settings?.personalization;
  if (p?.aboutYou?.trim()) lines.push(`About the user:\n${p.aboutYou.trim()}`);
  if (p?.howRespond?.trim()) lines.push(`How the user wants you to respond:\n${p.howRespond.trim()}`);
  const hints: string[] = [];
  if (creds.tavilyKey) hints.push('use web_search for current or factual web information and cite the sources');
  if (creds.models.image) hints.push('use generate_image when the user asks for an image, illustration, or diagram');
  if (hints.length) lines.push(`When helpful, ${hints.join('; ')}.`);
  if (skillsSection) lines.push(skillsSection);
  return lines.join('\n\n');
}

/** Responses turns: system + the user/assistant history (excluding soft-deleted rows and the
 *  assistant message this run is producing). */
function buildTurns(system: string, messages: MessageRecord[], assistantMessageId: string): Turn[] {
  const turns: Turn[] = [{ role: 'system', text: system }];
  for (const m of messages) {
    if (m.deletedAt || m.id === assistantMessageId) continue;
    if (m.role === 'user' || m.role === 'assistant') turns.push({ role: m.role, text: m.content });
  }
  return turns;
}

/** Tools offered to the model this run. web_search needs a Tavily key; file_search needs the
 *  thread's vector store. The built-ins (code_interpreter, file_search) are only offered when the
 *  client explicitly requests them in `run.tools` (the client has probed endpoint capability), so
 *  an endpoint that lacks them is never sent an unsupported tool. With no allowlist (older clients)
 *  we default to web search only. */
function assembleTools(
  creds: DecryptedCredentials,
  run: { tools: string[] },
  thread: { vectorStoreId?: string; files?: ThreadFileMeta[] } | null,
): ResponsesTool[] {
  const requested = run.tools.length > 0 ? new Set(run.tools) : null;
  const wants = (name: string): boolean =>
    requested === null ? name === 'web_search' : requested.has(name);

  const tools: ResponsesTool[] = [];
  if (wants('web_search') && creds.tavilyKey) {
    tools.push({
      type: 'function',
      name: 'web_search',
      description:
        'Search the web for current, factual information. Returns titles, URLs, and snippets.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query.' } },
        required: ['query'],
        additionalProperties: false,
      },
    });
  }
  if (wants('code_interpreter')) {
    // Mount the thread's uploaded documents into the sandbox so code can read them (e.g. extract
    // a PDF). `purpose=assistants` uploads expose their fileId here.
    const fileIds = (thread?.files ?? [])
      .filter((f) => (f.kind ?? 'document') === 'document' && f.status === 'ready')
      .map((f) => f.fileId);
    tools.push({
      type: 'code_interpreter',
      container: { type: 'auto', ...(fileIds.length ? { file_ids: fileIds } : {}) },
    });
  }
  // file_search: search the thread's store (auto-enabled whenever it exists — the user uploaded
  // docs) plus an optional account-wide knowledge base as a fallback. The account store alone only
  // engages when the client explicitly requested file_search (capability-probed).
  const storeIds = [thread?.vectorStoreId, creds.knowledgeBaseVectorStoreId].filter(
    (x): x is string => !!x,
  );
  if (storeIds.length && (thread?.vectorStoreId || wants('file_search'))) {
    tools.push({ type: 'file_search', vector_store_ids: storeIds });
  }
  if (wants('generate_image') && creds.models.image) {
    tools.push({
      type: 'function',
      name: 'generate_image',
      description:
        'Generate an image from a text description. Use when the user asks for an image, illustration, diagram, logo, or picture.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'A detailed description of the image to generate.' },
          size: { type: 'string', description: 'Optional size, e.g. 1024x1024, 1024x1536, or 1536x1024.' },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
    });
  }
  return tools;
}

/** The tool executor: runs function tools server-side and returns output + grounding citations. */
function makeExecute(creds: DecryptedCredentials, fetchImpl?: typeof fetch): ToolExecute {
  return async (name, args) => {
    if (name === 'web_search') {
      if (!creds.tavilyKey) return { output: 'Web search is not configured.' };
      const query = String((args as { query?: unknown }).query ?? '').trim();
      if (!query) return { output: 'No search query was provided.' };
      const r = await tavilySearch(query, { key: creds.tavilyKey, fetchImpl });
      const citations: ResponsesCitation[] = r.results.map((x) => ({
        source: 'web',
        url: x.url,
        title: x.title,
        ...(x.content ? { content: x.content.slice(0, 1000) } : {}),
        ...(x.favicon ? { favicon: x.favicon } : {}),
      }));
      const body = r.results
        .map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${(x.content ?? '').slice(0, 500)}`)
        .join('\n\n');
      const output = (r.answer ? `Answer: ${r.answer}\n\n` : '') + body;
      return { output, citations };
    }
    if (name === 'generate_image') {
      if (!creds.models.image) return { output: 'Image generation is not configured.' };
      const prompt = String((args as { prompt?: unknown }).prompt ?? '').trim();
      if (!prompt) return { output: 'No image prompt was provided.' };
      const sizeArg = (args as { size?: unknown }).size;
      const size = typeof sizeArg === 'string' && sizeArg ? sizeArg : undefined;
      const imgs = await generateImage({
        baseUrl: creds.baseUrl,
        key: creds.key,
        model: creds.models.image,
        prompt,
        ...(size ? { size } : {}),
        fetchImpl,
      });
      if (!imgs.length) return { output: 'No image was generated.' };
      return {
        output: 'Generated the requested image.',
        image: { b64: imgs[0].b64, prompt, ...(size ? { size } : {}) },
      };
    }
    return { output: `Unknown tool: ${name}` };
  };
}

function toolKind(name: string): MessageToolCall['kind'] {
  if (name === 'web_search') return 'web_search';
  if (name === 'code_interpreter') return 'code_interpreter';
  if (name === 'file_search') return 'file_search';
  if (name === 'generate_image') return 'image';
  return 'function';
}

/** Decode a base64 image payload to bytes for upload. */
function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Generate a concise 3-6 word title from the first exchange (mirrors the in-browser titler).
 *  Returns the cleaned title, or the start of the user's prompt as a fallback. */
async function generateTitle(
  creds: DecryptedCredentials,
  firstUser: string,
  answer: string,
  fetchImpl?: typeof fetch,
): Promise<string | undefined> {
  const fallback = firstUser.trim().slice(0, 40) || undefined;
  const raw = await completeChat({
    baseUrl: creds.baseUrl,
    key: creds.key,
    model: creds.models.chat,
    maxCompletionTokens: 1000,
    reasoningEffort: 'minimal',
    fetchImpl,
    messages: [
      {
        role: 'system',
        content:
          'You write a concise, specific 3-6 word title for a chat conversation. ' +
          'Output ONLY the title text — no quotes, no trailing punctuation, no preamble.',
      },
      {
        role: 'user',
        content: `Title this conversation:\n\nUser: ${firstUser.slice(0, 600)}\n\nAssistant: ${answer.slice(0, 600)}`,
      },
    ],
  });
  const clean = raw.replace(/^["'\s]+|["'\s.]+$/g, '').split('\n')[0].slice(0, 60);
  return clean || fallback;
}

function mapCitation(c: ResponsesCitation): MessageCitation {
  return {
    ...(c.source ? { source: c.source } : {}),
    ...(c.url ? { url: c.url } : {}),
    ...(c.title ? { title: c.title } : {}),
    ...(c.content ? { content: c.content.slice(0, 4000) } : {}),
    ...(c.favicon ? { favicon: c.favicon } : {}),
    ...(c.fileId ? { fileId: c.fileId } : {}),
    ...(c.filename ? { filename: c.filename } : {}),
    ...(c.startIndex !== undefined ? { startIndex: c.startIndex } : {}),
    ...(c.endIndex !== undefined ? { endIndex: c.endIndex } : {}),
  };
}

/**
 * Process one run end-to-end on the server, independently of any client: load the user's decrypted
 * credentials, assemble the history, run the agentic loop (Responses API — text + web search + any
 * future tools), and upsert the assistant message into Cosmos incrementally (text, tool cards,
 * citations) — finalizing it `complete` / `error` / `interrupted` and releasing the run. Because
 * this runs in a queue worker (not the request), closing the app cannot interrupt it. Idempotent:
 * a redelivered message that finds a terminal/canceled run is a no-op.
 */
export async function processRun(deps: RunWorkerDeps, threadId: string, runId: string): Promise<void> {
  const { runStore, messageStore, threadStore, credentials, clock } = deps;
  const runAgent = deps.runAgent ?? defaultRunAgent;
  const flushMs = deps.flushIntervalMs ?? DEFAULT_FLUSH_MS;

  const run = await runStore.get(threadId, runId);
  if (!run || !isActive(run.status)) return; // already finalized / canceled — idempotent

  await runStore.put({ ...run, status: 'running', startedAt: clock.now(), heartbeatAt: clock.now() });

  const thread = await threadStore.get(run.userId, threadId);
  const orderAt = run.createdAt;
  const toolCalls = new Map<string, MessageToolCall>();
  const citations: MessageCitation[] = [];
  const seenCitations = new Set<string>();
  const images: MessageImage[] = [];
  const artifacts: MessageArtifact[] = [];
  const seenArtifactFiles = new Set<string>();
  /** The most recent code-interpreter container seen this run (for an end-of-run capture fallback). */
  let ciSeen: { id: string; callId: string } | undefined;
  /** Artifacts generated this run (images + code-interpreter files) for the thread file list. */
  const generatedFiles: ThreadFileMeta[] = [];
  let acc = '';
  let lastFlush = 0;
  let flushed = false;
  let err: { code: string; message: string } | undefined;
  let model: string | undefined;
  let creds: DecryptedCredentials | undefined;
  let firstUser = '';

  const buildAssistant = (status: MessageRecord['status']): MessageRecord => ({
    id: run.assistantMessageId,
    threadId,
    userId: run.userId,
    role: 'assistant',
    content: acc,
    status,
    createdAt: orderAt,
    orderAt,
    deletedAt: null,
    ...(model ? { model } : {}),
    ...(toolCalls.size ? { toolCalls: [...toolCalls.values()] } : {}),
    ...(citations.length ? { citations } : {}),
    ...(images.length ? { images } : {}),
    ...(artifacts.length ? { artifacts } : {}),
  });

  const flush = async (force = false): Promise<void> => {
    const now = Date.now();
    if (force || !flushed || now - lastFlush > flushMs) {
      flushed = true;
      lastFlush = now;
      const snapshot = buildAssistant('streaming');
      await messageStore.append(snapshot);
      if (deps.signalr) await deps.signalr.sendToUser(run.userId, 'message', { threadId, message: snapshot });
    }
  };

  /** Capture files the code interpreter wrote to its container: list the container, download each
   *  new assistant-sourced file, persist it to Blob Storage, and record it as an artifact on the
   *  message + thread. Best-effort — failures never fail the run. */
  const captureArtifacts = async (containerId: string, toolCallId: string): Promise<void> => {
    if (!creds || !deps.uploadArtifact) {
      console.warn('[artifacts] skipped', { hasCreds: !!creds, hasUploadArtifact: !!deps.uploadArtifact });
      return;
    }
    let files;
    try {
      files = await listContainerFiles(creds, containerId, deps.fetchImpl);
    } catch (e) {
      console.error('[artifacts] listContainerFiles failed', containerId, e instanceof Error ? e.message : String(e));
      return;
    }
    console.log('[artifacts] listed container files', {
      containerId,
      count: files.length,
      items: files.map((f) => `${f.source ?? '?'}:${f.filename ?? f.path ?? f.id}`),
    });
    for (const f of files) {
      if (f.source !== 'assistant' || seenArtifactFiles.has(f.id)) continue;
      if (artifacts.length >= MAX_ARTIFACTS) break;
      const name = ((f.filename || f.path || 'artifact').split('/').pop() || 'artifact').slice(0, 400);
      const mime = mimeForFilename(name);
      if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(mime)) {
        console.warn('[artifacts] skipped (mime not allowed)', { name, mime });
        continue;
      }
      seenArtifactFiles.add(f.id);
      try {
        const bytes = await getContainerFile(creds, containerId, f.id, deps.fetchImpl);
        if (!bytes.byteLength || bytes.byteLength > MAX_ARTIFACT_BYTES) {
          console.warn('[artifacts] skipped (size)', { name, bytes: bytes.byteLength });
          continue;
        }
        const artifactId = `art${artifacts.length + 1}-${run.assistantMessageId}`.slice(0, 64);
        const blobPath = await deps.uploadArtifact(run.userId, threadId, artifactId, bytes, mime);
        artifacts.push({
          id: artifactId,
          name,
          mime,
          kind: artifactKindForMime(mime),
          bytes: bytes.byteLength,
          blobPath,
          sourceToolCallId: toolCallId,
          createdAt: clock.now(),
        });
        generatedFiles.push({
          fileId: artifactId,
          name: name.slice(0, 80),
          bytes: bytes.byteLength,
          status: 'ready',
          createdAt: clock.now(),
          kind: 'artifact',
          blobPath,
          mime,
        });
        const tc = toolCalls.get(toolCallId);
        if (tc) toolCalls.set(toolCallId, { ...tc, artifactIds: [...(tc.artifactIds ?? []), artifactId] });
        console.log('[artifacts] persisted', { name, mime, bytes: bytes.byteLength, blobPath });
        await flush(true);
      } catch (e) {
        console.error('[artifacts] persist failed', name, e instanceof Error ? e.message : String(e));
      }
    }
  };

  try {
    const c = await credentials.getDecrypted(run.userId);
    creds = c;
    model = c.models.chat;
    const settings = deps.settings
      ? await deps.settings.get(run.userId).catch(() => undefined)
      : undefined;
    const history = await messageStore.list(threadId);
    firstUser = history.find((m) => !m.deletedAt && m.role === 'user')?.content ?? '';
    const codeOn = run.tools.includes('code_interpreter');
    const ciSection = codeOn ? codeInterpreterSection(selectSkills(run.prompt?.text ?? firstUser)) : '';
    const turns = buildTurns(systemPrompt(c, settings, ciSection), history, run.assistantMessageId);
    const tools = assembleTools(c, run, thread);
    const execute = makeExecute(c, deps.fetchImpl);

    for await (const ev of runAgent({ baseUrl: c.baseUrl, key: c.key, model, turns, tools, execute })) {
      if (ev.type === 'text') {
        acc += ev.delta;
        await flush();
      } else if (ev.type === 'tool') {
        const id = ev.callId ?? ev.name;
        const prev = toolCalls.get(id);
        const kind = toolKind(ev.name);
        toolCalls.set(id, {
          ...prev,
          id,
          kind,
          name: ev.name,
          status: ev.status,
          ...(ev.detail ? { summary: ev.detail.slice(0, 400) } : {}),
          ...(ev.result ? { resultPreview: ev.result.slice(0, 4000) } : {}),
          // Carry the requested image size so the client can show an aspect-correct placeholder
          // while the image generates (the size only rides on the initial `running` event).
          ...(kind === 'image' && typeof ev.args?.size === 'string'
            ? { imageSize: ev.args.size.slice(0, 32) }
            : {}),
        });
        await flush(true);
        // Track the code-interpreter container; capture its files when the call completes.
        if (ev.name === 'code_interpreter' && ev.containerId) {
          ciSeen = { id: ev.containerId, callId: id };
          if (ev.status === 'done') await captureArtifacts(ev.containerId, id);
        } else if (ev.name === 'code_interpreter' && ev.status === 'done') {
          console.warn('[artifacts] code_interpreter done with no containerId on the event');
        }
      } else if (ev.type === 'citation') {
        const c = ev.citation;
        const key = c.url ?? c.fileId ?? c.title ?? '';
        if (key && !seenCitations.has(key)) {
          seenCitations.add(key);
          citations.push(mapCitation(c));
          await flush(true);
        }
      } else if (ev.type === 'image' && !ev.partial && deps.uploadImage) {
        try {
          const imageId = `img${images.length + 1}-${run.assistantMessageId}`.slice(0, 64);
          const bytes = b64ToBytes(ev.b64);
          const blobPath = await deps.uploadImage(
            run.userId,
            threadId,
            imageId,
            bytes,
            'image/png',
          );
          images.push({
            id: imageId,
            blobPath,
            prompt: ev.prompt ?? '',
            size: ev.size ?? '1024x1024',
            outputFormat: 'png',
            createdAt: clock.now(),
          });
          // Surface the generated image in the thread's file list (synced across devices).
          generatedFiles.push({
            fileId: imageId,
            name: (ev.prompt?.trim() || 'Generated image').slice(0, 80),
            bytes: bytes.byteLength,
            status: 'ready',
            createdAt: clock.now(),
            kind: 'image',
            blobPath,
            mime: 'image/png',
          });
          // The image landed — mark its tool call done so the placeholder yields to the real image
          // in the same snapshot (no brief placeholder-plus-image overlap).
          if (ev.callId) {
            const tc = toolCalls.get(ev.callId);
            if (tc) toolCalls.set(ev.callId, { ...tc, status: 'done' });
          }
          await flush(true);
        } catch {
          /* image upload failed -> the text answer still completes without it */
        }
      } else if (ev.type === 'error') {
        err = { code: 'internal', message: ev.message };
      }
    }
    // Fallback: a code-interpreter container was seen but produced no captured artifact (e.g. the
    // file landed after the done event) — try once more before finalizing.
    if (ciSeen && artifacts.length === 0) {
      console.log('[artifacts] end-of-run fallback capture', { containerId: ciSeen.id });
      await captureArtifacts(ciSeen.id, ciSeen.callId);
    }
  } catch (e) {
    err = { code: 'internal', message: e instanceof Error ? e.message : 'Generation failed.' };
  }

  // A cancel may have landed while we streamed — re-read the run before finalizing.
  const current = await runStore.get(threadId, runId);
  const canceled = current?.status === 'canceled';

  // Auto-name the thread from the first exchange while the message is still 'streaming', so the
  // client's terminal sync picks up the reply and the new title together.
  let newTitle: string | undefined;
  if (!err && !canceled && creds && thread && acc.trim() && (!thread.title || thread.title === 'New chat')) {
    newTitle = await generateTitle(creds, firstUser, acc, deps.fetchImpl);
  }

  const finalStatus: MessageRecord['status'] = canceled ? 'interrupted' : err ? 'error' : 'complete';
  const finalMessage = buildAssistant(finalStatus);
  await messageStore.append(finalMessage);
  if (deps.signalr) await deps.signalr.sendToUser(run.userId, 'message', { threadId, message: finalMessage });

  // Bump the thread so the assistant message syncs and the thread surfaces as recently active.
  if (thread) {
    const nextThread = {
      ...thread,
      ...(newTitle ? { title: newTitle } : {}),
      ...(generatedFiles.length
        ? { files: [...(thread.files ?? []), ...generatedFiles] }
        : {}),
      lastMessagePreview: (acc.trim() || (err ? 'Error' : '')).slice(0, 140),
      updatedAt: clock.now(),
    };
    await threadStore.put(nextThread);
    if (deps.signalr)
      await deps.signalr.sendToUser(run.userId, 'thread', {
        thread: {
          id: nextThread.id,
          title: nextThread.title,
          lastMessagePreview: nextThread.lastMessagePreview,
          updatedAt: nextThread.updatedAt,
        },
      });
  }

  if (!canceled) {
    await runStore.put({
      ...run,
      status: err ? 'error' : 'complete',
      error: err ?? null,
      startedAt: run.startedAt ?? orderAt,
      endedAt: clock.now(),
    });
  }
}
