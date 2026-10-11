import { isDeepStrictEqual } from 'node:util';
import { encode as encodeCl100k } from 'gpt-tokenizer/encoding/cl100k_base';
import { encode as encodeO200k } from 'gpt-tokenizer/encoding/o200k_base';
import { MAX_MEMORY_CONTEXT_RECORDS, hasCurrentMemoryEmbedding, isRetrievableMemory, type MemoryContextBlock, type MemoryRecord } from '../domain/memory';
import { renderMemoryProfileWithSources } from '../domain/memoryProfile';
import { effectiveMemoryPolicy, type Settings } from '../domain/settings';
import type { MemoryStore } from '../ports/memoryStore';
import type { Embedder, EmbedCredentials } from '../ports/embedder';
import type { MemoryRetriever } from '../ports/memoryRetriever';

export interface MemoryContextInput {
  userId: string;
  threadId: string;
  latestUserText: string;
  now: string;
  tokenBudget?: number;
  signal?: AbortSignal;
  /** Decrypted inference credentials, supplied by the run worker so the read path can embed the
   *  query without a second credential unwrap. When absent (or embeddings unconfigured) the
   *  relevance channel is skipped and only the always-on profile contributes. */
  creds?: EmbedCredentials;
  /** Already-loaded settings, supplied by the run worker so the gate check reuses the worker's
   *  read instead of issuing a second one. Falls back to a store read when omitted. */
  settings?: Settings;
}

export interface MemorySettingsReader {
  get(userId: string): Promise<Settings>;
}

const EMPTY: Omit<MemoryContextBlock, 'latencyBudgetMs'> = {
  instructions: [],
  memories: [],
  threadSummaries: [],
  sourceRefs: [],
  tokenEstimate: 0,
  retrievalMode: 'empty',
};

const DEFAULT_TOKEN_BUDGET = 800;
export const MEMORY_CONTEXT_BUDGET_MS = 500;
const MAX_SELECTED_MEMORIES = 3;
const VECTOR_CANDIDATE_LIMIT = 200;
const RELEVANCE_FLOOR = 0.25;
// The always-on profile is relevance-gated a touch below the retrieval floor: identity grounding
// should surface for queries related to what we know about the user, but never on unrelated ones.
const PROFILE_RELEVANCE_FLOOR = 0.2;
const W_RELEVANCE = 0.6;
const W_IMPORTANCE = 0.25;
const W_RECENCY = 0.15;
const RECENCY_HALFLIFE_DAYS = 45;
const PROFILE_MAX_CHARS = 2400;

function estimateTokens(text: string): number {
  return Math.max(encodeCl100k(text, { disallowedSpecial: new Set() }).length,
    encodeO200k(text, { disallowedSpecial: new Set() }).length);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Cosine similarity clamped to 0..1 (negatives treated as not-similar). Local copy so the read
 *  path's profile relevance gate does not depend on the retriever adapter. */
function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  const c = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return c > 0 ? Math.min(1, c) : 0;
}

/** Composite relevance·importance·recency score used to rank vector candidates. */
function compositeScore(relevance: number, memory: MemoryRecord, nowMs: number): number {
  const importance = clamp01(memory.salience * 0.7 + memory.confidence * 0.3);
  const ageDays = Math.max(0, (nowMs - Date.parse(memory.updatedAt || memory.createdAt)) / 86_400_000);
  const recency = Number.isFinite(ageDays) ? Math.exp(-ageDays / RECENCY_HALFLIFE_DAYS) : 0;
  const visibilityBoost = memory.visibility === 'top_of_mind' ? 0.05 : memory.visibility === 'background' ? -0.05 : 0;
  return clamp01(W_RELEVANCE * relevance + W_IMPORTANCE * importance + W_RECENCY * recency + visibilityBoost);
}

export class MemoryContextService {
  private readonly embedder?: Embedder;
  private readonly retriever?: MemoryRetriever;
  private readonly profileEnabled: boolean;
  private readonly contained: () => boolean;

  constructor(
    private readonly store: MemoryStore,
    private readonly settings: MemorySettingsReader,
    opts?: { embedder?: Embedder; retriever?: MemoryRetriever; profile?: boolean; contained?: () => boolean },
  ) {
    this.embedder = opts?.embedder;
    this.retriever = opts?.retriever;
    this.profileEnabled = opts?.profile ?? false;
    this.contained = opts?.contained ?? (() => false);
  }

