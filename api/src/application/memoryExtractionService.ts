import { createHash } from 'node:crypto';
import type { MemoryExtractionOutput } from '../domain/memoryExtraction';
import { parseMemoryExtractionJobRecord } from '../domain/memoryExtraction';
import { parseMemoryRecord, type MemoryRecord, type MemorySourceRef } from '../domain/memory';
import { effectiveMemorySettings, type Settings } from '../domain/settings';
import type { DecryptedCredentials } from './credentialService';
import type { MemoryStore } from '../ports/memoryStore';
import type { MemoryJobStore } from '../ports/memoryJobStore';
import type { MessageRecord, MessageStore } from '../ports/messageStore';
import type { ThreadRecord, ThreadStore } from '../ports/threadStore';
import type { ServiceClock } from './threadService';
import type { SignalRSender } from '../adapters/azure/signalr';
import type { Embedder } from '../ports/embedder';

export interface MemoryQueuePort {
  enqueue(job: import('../domain/memoryExtraction').MemoryExtractionJobRecord): Promise<void>;
}

export type MemoryExtractorPort = (creds: DecryptedCredentials, input: {
  mode: 'command' | 'turn' | 'rebuild';
  now: string;
  threadId: string;
  threadTitle?: string;
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string }>;
  existingMemories: Array<{ id: string; kind: string; status: string; text: string; entities?: string[]; topics?: string[]; validAt?: string; invalidAt?: string }>;
}) => Promise<MemoryExtractionOutput>;

export interface MemorySettingsReader {
  get(userId: string): Promise<Settings>;
}

export interface MemoryCredentialReader {
  getDecrypted(userId: string): Promise<DecryptedCredentials>;
}

export interface MemoryExtractionDeps {
  memoryStore: MemoryStore;
  jobStore: MemoryJobStore;
  messageStore: MessageStore;
  threadStore: ThreadStore;
  queue: MemoryQueuePort;
  settings: MemorySettingsReader;
  credentials: MemoryCredentialReader;
  extractor: MemoryExtractorPort;
  embedder?: Embedder;
  signalr?: SignalRSender;
  clock: ServiceClock;
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function sourceHash(text: string, kind: string, entities: string[] = []): string {
  return createHash('sha256').update(`${normalizeText(text)}\n${kind}\n${[...entities].sort().join('|')}`).digest('hex');
}

function chrono(message: MessageRecord): string {
  return message.orderAt ?? message.createdAt;
}

function commandDedupe(userMessageId: string): string {
  return `memory-command:${userMessageId}`;
}

function turnDedupe(assistantMessageId: string): string {
  return `memory-turn:${assistantMessageId}`;
}

/** Mechanical floor: a window/message with less than this many non-space characters is too trivial
 *  to be worth an extraction call. This is hygiene only — it never judges meaning. */
const MIN_MEANINGFUL_CHARS = 3;

async function embedFor(
  embedder: { embed: (text: string) => Promise<number[]>; model: string } | undefined,
  text: string,
): Promise<{ embedding: number[]; model: string } | null> {
  if (!embedder) return null;
  try {
    const embedding = await embedder.embed(text);
    return embedding.length ? { embedding, model: embedder.model } : null;
  } catch {
    return null;
  }
}

export class MemoryExtractionService {
  constructor(private readonly deps: MemoryExtractionDeps) {}

  private async eligible(userId: string, threadId: string): Promise<ThreadRecord | null> {
    const thread = await this.deps.threadStore.get(userId, threadId);
    if (!thread || thread.deletedAt || thread.temporary) return null;
    const settings = effectiveMemorySettings(await this.deps.settings.get(userId));
    if (!settings.enabled || settings.paused || !settings.autoExtract || !settings.referenceHistory) return null;
    return thread;
  }

  async enqueueCommand(userId: string, threadId: string, userMessageId: string, runId?: string): Promise<import('../domain/memoryExtraction').MemoryExtractionJobRecord | null> {
    const thread = await this.eligible(userId, threadId);
    if (!thread) return null;
    const msg = await this.deps.messageStore.get(threadId, userMessageId);
    if (!msg || msg.userId !== userId || msg.role !== 'user' || msg.content.trim().length < MIN_MEANINGFUL_CHARS) return null;
    return this.enqueueJob(userId, threadId, 'command', commandDedupe(userMessageId), { userMessageId, runId });
  }

