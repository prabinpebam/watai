import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { MemoryExtractionOutput } from '../domain/memoryExtraction';
import { parseMemoryExtractionJobRecord } from '../domain/memoryExtraction';
import { hasCurrentMemoryEmbedding, memoryEmbeddingTextHash, usableMemoryVector, parseMemoryRecord, type MemoryRecord, type MemorySourceRef } from '../domain/memory';
import { effectiveMemoryPolicy, type Settings } from '../domain/settings';
import type { DecryptedCredentials } from './credentialService';
import { MemoryPublicationUnconfirmedError, type MemoryStore } from '../ports/memoryStore';
import { isCurrentMemoryJob, type MemoryJobStore } from '../ports/memoryJobStore';
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
  contained?: () => boolean;
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

function messageRevision(message: MessageRecord): string {
  return createHash('sha256').update(`${message.id}\n${message.createdAt}\n${message.content}`).digest('hex');
}

function commandDedupe(userMessageId: string, sourceRevision: string): string {
  return `memory-command:${userMessageId}:${sourceRevision.slice(0, 24)}`;
}

function turnDedupe(assistantMessageId: string, sourceRevision: string): string {
  return `memory-turn:${assistantMessageId}:${sourceRevision.slice(0, 24)}`;
}

/** Mechanical floor: a window/message with less than this many non-space characters is too trivial
 *  to be worth an extraction call. This is hygiene only — it never judges meaning. */
const MIN_MEANINGFUL_CHARS = 3;

/** How many trailing messages of the thread to pass to the extractor as context. The extractor needs
 *  the threaded conversation — not just the latest turn — to attribute statements correctly (e.g. to
 *  tell the user's own facts apart from content they are authoring for someone else, like a child's
 *  speech). Capped to bound token cost on very long threads. */
const CONTEXT_WINDOW_MESSAGES = 40;

async function embedFor(
  embedder: { embed: (text: string) => Promise<number[]>; model: string } | undefined,
  text: string,
  allowed: () => Promise<boolean> = async () => true,
): Promise<{ embedding: number[]; model: string; textHash: string } | null> {
  if (!embedder) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!(await allowed())) return null;
    try {
      const embedding = await embedder.embed(text);
      return usableMemoryVector(embedding) ? { embedding, model: embedder.model, textHash: memoryEmbeddingTextHash(text) } : null;
    } catch {
      if (attempt === 1) console.warn('[memory] write embed failed after retry');
    }
  }
  return null;
}

export class MemoryExtractionService {
  constructor(
    private readonly deps: MemoryExtractionDeps,
    private readonly releaseId = process.env.WATAI_RELEASE_ID?.trim() || 'local-development',
  ) {}

  private async eligible(userId: string, threadId: string): Promise<ThreadRecord | null> {
    if (this.deps.contained?.()) return null;
    const thread = await this.deps.threadStore.get(userId, threadId);
    if (!thread || thread.userId !== userId || thread.id !== threadId || thread.deletedAt || thread.temporary) return null;
    const settings = effectiveMemoryPolicy(await this.deps.settings.get(userId));
    if (settings.learnChats !== 'automatic') return null;
    return thread;
  }

  private async learningAllowed(userId: string): Promise<boolean> {
    if (this.deps.contained?.()) return false;
    const current = await this.deps.settings.get(userId).catch(() => undefined);
    if (!current) return false;
    return effectiveMemoryPolicy(current).learnChats === 'automatic';
  }

  async enqueueCommand(userId: string, threadId: string, userMessageId: string, runId?: string): Promise<import('../domain/memoryExtraction').MemoryExtractionJobRecord | null> {
    const thread = await this.eligible(userId, threadId);
    if (!thread) return null;
    const msg = await this.deps.messageStore.get(userId, threadId, userMessageId);
    if (!msg || msg.userId !== userId || msg.threadId !== threadId || msg.id !== userMessageId || msg.deletedAt ||
      msg.role !== 'user' || msg.content.trim().length < MIN_MEANINGFUL_CHARS) return null;
    const sourceRevision = messageRevision(msg);
    return this.enqueueJob(userId, threadId, 'command', commandDedupe(userMessageId, sourceRevision), { userMessageId, runId, sourceRevision });
  }