  async buildForRun(input: MemoryContextInput): Promise<MemoryContextBlock> {
    const controller = new AbortController();
    const deadline = Date.now() + MEMORY_CONTEXT_BUDGET_MS;
    let timedOut = false;
    const degraded = (reason: NonNullable<MemoryContextBlock['degradedReason']>): MemoryContextBlock =>
      ({ ...EMPTY, latencyBudgetMs: MEMORY_CONTEXT_BUDGET_MS, degradedReason: reason });
    if (input.signal?.aborted) return degraded('cancelled');
    const cancel = () => controller.abort();
    input.signal?.addEventListener('abort', cancel, { once: true });
    let onAbort!: () => void;
    const aborted = new Promise<MemoryContextBlock>(resolve => { onAbort = () => resolve(degraded(timedOut ? 'timeout' : 'cancelled')); });
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, MEMORY_CONTEXT_BUDGET_MS);
    try {
      const work = this.buildContext({ ...input, signal: controller.signal }).then(block => {
        if (Date.now() >= deadline) { timedOut = true; controller.abort(); }
        return controller.signal.aborted ? degraded(timedOut ? 'timeout' : 'cancelled') : { ...block, latencyBudgetMs: MEMORY_CONTEXT_BUDGET_MS };
      }).catch(() => degraded(controller.signal.aborted ? timedOut ? 'timeout' : 'cancelled' : 'unavailable'));
      return await Promise.race([work, aborted]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      input.signal?.removeEventListener('abort', cancel);
    }
  }

  private async buildContext(input: MemoryContextInput): Promise<MemoryContextBlock> {
    if (this.contained() || input.signal?.aborted) return { ...EMPTY, latencyBudgetMs: 250 };
    const requestedBudget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    if (!Number.isFinite(requestedBudget) || requestedBudget <= 0) return { ...EMPTY, latencyBudgetMs: 250 };
    input = { ...input, tokenBudget: Math.min(DEFAULT_TOKEN_BUDGET, Math.floor(requestedBudget)) };
    const currentPolicy = async () => {
      if (input.signal?.aborted) return null;
      const current = await this.settings.get(input.userId).catch(() => undefined);
      return current && !input.signal?.aborted ? effectiveMemoryPolicy(current) : null;
    };
    const initialPolicy = await currentPolicy();
    if (this.contained() || !initialPolicy?.readSaved) return { ...EMPTY, latencyBudgetMs: 250 };
    const savedOnlyProfile = this.profileEnabled && initialPolicy.learnChats !== 'automatic';
    const retrievalOn = !savedOnlyProfile && !!(this.embedder && this.retriever && input.creds);
    // Share recent candidates and a bounded older-pin supplement between both context channels.
    const candidates: MemoryRecord[] =
      retrievalOn || this.profileEnabled
        ? await this.store
            .list(input.userId, {
              status: 'active', limit: VECTOR_CANDIDATE_LIMIT,
              confirmations: initialPolicy.learnChats === 'automatic' ? ['approved', 'automatic'] : ['approved'],
              excludeKinds: ['project_context'],
            })
            // Project / work-in-progress context is never injected into prompts — threads are isolated
            // by design and this context must not cross-bleed between them.
            .then(async (page) => {
              const combined = page.memories.slice(0, VECTOR_CANDIDATE_LIMIT).map(memory => structuredClone(memory));
              if (input.signal?.aborted) return [];
              if (page.cursor) {
                const pinned = await this.store.list(input.userId, {
                  status: 'active', limit: MAX_MEMORY_CONTEXT_RECORDS,
                  confirmations: initialPolicy.learnChats === 'automatic' ? ['approved', 'automatic'] : ['approved'],
                  excludeKinds: ['project_context'], pinned: true,
                });
                combined.push(...pinned.memories.slice(0, MAX_MEMORY_CONTEXT_RECORDS).filter(memory => memory.pinned === true));
              }
              const unique = new Map<string, MemoryRecord>();
              for (const memory of combined) {
                const previous = unique.get(memory.id);
                if (memory.userId !== input.userId || (previous && !isDeepStrictEqual(previous, memory))) {
                  throw new Error('Memory candidates changed during collection.');
                }
                if (memory.kind !== 'project_context' &&
                    (memory.confirmation === 'approved' || (initialPolicy.learnChats === 'automatic' && memory.confirmation === 'automatic'))) {
                  unique.set(memory.id, structuredClone(memory));
                }
              }
              return [...unique.values()];
            })
            .catch(() => [])
        : [];
      if (input.signal?.aborted) return { ...EMPTY, latencyBudgetMs: 250 };
    // Embed the query once and reuse it for the relevance channel AND the profile relevance gate.
    const queryVec = retrievalOn
        ? await this.embedder!.embed(input.creds!, input.latestUserText, { signal: input.signal }).catch(() => {
          if (!input.signal?.aborted) console.warn('[memory] query embed failed');
          return null;
        })
      : null;
    if (input.signal?.aborted) return { ...EMPTY, latencyBudgetMs: 250 };
    const base = retrievalOn ? await this.buildVector(input, candidates, queryVec) : { ...EMPTY, latencyBudgetMs: 250 };
    if (input.signal?.aborted) return { ...EMPTY, latencyBudgetMs: 250 };
    if (!this.profileEnabled) {
      if (!(await this.selectedCurrent(input, base, candidates))) return { ...EMPTY, latencyBudgetMs: 250 };
      const finalPolicy = await currentPolicy();
      return !this.contained() && finalPolicy?.readSaved && finalPolicy.learnChats === initialPolicy.learnChats ? base : { ...EMPTY, latencyBudgetMs: 250 };
    }
    // Relevance-gate the always-on profile: inject identity grounding only when the query relates to
    // something we know about the user (at least one active fact clears the profile floor). Without an
    // embedder configured we cannot judge relevance, so fall back to always-on (legacy behavior).
    const profiled = await this.withProfile(base, input, candidates);
    const suppliedIds = new Set(profiled.memories.map(memory => memory.id));
    const profileRelevant = queryVec
        ? candidates.some((memory) => suppliedIds.has(memory.id) && isRetrievableMemory(memory, input.now) &&
          hasCurrentMemoryEmbedding(memory, input.userId, this.embedder!.model, queryVec.length) &&
          cosine(queryVec, memory.embedding!) >= PROFILE_RELEVANCE_FLOOR)
      : !retrievalOn;
    const result = profileRelevant ? profiled : base;
    if (!(await this.selectedCurrent(input, result, candidates))) return { ...EMPTY, latencyBudgetMs: 250 };
    const finalPolicy = await currentPolicy();
    return !this.contained() && finalPolicy?.readSaved && finalPolicy.learnChats === initialPolicy.learnChats ? result : { ...EMPTY, latencyBudgetMs: 250 };
  }