  async enqueueTurn(userId: string, threadId: string, assistantMessageId: string, runId?: string): Promise<import('../domain/memoryExtraction').MemoryExtractionJobRecord | null> {
    const thread = await this.eligible(userId, threadId);
    if (!thread) return null;
    const msg = await this.deps.messageStore.get(threadId, assistantMessageId);
    if (!msg || msg.userId !== userId || msg.role !== 'assistant' || msg.status !== 'complete') return null;
    const window = await this.messagesAround(threadId, assistantMessageId);
    if (!window.some((message) => message.role === 'user' && message.content.trim().length >= MIN_MEANINGFUL_CHARS)) return null;
    return this.enqueueJob(userId, threadId, 'turn', turnDedupe(assistantMessageId), { assistantMessageId, runId });
  }

  async enqueueAfterMessage(record: MessageRecord): Promise<void> {
    // Single post-reply lane: the completed assistant turn carries the full exchange, the richest
    // context for the extractor's write decision. The user-message lane is intentionally not fired
    // here, so an exchange produces exactly one extraction job (no duplicate work or notices).
    if (record.role === 'assistant' && record.status === 'complete') {
      await this.enqueueTurn(record.userId, record.threadId, record.id).catch(() => null);
    }
  }

  private async enqueueJob(
    userId: string,
    threadId: string,
    kind: 'command' | 'turn',
    dedupeKey: string,
    ids: { userMessageId?: string; assistantMessageId?: string; runId?: string },
  ) {
    const existing = await this.deps.jobStore.getByDedupeKey(userId, dedupeKey);
    if (existing && existing.status !== 'failed') return existing;
    const ts = this.deps.clock.now();
    const job = parseMemoryExtractionJobRecord({
      id: existing?.id ?? this.deps.clock.newId(),
      userId,
      threadId,
      kind,
      status: 'queued',
      ...ids,
      dedupeKey,
      attempts: existing ? existing.attempts + 1 : 0,
      createdAt: existing?.createdAt ?? ts,
      updatedAt: ts,
    });
    await this.deps.jobStore.put(job);
    await this.deps.queue.enqueue(job);
    return job;
  }

  async processJob(userId: string, jobId: string): Promise<void> {
    const job = await this.deps.jobStore.get(userId, jobId);
    if (!job) return;
    const ts = this.deps.clock.now();
    await this.deps.jobStore.put({ ...job, status: 'running', attempts: job.attempts + 1, updatedAt: ts });
    try {
      const thread = await this.eligible(job.userId, job.threadId);
      if (!thread) return await this.finish(job, 'ignored', { ignore: 1 }, 0, 0);
      const messages = await this.windowFor(job);
      if (!messages.length) return await this.finish(job, 'ignored', { ignore: 1 }, 0, 0);
      const creds = await this.deps.credentials.getDecrypted(job.userId);
      const embedder = this.deps.embedder
        ? { embed: (text: string) => this.deps.embedder!.embed(creds, text), model: this.deps.embedder.model }
        : undefined;
      const candidates = (await this.deps.memoryStore.list(job.userId, { status: 'active', limit: 20 })).memories;
      const out = await this.deps.extractor(creds, {
        mode: job.kind,
        now: this.deps.clock.now(),
        threadId: job.threadId,
        threadTitle: thread.title,
        messages: messages.map((m) => ({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content.slice(0, 4096), createdAt: chrono(m) })),
        existingMemories: candidates.map((m) => ({ id: m.id, kind: m.kind, status: m.status, text: m.text, entities: m.entities, topics: m.topics, validAt: m.validAt, invalidAt: m.invalidAt })),
      });
      const result = await this.applyOperations(job.userId, job.threadId, job.kind, messages, candidates, out, embedder);
      await this.finish(job, result.accepted > 0 ? 'completed' : 'ignored', result.counts, result.accepted, result.rejected);
    } catch (e) {
      await this.deps.jobStore.put({
        ...job,
        status: 'failed',
        attempts: job.attempts + 1,
        lastErrorCode: 'extract_failed',
        lastErrorMessage: e instanceof Error ? e.message.slice(0, 400) : 'Memory extraction failed.',
        updatedAt: this.deps.clock.now(),
      });
      throw e;
    }
  }