  async enqueueTurn(userId: string, threadId: string, assistantMessageId: string, runId?: string): Promise<import('../domain/memoryExtraction').MemoryExtractionJobRecord | null> {
    const thread = await this.eligible(userId, threadId);
    if (!thread) return null;
    const msg = await this.deps.messageStore.get(userId, threadId, assistantMessageId);
    if (!msg || msg.userId !== userId || msg.threadId !== threadId || msg.id !== assistantMessageId || msg.deletedAt ||
      msg.role !== 'assistant' || msg.status !== 'complete') return null;
    const window = await this.messagesAround(userId, threadId, assistantMessageId);
    if (!window.some((message) => message.role === 'user' && message.content.trim().length >= MIN_MEANINGFUL_CHARS)) return null;
    const sourceRevision = messageRevision(msg);
    return this.enqueueJob(userId, threadId, 'turn', turnDedupe(assistantMessageId, sourceRevision), { assistantMessageId, runId, sourceRevision });
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
    legacyDedupeKey: string,
    ids: { userMessageId?: string; assistantMessageId?: string; runId?: string; sourceRevision: string },
  ) {
    const dedupeKey = `memory-${kind}:v2:${createHash('sha256').update(JSON.stringify([
      userId, threadId, kind, ids.userMessageId, ids.assistantMessageId, ids.sourceRevision,
    ])).digest('hex')}`;
    const matchesSource = (record: import('../domain/memoryExtraction').MemoryExtractionJobRecord, key: string) =>
      record.userId === userId && record.threadId === threadId && record.kind === kind &&
      record.userMessageId === ids.userMessageId && record.assistantMessageId === ids.assistantMessageId &&
      record.sourceRevision === ids.sourceRevision && record.dedupeKey === key &&
      record.id === `memory-job-${createHash('sha256').update(key).digest('hex').slice(0, 32)}`;
    const existing = await this.deps.jobStore.getByDedupeKey(userId, dedupeKey);
    if (existing) {
      if (!matchesSource(existing, dedupeKey)) throw new Error('Memory job source binding failed.');
      return existing;
    }
    const legacy = await this.deps.jobStore.getByDedupeKey(userId, legacyDedupeKey);
    if (legacy && matchesSource(legacy, legacyDedupeKey)) return legacy;
    const ts = this.deps.clock.now();
    const job = parseMemoryExtractionJobRecord({
      id: `memory-job-${createHash('sha256').update(dedupeKey).digest('hex').slice(0, 32)}`,
      userId,
      threadId,
      kind,
      status: 'queued',
      ...ids,
      dedupeKey,
      sourceRevision: ids.sourceRevision,
      releaseId: this.releaseId,
      executionToken: this.deps.clock.newId(),
      dispatchAttempt: 1,
      attempts: 0,
      createdAt: ts,
      updatedAt: ts,
    });
    const admission = await this.deps.jobStore.admit(job);
    if (!matchesSource(admission.job, dedupeKey)) throw new Error('Memory job source binding failed.');
    if (admission.outcome === 'replay') return admission.job;
    try {
      await this.deps.queue.enqueue(admission.job);
      const dispatch = (await this.deps.jobStore.listPendingDispatch()).find((record) =>
        record.userId === userId && record.jobId === admission.job.id);
      if (dispatch) await this.deps.jobStore.markDispatchSent(dispatch, this.deps.clock.now());
    } catch {
      // The durable pending dispatch is reconciled by the timer; accepted learning work is not lost.
    }
    return admission.job;
  }

