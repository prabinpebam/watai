import type { MemoryContextBlock, MemoryRecord } from '../domain/memory';
import { renderMemoryProfile } from '../domain/memoryProfile';
import { effectiveMemorySettings, type Settings } from '../domain/settings';
import type { MemoryStore } from '../ports/memoryStore';
import type { Embedder, EmbedCredentials } from '../ports/embedder';
import type { MemoryRetriever } from '../ports/memoryRetriever';

export interface MemoryContextInput {
  userId: string;
  threadId: string;
  latestUserText: string;
  now: string;
  tokenBudget?: number;
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

const DEFAULT_TOKEN_BUDGET = 400;
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
  return Math.ceil(text.length / 4);
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

  constructor(
    private readonly store: MemoryStore,
    private readonly settings: MemorySettingsReader,
    opts?: { embedder?: Embedder; retriever?: MemoryRetriever; profile?: boolean },
  ) {
    this.embedder = opts?.embedder;
    this.retriever = opts?.retriever;
    this.profileEnabled = opts?.profile ?? false;
  }

  async buildForRun(input: MemoryContextInput): Promise<MemoryContextBlock> {
    const settings = input.settings ?? (await this.settings.get(input.userId).catch(() => undefined));
    if (settings) {
      const memory = effectiveMemorySettings(settings);
      if (!memory.enabled || memory.paused || !memory.referenceSaved) return { ...EMPTY, latencyBudgetMs: 250 };
    }
    const retrievalOn = !!(this.embedder && this.retriever && input.creds);
    // Read the active candidate set once and share it between vector ranking and the always-on
    // profile, instead of listing the same (up to 200) records twice per run.
    const candidates: MemoryRecord[] =
      retrievalOn || this.profileEnabled
        ? await this.store
            .list(input.userId, { status: 'active', limit: VECTOR_CANDIDATE_LIMIT })
            .then((p) => p.memories)
            .catch(() => [])
        : [];
    // Embed the query once and reuse it for the relevance channel AND the profile relevance gate.
    const queryVec = retrievalOn
      ? await this.embedder!.embed(input.creds!, input.latestUserText).catch((e) => {
          console.warn('[memory] query embed failed', e instanceof Error ? e.message : String(e));
          return null;
        })
      : null;
    const base = retrievalOn ? await this.buildVector(input, candidates, queryVec) : { ...EMPTY, latencyBudgetMs: 250 };
    if (!this.profileEnabled) return base;
    // Relevance-gate the always-on profile: inject identity grounding only when the query relates to
    // something we know about the user (at least one active fact clears the profile floor). Without an
    // embedder configured we cannot judge relevance, so fall back to always-on (legacy behavior).
    const profileRelevant = queryVec
      ? candidates.some((m) => m.embedding?.length && cosine(queryVec, m.embedding) >= PROFILE_RELEVANCE_FLOOR)
      : true;
    return profileRelevant ? this.withProfile(base, input, candidates) : base;
  }

  /** Semantic retrieval: vector-rank candidates above a relevance floor against the (pre-computed)
   *  query embedding. A missing embedding or no relevant match yields an empty block (never blocks). */
  private async buildVector(input: MemoryContextInput, candidates: MemoryRecord[], queryVec: number[] | null): Promise<MemoryContextBlock> {
    if (!queryVec) return { ...EMPTY, latencyBudgetMs: 250 };
    const scored = await this.retriever!
      .retrieve(input.userId, queryVec, { now: input.now, limit: MAX_SELECTED_MEMORIES, candidateLimit: VECTOR_CANDIDATE_LIMIT, candidates })
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
      const cost = estimateTokens(item.memory.text) + 12;
      if (selected.length >= MAX_SELECTED_MEMORIES || tokenEstimate + cost > budget) continue;
      selected.push(item);
      tokenEstimate += cost;
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
  private async withProfile(base: MemoryContextBlock, input: MemoryContextInput, candidates: MemoryRecord[]): Promise<MemoryContextBlock> {
    const profile = renderMemoryProfile(candidates, input.now, { maxChars: PROFILE_MAX_CHARS });
    if (!profile) return base;
    const retrievalMode = base.memories.length || base.instructions.length ? base.retrievalMode : 'profile';
    return { ...base, profile, tokenEstimate: base.tokenEstimate + estimateTokens(profile), retrievalMode };
  }
}

export function renderMemoryContext(block: MemoryContextBlock): string {
  const parts: string[] = [];
  if (block.profile) parts.push(`What you know about the user:\n${block.profile}`);
  if (block.memories.length || block.instructions.length || block.summary) {
    const lines = ['Relevant saved memory:'];
    if (block.summary) lines.push(`- Summary: ${block.summary}`);
    for (const instruction of block.instructions) lines.push(`- Instruction: ${instruction}`);
    for (const memory of block.memories) {
      if (memory.kind === 'instruction') continue;
      lines.push(`- ${memory.kind}: ${memory.text}`);
    }
    parts.push(lines.join('\n'));
  }
  return parts.join('\n\n');
}