  private async finish(
    job: import('../domain/memoryExtraction').MemoryExtractionJobRecord,
    status: 'completed' | 'ignored',
    counts: Partial<Record<'add' | 'merge' | 'invalidate' | 'suppress' | 'ignore', number>>,
    accepted: number,
    rejected: number,
  ): Promise<void> {
    const ts = this.deps.clock.now();
    await this.deps.jobStore.put({
      ...job,
      status,
      operationCounts: { add: counts.add ?? 0, merge: counts.merge ?? 0, invalidate: counts.invalidate ?? 0, suppress: counts.suppress ?? 0, ignore: counts.ignore ?? 0 },
      acceptedCount: accepted,
      rejectedCount: rejected,
      updatedAt: ts,
      completedAt: ts,
    });
    if (accepted > 0 && this.deps.signalr) {
      await this.deps.signalr
        .sendToUser(job.userId, 'memory', {
          jobId: job.id,
          threadId: job.threadId,
          kind: job.kind,
          acceptedCount: accepted,
          updatedAt: ts,
        })
        .catch(() => undefined);
    }
  }

  private async windowFor(job: import('../domain/memoryExtraction').MemoryExtractionJobRecord): Promise<MessageRecord[]> {
    return this.messagesAround(job.threadId, job.assistantMessageId ?? job.userMessageId);
  }

  private async messagesAround(threadId: string, targetId?: string): Promise<MessageRecord[]> {
    const all = (await this.deps.messageStore.list(threadId))
      .filter((m) => !m.deletedAt && (m.role === 'user' || m.role === 'assistant'))
      .sort((a, b) => chrono(a).localeCompare(chrono(b)));
    const index = all.findIndex((m) => m.id === targetId);
    if (index < 0) return [];
    return all.slice(Math.max(0, index - 4), index + 1);
  }

  private sourceRefs(threadId: string, messages: MessageRecord[], ids: string[]): MemorySourceRef[] | null {
    const refs: MemorySourceRef[] = [];
    for (const id of ids) {
      const msg = messages.find((m) => m.id === id);
      if (!msg) return null;
      refs.push({ type: 'message', threadId, messageId: msg.id, quote: msg.content.slice(0, 500), createdAt: chrono(msg) });
    }
    return refs;
  }