  async processJob(userId: string, jobId: string, fence?: { releaseId: string; executionToken: string; attempt: number }): Promise<void> {
    const job = await this.deps.jobStore.claim(userId, jobId, this.deps.clock.now(), fence);
    if (!job) return;
    if (job.userId !== userId || job.id !== jobId) throw new Error('Memory job claim binding failed.');
    const currentExecution = async () => isCurrentMemoryJob(await this.deps.jobStore.get(userId, jobId), job);
    try {
      const thread = await this.eligible(job.userId, job.threadId);
      if (!thread) return await this.finish(job, 'ignored', { ignore: 1 }, 0, 0, 'policy_or_source_ineligible');
      const messages = structuredClone(await this.windowFor(job));
      if (!messages.length) return await this.finish(job, 'ignored', { ignore: 1 }, 0, 0, 'source_missing_or_changed');
      const creds = await this.deps.credentials.getDecrypted(job.userId);
      const embedder = this.deps.embedder
        ? { embed: (text: string) => this.deps.embedder!.embed(creds, text), model: this.deps.embedder.model }
        : undefined;
      const candidateSnapshots = structuredClone((await this.deps.memoryStore.list(job.userId, { status: 'active', limit: 20 })).memories.slice(0, 20));
      const candidates: MemoryRecord[] = [];
      if (!(await currentExecution())) return;
      for (const candidate of candidateSnapshots) {
        if (candidate.userId !== job.userId || candidate.status !== 'active' || candidate.sensitive) continue;
        try {
          const current = await this.deps.memoryStore.get(job.userId, candidate.id);
          if (!current || !isDeepStrictEqual(current, candidate)) continue;
          if (await this.deps.memoryStore.isExcluded(job.userId, current.sourceHash, current.sourceRefs, current.id)) continue;
          candidates.push(candidate);
        } catch {
          continue;
        }
      }
      if (!isDeepStrictEqual(await this.windowFor(job), messages)) return await this.finish(job, 'ignored', { ignore: 1 }, 0, 0, 'source_missing_or_changed');
      const currentThread = await this.eligible(job.userId, job.threadId);
      if (!currentThread) return await this.finish(job, 'ignored', { ignore: 1 }, 0, 0, 'policy_or_source_ineligible');
      if (!(await currentExecution())) return;
      const out = await this.deps.extractor(creds, {
        mode: job.kind,
        now: this.deps.clock.now(),
        threadId: job.threadId,
        threadTitle: currentThread.title,
        messages: messages.map((m) => ({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content.slice(0, 4096), createdAt: chrono(m) })),
        existingMemories: candidates.map((m) => ({ id: m.id, kind: m.kind, status: m.status, text: m.text, entities: m.entities, topics: m.topics, validAt: m.validAt, invalidAt: m.invalidAt })),
      });
      if (!(await currentExecution())) return;
      if (!(await this.learningAllowed(job.userId))) return await this.finish(job, 'ignored', { ignore: 1 }, 0, 0, 'policy_revoked');
      const result = await this.applyOperations(job.userId, job.threadId, job.kind, messages, candidates, out, currentExecution, embedder);
      if (embedder) await this.backfillEmbeddings(job.userId, embedder, currentExecution);
      await this.finish(job, result.accepted > 0 ? 'completed' : 'ignored', result.counts, result.accepted, result.rejected, result.accepted > 0 ? 'committed' : 'no_operations_accepted');
    } catch {
      await this.deps.jobStore.putIfCurrent({
        ...job,
        status: 'failed',
        attempts: job.attempts,
        lastErrorCode: 'extract_failed',
        lastErrorMessage: 'Memory extraction failed.',
        updatedAt: this.deps.clock.now(),
      }, job);
      throw new Error('Memory extraction failed.');
    }
  }

