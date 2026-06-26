import { isActive } from '../domain/run';
import type { ServiceClock } from './threadService';
import type { DecryptedCredentials } from './credentialService';
import type { RunStore } from '../ports/runStore';
import type { MessageRecord, MessageStore } from '../ports/messageStore';
import type { ThreadStore } from '../ports/threadStore';
import type { ChatMessage, ChatStreamEvent, StreamChatParams } from '../ai/chat';

export interface CredentialReader {
  getDecrypted(userId: string): Promise<DecryptedCredentials>;
}

export interface RunWorkerDeps {
  runStore: RunStore;
  messageStore: MessageStore;
  threadStore: ThreadStore;
  credentials: CredentialReader;
  streamChat: (p: StreamChatParams) => AsyncGenerator<ChatStreamEvent>;
  clock: ServiceClock;
  /** ms between throttled incremental message upserts (default 700). */
  flushIntervalMs?: number;
}

const DEFAULT_FLUSH_MS = 250;

/** Thread history for the model: user/assistant turns only, excluding soft-deleted rows and the
 *  assistant message this run is producing. */
function toHistory(messages: MessageRecord[], assistantMessageId: string): ChatMessage[] {
  return messages
    .filter(
      (m) =>
        !m.deletedAt &&
        m.id !== assistantMessageId &&
        (m.role === 'user' || m.role === 'assistant'),
    )
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

/**
 * Process one run end-to-end on the server, independently of any client: load the user's
 * decrypted credentials, assemble the thread history, stream a chat completion from Azure OpenAI,
 * and upsert the assistant message into Cosmos incrementally — finalizing it
 * `complete` / `error` / `interrupted` and releasing the run. Because this runs in a
 * queue/Durable worker (not the request), closing the app cannot interrupt it. Idempotent: a
 * redelivered message that finds a terminal/canceled run is a no-op.
 */
export async function processRun(deps: RunWorkerDeps, threadId: string, runId: string): Promise<void> {
  const { runStore, messageStore, threadStore, credentials, streamChat, clock } = deps;
  const flushMs = deps.flushIntervalMs ?? DEFAULT_FLUSH_MS;

  const run = await runStore.get(threadId, runId);
  if (!run || !isActive(run.status)) return; // already finalized / canceled — idempotent

  await runStore.put({ ...run, status: 'running', startedAt: clock.now(), heartbeatAt: clock.now() });

  const orderAt = run.createdAt;
  const buildAssistant = (
    content: string,
    status: MessageRecord['status'],
    model?: string,
  ): MessageRecord => ({
    id: run.assistantMessageId,
    threadId,
    userId: run.userId,
    role: 'assistant',
    content,
    status,
    createdAt: orderAt,
    orderAt,
    deletedAt: null,
    ...(model ? { model } : {}),
  });

  let acc = '';
  let lastFlush = 0;
  let flushed = false;
  let err: { code: string; message: string } | undefined;
  let model: string | undefined;

  try {
    const creds = await credentials.getDecrypted(run.userId);
    model = creds.models.chat;
    const history = toHistory(await messageStore.list(threadId), run.assistantMessageId);

    for await (const ev of streamChat({ baseUrl: creds.baseUrl, key: creds.key, model, messages: history })) {
      if (ev.type === 'delta' && ev.textDelta) {
        acc += ev.textDelta;
        const now = Date.now();
        if (!flushed || now - lastFlush > flushMs) {
          flushed = true;
          lastFlush = now;
          await messageStore.append(buildAssistant(acc, 'streaming', model));
        }
      } else if (ev.type === 'error') {
        err = ev.error;
      }
    }
  } catch (e) {
    err = { code: 'internal', message: e instanceof Error ? e.message : 'Generation failed.' };
  }

  // A cancel may have landed while we streamed — re-read the run before finalizing.
  const current = await runStore.get(threadId, runId);
  const canceled = current?.status === 'canceled';

  const finalStatus: MessageRecord['status'] = canceled ? 'interrupted' : err ? 'error' : 'complete';
  await messageStore.append(buildAssistant(acc, finalStatus, model));

  // Bump the thread so the assistant message syncs and the thread surfaces as recently active.
  const thread = await threadStore.get(run.userId, threadId);
  if (thread) {
    await threadStore.put({
      ...thread,
      lastMessagePreview: (acc.trim() || (err ? 'Error' : '')).slice(0, 140),
      updatedAt: clock.now(),
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