  private async applyOperations(
    userId: string,
    threadId: string,
    mode: 'command' | 'turn' | 'rebuild',
    messages: MessageRecord[],
    candidates: MemoryRecord[],
    output: MemoryExtractionOutput,
    embedder?: { embed: (text: string) => Promise<number[]>; model: string },
  ): Promise<{ counts: Partial<Record<'add' | 'merge' | 'invalidate' | 'suppress' | 'ignore', number>>; accepted: number; rejected: number }> {
    const counts: Partial<Record<'add' | 'merge' | 'invalidate' | 'suppress' | 'ignore', number>> = {};
    let accepted = 0;
    let rejected = 0;
    for (const op of output.operations) {
      counts[op.op] = (counts[op.op] ?? 0) + 1;
      try {
        if (op.op === 'ignore') continue;
        const refs = this.sourceRefs(threadId, messages, op.sourceMessageIds);
        if (!refs) { rejected++; continue; }
        if (op.op === 'add') {
          const minConfidence = mode === 'command' ? 0.65 : 0.82;
          const minSalience = mode === 'command' ? 0.4 : 0.65;
          if (op.confidence < minConfidence || op.salience < minSalience) { rejected++; continue; }
          const hash = sourceHash(op.text, op.kind, op.entities);
          const duplicate = candidates.find((m) => m.sourceHash === hash && m.status === 'active');
          if (duplicate) {
            await this.mergeMemory(duplicate, refs, op.confidence, op.salience, undefined, undefined, undefined, op.target, embedder);
          } else {
            const id = this.deps.clock.newId();
            for (const oldId of op.supersedes ?? []) await this.invalidateMemory(userId, oldId, id);
            const embedded = await embedFor(embedder, op.text);
            await this.deps.memoryStore.put(parseMemoryRecord({
              id,
              userId,
              kind: op.kind,
              status: 'active',
              text: op.text,
              normalizedText: normalizeText(op.text),
              entities: op.entities,
              topics: op.topics,
              sourceRefs: refs,
              confidence: op.confidence,
              salience: op.salience,
              pinned: false,
              sensitive: false,
              sourceHash: hash,
              ...(op.target ? { route: op.target } : {}),
              ...(embedded ? { embedding: embedded.embedding, embeddingModel: embedded.model } : {}),
              visibility: op.salience >= 0.85 ? 'top_of_mind' : op.salience <= 0.35 ? 'background' : 'normal',
              validAt: op.validAt,
              createdAt: this.deps.clock.now(),
              updatedAt: this.deps.clock.now(),
              useCount: 0,
              supersedes: op.supersedes,
            }));
          }
          accepted++;
        } else if (op.op === 'merge') {
          const current = await this.deps.memoryStore.get(userId, op.memoryId);
          if (!current || current.status === 'deleted') { rejected++; continue; }
          await this.mergeMemory(current, refs, op.confidence, op.salience, op.text, op.entities, op.topics, op.target, embedder);
          accepted++;
        } else if (op.op === 'invalidate') {
          await this.invalidateMemory(userId, op.memoryId);
          accepted++;
        } else if (op.op === 'suppress') {
          const current = await this.deps.memoryStore.get(userId, op.memoryId);
          if (!current || current.status === 'deleted') { rejected++; continue; }
          await this.deps.memoryStore.put(parseMemoryRecord({ ...current, status: 'suppressed', updatedAt: this.deps.clock.now() }));
          accepted++;
        }
      } catch {
        rejected++;
      }
    }
    return { counts, accepted, rejected };
  }

  private async mergeMemory(memory: MemoryRecord, refs: MemorySourceRef[], confidence?: number, salience?: number, text?: string, entities?: string[], topics?: string[], route?: MemoryRecord['route'], embedder?: { embed: (text: string) => Promise<number[]>; model: string }): Promise<void> {
    const seen = new Set(memory.sourceRefs.map((r) => `${r.type}:${r.threadId}:${r.messageId}:${r.createdAt}`));
    const sourceRefs = [...memory.sourceRefs];
    for (const ref of refs) {
      const key = `${ref.type}:${ref.threadId}:${ref.messageId}:${ref.createdAt}`;
      if (!seen.has(key) && sourceRefs.length < 12) sourceRefs.push(ref);
    }
    const nextText = text ?? memory.text;
    const reembed = text && text !== memory.text ? await embedFor(embedder, nextText) : null;
    await this.deps.memoryStore.put(parseMemoryRecord({
      ...memory,
      text: nextText,
      normalizedText: normalizeText(nextText),
      entities: entities ?? memory.entities,
      topics: topics ?? memory.topics,
      sourceRefs,
      ...(route ? { route } : {}),
      ...(reembed ? { embedding: reembed.embedding, embeddingModel: reembed.model } : {}),
      confidence: Math.max(memory.confidence, confidence ?? memory.confidence),
      salience: Math.max(memory.salience, salience ?? memory.salience),
      updatedAt: this.deps.clock.now(),
    }));
  }

  private async invalidateMemory(userId: string, memoryId: string, supersededBy?: string): Promise<void> {
    const current = await this.deps.memoryStore.get(userId, memoryId);
    if (!current || current.status === 'deleted') return;
    await this.deps.memoryStore.put(parseMemoryRecord({
      ...current,
      status: 'invalidated',
      invalidAt: this.deps.clock.now(),
      ...(supersededBy ? { supersededBy } : {}),
      updatedAt: this.deps.clock.now(),
    }));
  }
}