  private async finish(
    job: import('../domain/memoryExtraction').MemoryExtractionJobRecord,
    status: 'completed' | 'ignored',
    counts: Partial<Record<'add' | 'merge' | 'invalidate' | 'suppress' | 'ignore', number>>,
    accepted: number,
    rejected: number,
    terminalReason: string,
  ): Promise<void> {
    const ts = this.deps.clock.now();
    const saved = await this.deps.jobStore.putIfCurrent({
      ...job,
      status,
      operationCounts: { add: counts.add ?? 0, merge: counts.merge ?? 0, invalidate: counts.invalidate ?? 0, suppress: counts.suppress ?? 0, ignore: counts.ignore ?? 0 },
      acceptedCount: accepted,
      rejectedCount: rejected,
      terminalReason,
      updatedAt: ts,
      completedAt: ts,
    }, job);
    if (saved && accepted > 0 && this.deps.signalr) {
      await this.deps.signalr
        .sendToUser(job.userId, 'memory', {
          jobId: job.id,
          threadId: job.threadId,
          kind: job.kind,
          ...(job.assistantMessageId ? { assistantMessageId: job.assistantMessageId } : {}),
          acceptedCount: accepted,
          updatedAt: ts,
        })
        .catch(() => undefined);
    }
  }

  private async windowFor(job: import('../domain/memoryExtraction').MemoryExtractionJobRecord): Promise<MessageRecord[]> {
    const targetId = job.assistantMessageId ?? job.userMessageId;
    const messages = await this.messagesAround(job.userId, job.threadId, targetId);
    if (messages.some(message => message.userId !== job.userId || message.threadId !== job.threadId)) return [];
    const target = messages.find(message => message.id === targetId);
    if (!target || target.userId !== job.userId || target.threadId !== job.threadId || target.deletedAt ||
        messageRevision(target) !== job.sourceRevision ||
        (job.kind === 'command' && target.role !== 'user') ||
        (job.kind === 'turn' && (target.role !== 'assistant' || target.status !== 'complete'))) return [];
    return messages;
  }

  private async messagesAround(userId: string, threadId: string, targetId?: string): Promise<MessageRecord[]> {
    const all = (await this.deps.messageStore.list(userId, threadId))
      .filter((m) => !m.deletedAt && (m.role === 'user' || m.role === 'assistant'))
      .sort((a, b) => chrono(a).localeCompare(chrono(b)));
    const index = all.findIndex((m) => m.id === targetId);
    if (index < 0) return [];
    // Pass the full threaded conversation up to and including the target turn (capped), so the
    // extractor sees the context that disambiguates authorship — a short window misreads task content
    // (e.g. a speech the user is drafting for their child) as durable facts about the user.
    const end = index + 1;
    return all.slice(Math.max(0, end - CONTEXT_WINDOW_MESSAGES), end);
  }

  private sourceRefs(userId: string, threadId: string, messages: MessageRecord[], ids: string[]): MemorySourceRef[] | null {
    if (!ids.length) return null;
    const refs: MemorySourceRef[] = [];
    for (const id of new Set(ids)) {
      const msg = messages.find((m) => m.id === id);
      if (!msg || msg.userId !== userId || msg.threadId !== threadId || msg.role !== 'user' || msg.deletedAt) return null;
      refs.push({ type: 'message', threadId, messageId: msg.id, quote: msg.content.slice(0, 500), createdAt: chrono(msg) });
    }
    return refs;
  }

  private async sourcesCurrent(userId: string, refs: MemorySourceRef[], messages: MessageRecord[]): Promise<boolean> {
    for (const ref of refs) {
      if (ref.type !== 'message' || !ref.threadId || !ref.messageId) return false;
      const original = messages.find(message => message.id === ref.messageId && message.threadId === ref.threadId);
      const current = await this.deps.messageStore.get(userId, ref.threadId, ref.messageId);
      if (!original || !current || current.deletedAt || current.id !== original.id || current.userId !== userId ||
          current.threadId !== original.threadId || current.role !== 'user' || current.content !== original.content ||
          chrono(current) !== chrono(original)) return false;
    }
    return true;
  }

