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
   *  query without a second credential unwrap. When absent, retrieval falls back to lexical. */
  creds?: EmbedCredentials;
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
const MIN_MEMORY_SCORE = 0.45;
const CANDIDATE_LIMIT = 40;
const VECTOR_CANDIDATE_LIMIT = 200;
const RELEVANCE_FLOOR = 0.3;
const W_RELEVANCE = 0.6;
const W_IMPORTANCE = 0.25;
const W_RECENCY = 0.15;
const RECENCY_HALFLIFE_DAYS = 45;
const PROFILE_MAX_CHARS = 2400;

function tokens(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9_-]{3,}/g) ?? []).filter((t) => !STOP.has(t)));
}

const STOP = new Set([
  'the',
  'and',
  'for',
  'that',
  'this',
  'what',
  'where',
  'when',
  'should',
  'could',
  'would',
  'with',
  'user',
  'about',
  'know',
  'tell',
  'give',
  'make',
  'write',
]);

export function shouldConsiderMemory(raw: string, query: Set<string>): boolean {
  if (!query.size) return false;
  return /\b(my|mine|our|ours|remember|memory|profile|preference|prefer|usually|previously|last time|what did we|what do you know about me|wife|husband|son|daughter|family|pet|dog|cat|chopper|one piece|project|repo|repository|deploy|watai|azure|github)\b/i.test(raw);
}

export function broadProfileQuery(raw: string): boolean {
  return /\b(what do you know about me|my profile|remember about me|my memory|what have you remembered)\b/i.test(raw);
}

export function candidateQuery(raw: string, query: Set<string>): string | undefined {
  if (broadProfileQuery(raw)) return undefined;
  const priority = ['watai', 'deploy', 'azure', 'github', 'repo', 'repository', 'project', 'dog', 'cat', 'pet', 'chopper', 'one', 'piece', 'preference', 'prefer'];
  const terms = [...query];
  return priority.find((term) => terms.includes(term)) ?? terms.sort((a, b) => b.length - a.length)[0];
}

function textFor(memory: MemoryRecord): string {
  return [memory.text, memory.summary, ...(memory.entities ?? []), ...(memory.topics ?? [])].filter(Boolean).join(' ');
}

function lexicalScore(query: Set<string>, memory: MemoryRecord): number {
  if (!query.size) return 0;
  const doc = tokens(textFor(memory));
  let overlap = 0;
  for (const token of query) if (doc.has(token)) overlap++;
  if (!overlap) return 0;
  const lexical = overlap / query.size;
  const visibilityBoost = memory.visibility === 'top_of_mind' ? 0.08 : memory.visibility === 'background' ? -0.05 : 0;
  return Math.max(0, Math.min(1, lexical * 0.65 + memory.salience * 0.25 + memory.confidence * 0.1 + visibilityBoost));
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function memoryQueryTokens(text: string): Set<string> {
  return tokens(text);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
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
    const settings = await this.settings.get(input.userId).catch(() => undefined);
    if (settings) {
      const memory = effectiveMemorySettings(settings);
      if (!memory.enabled || memory.paused || !memory.referenceSaved) return { ...EMPTY, latencyBudgetMs: 250 };
    }
    const vector = this.embedder && this.retriever && input.creds ? await this.buildVector(input) : null;
    const base = vector ?? (await this.buildLexical(input));
    return this.profileEnabled ? this.withProfile(base, input) : base;
  }

  /** Semantic retrieval: embed the query, vector-rank candidates above a relevance floor.
   *  Returns null when the embedding call itself fails, so the caller falls back to lexical. */
  private async buildVector(input: MemoryContextInput): Promise<MemoryContextBlock | null> {
    const queryVec = await this.embedder!.embed(input.creds!, input.latestUserText).catch(() => null);
    if (!queryVec) return null;
    const result = await this.retriever!
      .retrieve(input.userId, queryVec, { now: input.now, limit: MAX_SELECTED_MEMORIES, candidateLimit: VECTOR_CANDIDATE_LIMIT })
      .catch(() => null);
    // No embedded candidates yet (e.g. memories predate the embedding rollout) → fall back to
    // lexical so retrieval never regresses while embeddings backfill on subsequent writes.
    if (!result || result.embeddedCandidates === 0) return null;
    const nowMs = Date.parse(input.now);
    const ranked = result.scored
      .filter((item) => item.relevance >= RELEVANCE_FLOOR || item.memory.pinned || item.memory.visibility === 'top_of_mind')
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

  /** Keyword fallback used when no embedder/retriever is configured. */
  private async buildLexical(input: MemoryContextInput): Promise<MemoryContextBlock> {
    const query = tokens(input.latestUserText);
    if (!query.size) return { ...EMPTY, latencyBudgetMs: 250 };
    if (!shouldConsiderMemory(input.latestUserText, query)) return { ...EMPTY, latencyBudgetMs: 250 };

    const q = candidateQuery(input.latestUserText, query);
    const page = await this.store.list(input.userId, { status: 'active', ...(q ? { q } : {}), limit: broadProfileQuery(input.latestUserText) ? 20 : CANDIDATE_LIMIT });
    const scored = page.memories
      .map((memory) => ({ memory, score: lexicalScore(query, memory) }))
      .filter((item) => item.score >= MIN_MEMORY_SCORE || item.memory.pinned || item.memory.visibility === 'top_of_mind')
      .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt) || b.memory.id.localeCompare(a.memory.id));

    const budget = input.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const selected: typeof scored = [];
    let tokenEstimate = 0;
    for (const item of scored) {
      const cost = estimateTokens(item.memory.text) + 12;
      if (selected.length >= MAX_SELECTED_MEMORIES || tokenEstimate + cost > budget) continue;
      selected.push(item);
      tokenEstimate += cost;
    }

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
      retrievalMode: 'lexical',
    };
  }

  /** Always-on identity profile, prepended to every run when enabled. Sensitive memories excluded. */
  private async withProfile(base: MemoryContextBlock, input: MemoryContextInput): Promise<MemoryContextBlock> {
    const page = await this.store.list(input.userId, { status: 'active', limit: VECTOR_CANDIDATE_LIMIT }).catch(() => ({ memories: [] as MemoryRecord[] }));
    const profile = renderMemoryProfile(page.memories, input.now, { maxChars: PROFILE_MAX_CHARS });
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