  private async selectedCurrent(input: MemoryContextInput, block: MemoryContextBlock, candidates: MemoryRecord[]): Promise<boolean> {
    try {
      if (input.signal?.aborted) return false;
      const selected = new Map(block.memories.map(memory => [memory.id, memory]));
      if (selected.size > MAX_MEMORY_CONTEXT_RECORDS) return false;
      for (const [id, supplied] of selected) {
        if (input.signal?.aborted) return false;
        const original = candidates.find(memory => memory.id === id);
        if (!original || original.userId !== input.userId || supplied.text !== original.text ||
            supplied.kind !== original.kind || supplied.revision !== (original.revision ?? 1)) return false;
        const current = await this.store.get(input.userId, id);
        if (input.signal?.aborted) return false;
        if (!current || current.userId !== input.userId || !isDeepStrictEqual(current, original) ||
            !isRetrievableMemory(current, input.now)) return false;
        if (await this.store.isExcluded(input.userId, current.sourceHash, current.sourceRefs, current.id)) return false;
      }
      return !input.signal?.aborted;
    } catch {
      return false;
    }
  }

  /** Semantic retrieval: vector-rank candidates above a relevance floor against the (pre-computed)
   *  query embedding. A missing embedding or no relevant match yields an empty block (never blocks). */
  private async buildVector(input: MemoryContextInput, candidates: MemoryRecord[], queryVec: number[] | null): Promise<MemoryContextBlock> {
    if (!queryVec) return { ...EMPTY, latencyBudgetMs: 250 };
    const scored = await this.retriever!
      .retrieve(input.userId, queryVec, { embeddingModel: this.embedder!.model, now: input.now, limit: MAX_SELECTED_MEMORIES, candidateLimit: VECTOR_CANDIDATE_LIMIT, candidates })
      .catch(() => []);
    const nowMs = Date.parse(input.now);
    const ranked = scored
      // top_of_mind only earns a ranking lift (see compositeScore), never a floor bypass — otherwise
      // high-salience identity facts (auto-marked top_of_mind) surface on every unrelated query.
      // Always-availability is the always-on profile's job, not the relevance channel's.
      .filter((item) => item.relevance >= RELEVANCE_FLOOR || item.memory.pinned)
      .map((item) => ({ memory: item.memory, score: compositeScore(item.relevance, item.memory, nowMs) }))
      .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt));

    const budget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const selected: typeof ranked = [];
    let tokenEstimate = 0;
    for (const item of ranked) {
      const next = [...selected, item];
      const cost = estimateTokens(renderMemoryContext({
        instructions: next.filter(({ memory }) => memory.kind === 'instruction').map(({ memory }) => memory.text),
        memories: next.map(({ memory }) => memory),
      }));
      if (selected.length >= MAX_SELECTED_MEMORIES || cost > budget) continue;
      selected.push(item);
      tokenEstimate = cost;
    }
    console.log(`[memory] retrieval candidates=${scored.length} cleared=${ranked.length} selected=${selected.length} top=${(scored[0]?.relevance ?? 0).toFixed(3)} floor=${RELEVANCE_FLOOR}`);
    if (!selected.length) return { ...EMPTY, latencyBudgetMs: 250 };
    return {
      instructions: selected.filter((item) => item.memory.kind === 'instruction').map((item) => item.memory.text),
      memories: selected.map(({ memory, score }) => ({
        id: memory.id,
        kind: memory.kind,
        text: memory.text,
        ...(memory.validAt ? { validAt: memory.validAt } : {}),
        ...(memory.invalidAt ? { invalidAt: memory.invalidAt } : {}),
        score: Number(score.toFixed(4)),
        origin: memory.origin as 'manual' | 'explicit_request' | 'inferred' | 'imported',
        confirmation: memory.confirmation as 'approved' | 'automatic',
        revision: memory.revision ?? 1,
      })),
      threadSummaries: [],
      sourceRefs: selected.map(({ memory }) => {
        const source = memory.sourceRefs.find((ref) => ref.type !== 'system') ?? memory.sourceRefs[0];
        return {
          memoryId: memory.id,
          ...(source?.threadId ? { threadId: source.threadId } : {}),
          ...(source?.messageId ? { messageId: source.messageId } : {}),
        };
      }),
      tokenEstimate,
      latencyBudgetMs: 250,
      retrievalMode: 'vector',
    };
  }

  /** Always-on identity profile, prepended to every run when enabled. Sensitive memories excluded. */
  private async withProfile(base: MemoryContextBlock, input: MemoryContextInput, candidates: MemoryRecord[],
    maximumItems = MAX_MEMORY_CONTEXT_RECORDS - base.memories.length): Promise<MemoryContextBlock> {
    if (maximumItems <= 0) return base;
    const rendered = renderMemoryProfileWithSources(candidates, input.now, {
      maxChars: PROFILE_MAX_CHARS,
      maxItems: maximumItems,
    });
    const profile = rendered.text;
    if (!profile) return base;
    const existing = new Set(base.memories.map((memory) => memory.id));
    const included = new Set(rendered.memoryIds);
    const profileRecords = candidates.filter((memory) => !existing.has(memory.id) && included.has(memory.id));
    const retrievalMode = base.memories.length || base.instructions.length ? base.retrievalMode : 'profile';
    const result: MemoryContextBlock = {
      ...base,
      profile,
      memories: [
        ...base.memories,
        ...profileRecords.map((memory) => ({
          id: memory.id,
          kind: memory.kind,
          text: memory.text,
          score: memory.salience,
          origin: memory.origin as 'manual' | 'explicit_request' | 'inferred' | 'imported',
          confirmation: memory.confirmation as 'approved' | 'automatic',
          revision: memory.revision ?? 1,
          profileOnly: true,
        })),
      ],
      sourceRefs: [
        ...base.sourceRefs,
        ...profileRecords.map((memory) => {
          const source = memory.sourceRefs.find((ref) => ref.type !== 'system') ?? memory.sourceRefs[0];
          return { memoryId: memory.id, ...(source?.threadId ? { threadId: source.threadId } : {}), ...(source?.messageId ? { messageId: source.messageId } : {}) };
        }),
      ],
      tokenEstimate: 0,
      retrievalMode,
    };
    result.tokenEstimate = estimateTokens(renderMemoryContext(result));
    return result.tokenEstimate <= (input.tokenBudget ?? DEFAULT_TOKEN_BUDGET)
      ? result : this.withProfile(base, input, candidates, maximumItems - 1);
  }
}

export function renderMemoryContext(block: Pick<MemoryContextBlock, 'profile' | 'instructions' | 'summary'> & {
  memories: Array<Pick<MemoryContextBlock['memories'][number], 'kind' | 'text' | 'profileOnly'>>;
}): string {
  const parts: string[] = [];
  if (block.profile) parts.push(`What you know about the user:\n${block.profile}`);
  const lines: string[] = [];
  if (block.summary) lines.push(`- Summary: ${block.summary}`);
  for (const instruction of block.instructions) lines.push(`- Instruction: ${instruction}`);
  for (const memory of block.memories) {
    if (memory.kind === 'instruction' || memory.profileOnly) continue;
    lines.push(`- ${memory.kind}: ${memory.text}`);
  }
  if (lines.length) parts.push(['Relevant saved memory:', ...lines].join('\n'));
  return parts.join('\n\n');
}