  private async applyOperations(
    userId: string,
    threadId: string,
    mode: 'command' | 'turn' | 'rebuild',
    messages: MessageRecord[],
    candidates: MemoryRecord[],
    output: MemoryExtractionOutput,
    currentExecution: () => Promise<boolean>,
    embedder?: { embed: (text: string) => Promise<number[]>; model: string },
  ): Promise<{ counts: Partial<Record<'add' | 'merge' | 'invalidate' | 'suppress' | 'ignore', number>>; accepted: number; rejected: number }> {
    const counts: Partial<Record<'add' | 'merge' | 'invalidate' | 'suppress' | 'ignore', number>> = {};
    const confirmed = new Map(candidates.map(memory => [memory.id, memory]));
    let accepted = 0;
    let rejected = 0;
    for (const op of output.operations) {
      counts[op.op] = (counts[op.op] ?? 0) + 1;
      try {
        if (!(await currentExecution()) || !(await this.learningAllowed(userId))) { rejected++; continue; }
        if (op.op === 'ignore') continue;
        if ((op.op === 'add' || op.op === 'merge') && op.sensitivity !== 'normal') { rejected++; continue; }
        const targetIds = op.op === 'add' ? op.supersedes ?? [] : [op.memoryId];
        const targetSnapshots = targetIds.map(id => confirmed.get(id));
        const targetsCurrent = async () => {
          for (const snapshot of targetSnapshots) {
            if (!snapshot || snapshot.userId !== userId || snapshot.status !== 'active' ||
                snapshot.sensitive || snapshot.confirmation === 'approved') return false;
            if (!isDeepStrictEqual(await this.deps.memoryStore.get(userId, snapshot.id), snapshot)) return false;
          }
          return true;
        };
        if (!(await targetsCurrent())) { rejected++; continue; }
        const refs = this.sourceRefs(userId, threadId, messages, op.sourceMessageIds);
        if (!refs) { rejected++; continue; }
        if (!(await this.sourcesCurrent(userId, refs, messages))) { rejected++; continue; }
        const sourceCanCommit = async () => await currentExecution() && !!(await this.eligible(userId, threadId)) &&
          await this.learningAllowed(userId) && await this.sourcesCurrent(userId, refs, messages);
        const canCommit = async () => await sourceCanCommit() && await targetsCurrent();
        if (op.op === 'add') {
          const minConfidence = mode === 'command' ? 0.65 : 0.82;
          const minSalience = mode === 'command' ? 0.4 : 0.65;
          if (op.confidence < minConfidence || op.salience < minSalience) { rejected++; continue; }
          const hash = sourceHash(op.text, op.kind, op.entities);
          if (await this.deps.memoryStore.isExcluded(userId, hash, refs)) { rejected++; continue; }
          const duplicate = Array.from(confirmed.values()).find((memory) => memory.sourceHash === hash && memory.status === 'active');
          if (duplicate) {
            if (targetIds.length) { rejected++; continue; }
            const saved = await this.mergeMemory(duplicate, refs, canCommit, op.confidence, op.salience, undefined, undefined, undefined, op.target, embedder);
            if (!saved) { rejected++; continue; }
            confirmed.set(saved.id, saved);
          } else {
            const id = `memory-${hash.slice(0, 48)}`;
            const allowed = async () => await canCommit() && !(await this.deps.memoryStore.isExcluded(userId, hash, refs, id));
            const embedded = await embedFor(embedder, op.text, allowed);
            if (embedder && op.supersedes?.length && !embedded) { rejected++; continue; }
            if (!(await allowed())) { rejected++; continue; }
            let saved = await this.deps.memoryStore.createIfAbsent(parseMemoryRecord({
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
              origin: 'inferred',
              confirmation: 'automatic',
              revision: 1,
              ...(op.target ? { route: op.target } : {}),
              ...(embedded ? { embedding: embedded.embedding, embeddingModel: embedded.model, embeddingTextHash: embedded.textHash } : {}),
              visibility: op.salience >= 0.85 ? 'top_of_mind' : op.salience <= 0.35 ? 'background' : 'normal',
              validAt: op.validAt,
              createdAt: this.deps.clock.now(),
              updatedAt: this.deps.clock.now(),
              useCount: 0,
              supersedes: op.supersedes,
            }), targetSnapshots as MemoryRecord[]);
            if (!saved) {
              if (targetIds.length) { rejected++; continue; }
              const winner = await this.deps.memoryStore.get(userId, id);
              if (!winner || winner.userId !== userId || winner.sourceHash !== hash) { rejected++; continue; }
              saved = await this.mergeMemory(winner, refs, canCommit, op.confidence, op.salience, undefined, undefined, undefined, op.target, embedder);
              if (!saved) { rejected++; continue; }
            }
            confirmed.set(saved.id, saved);
            for (const oldId of targetIds) confirmed.delete(oldId);
          }
          accepted++;
        } else if (op.op === 'merge') {
          const current = await this.deps.memoryStore.get(userId, op.memoryId);
          if (!current || current.status === 'deleted') { rejected++; continue; }
          if (current.confirmation === 'approved') { rejected++; continue; }
          const saved = await this.mergeMemory(current, refs, canCommit, op.confidence, op.salience, op.text, op.entities, op.topics, op.target, embedder);
          if (!saved) { rejected++; continue; }
          confirmed.set(saved.id, saved);
          accepted++;
        } else if (op.op === 'invalidate') {
          const current = await this.deps.memoryStore.get(userId, op.memoryId);
          if (current?.confirmation === 'approved') { rejected++; continue; }
          if (!(await this.invalidateMemory(userId, op.memoryId, canCommit, undefined, confirmed.get(op.memoryId)))) { rejected++; continue; }
          confirmed.delete(op.memoryId);
          accepted++;
        } else if (op.op === 'suppress') {
          const current = await this.deps.memoryStore.get(userId, op.memoryId);
          if (!current || current.status !== 'active' || current.confirmation === 'approved') { rejected++; continue; }
          if (!(await canCommit()) || await this.deps.memoryStore.isExcluded(userId, current.sourceHash, current.sourceRefs, current.id)) { rejected++; continue; }
          const saved = await this.deps.memoryStore.putIfRevision(parseMemoryRecord({
            ...current, status: 'suppressed', revision: (current.revision ?? 1) + 1, updatedAt: this.deps.clock.now(),
          }), current.revision ?? 1);
          if (!saved) { rejected++; continue; }
          confirmed.delete(saved.id);
          accepted++;
        }
      } catch (error) {
        if (error instanceof MemoryPublicationUnconfirmedError) throw error;
        rejected++;
      }
    }
    return { counts, accepted, rejected };
  }

  private async mergeMemory(memory: MemoryRecord, refs: MemorySourceRef[], canCommit: () => Promise<boolean>, confidence?: number, salience?: number, text?: string, entities?: string[], topics?: string[], route?: MemoryRecord['route'], embedder?: { embed: (text: string) => Promise<number[]>; model: string }): Promise<MemoryRecord | null> {
    if (memory.status !== 'active' || memory.sensitive || memory.confirmation === 'approved' || !(await canCommit())) return null;
    const seen = new Set(memory.sourceRefs.map((r) => `${r.type}:${r.threadId}:${r.messageId}:${r.createdAt}`));
    const sourceRefs = [...memory.sourceRefs];
    for (const ref of refs) {
      const key = `${ref.type}:${ref.threadId}:${ref.messageId}:${ref.createdAt}`;
      if (!seen.has(key) && sourceRefs.length < 12) sourceRefs.push(ref);
    }
    const nextText = text ?? memory.text;
    const textChanged = nextText !== memory.text;
    const reembed = textChanged ? await embedFor(embedder, nextText, canCommit) : null;
    if (textChanged && embedder && !reembed) return null;
    if (!(await canCommit())) return null;
    const current = await this.deps.memoryStore.get(memory.userId, memory.id);
    if (!current || current.status !== 'active' || current.confirmation === 'approved' || JSON.stringify(current) !== JSON.stringify(memory)) return null;
    if (await this.deps.memoryStore.isExcluded(memory.userId, memory.sourceHash, sourceRefs, memory.id)) return null;
    const nextHash = sourceHash(nextText, memory.kind, entities ?? memory.entities);
    if (await this.deps.memoryStore.isExcluded(memory.userId, nextHash, sourceRefs, memory.id)) return null;
    const saved = await this.deps.memoryStore.putIfRevision(parseMemoryRecord({
      ...memory,
      text: nextText,
      normalizedText: normalizeText(nextText),
      sourceHash: nextHash,
      entities: entities ?? memory.entities,
      topics: topics ?? memory.topics,
      sourceRefs,
      ...(route ? { route } : {}),
      ...(textChanged ? { embedding: reembed?.embedding, embeddingModel: reembed?.model, embeddingTextHash: reembed?.textHash } : {}),
      confidence: Math.max(memory.confidence, confidence ?? memory.confidence),
      salience: Math.max(memory.salience, salience ?? memory.salience),
      revision: (memory.revision ?? 0) + 1,
      updatedAt: this.deps.clock.now(),
    }), memory.revision ?? 1);
    return saved;
  }

  private async invalidateMemory(userId: string, memoryId: string, canCommit: () => Promise<boolean>, supersededBy?: string, expected?: MemoryRecord): Promise<boolean> {
    const current = await this.deps.memoryStore.get(userId, memoryId);
    if (!expected || !isDeepStrictEqual(current, expected)) return false;
    if (!current || current.status !== 'active' || current.confirmation === 'approved' || !(await canCommit())) return false;
    if (await this.deps.memoryStore.isExcluded(userId, current.sourceHash, current.sourceRefs, current.id)) return false;
    const saved = await this.deps.memoryStore.putIfRevision(parseMemoryRecord({
      ...current,
      status: 'invalidated',
      invalidAt: this.deps.clock.now(),
      ...(supersededBy ? { supersededBy } : {}),
      revision: (current.revision ?? 0) + 1,
      updatedAt: this.deps.clock.now(),
    }), current.revision ?? 1);
    return saved !== null;
  }

  /** Best-effort: heal up to a few active memories that lack a current-model embedding, so a
   *  transient write-time embed failure (or a pre-rollout record) becomes retrievable. */
  private async backfillEmbeddings(userId: string, embedder: { embed: (text: string) => Promise<number[]>; model: string }, currentExecution: () => Promise<boolean>): Promise<void> {
    try {
      const active = (await this.deps.memoryStore.list(userId, { status: 'active', limit: 50 })).memories;
      let healed = 0;
      for (const memory of active) {
        if (healed >= 3) break;
        if (memory.sensitive) continue;
        if (!(await currentExecution()) || !(await this.learningAllowed(userId))) break;
        if (hasCurrentMemoryEmbedding(memory, userId, embedder.model, memory.embedding?.length ?? 0)) continue;
        const eligible = async () => {
          if (!(await currentExecution()) || !(await this.learningAllowed(userId))) return false;
          const current = await this.deps.memoryStore.get(userId, memory.id);
          return !!current && current.status === 'active' && JSON.stringify(current) === JSON.stringify(memory) &&
            !(await this.deps.memoryStore.isExcluded(userId, current.sourceHash, current.sourceRefs, current.id));
        };
        const embedded = await embedFor(embedder, memory.text, eligible);
        if (!embedded) continue;
        if (!(await eligible())) continue;
        const saved = await this.deps.memoryStore.putIfRevision(parseMemoryRecord({
          ...memory, embedding: embedded.embedding, embeddingModel: embedded.model, embeddingTextHash: embedded.textHash,
        }), memory.revision ?? 1);
        if (saved) healed++;
      }
    } catch {
      /* best-effort */
    }
  }
}