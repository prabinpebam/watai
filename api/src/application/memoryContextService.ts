import type { MemoryContextBlock, MemoryRecord } from '../domain/memory';
import { effectiveMemorySettings, type Settings } from '../domain/settings';
import type { MemoryStore } from '../ports/memoryStore';

export interface MemoryContextInput {
  userId: string;
  threadId: string;
  latestUserText: string;
  now: string;
  tokenBudget?: number;
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
]);

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

export class MemoryContextService {
  constructor(
    private readonly store: MemoryStore,
    private readonly settings: MemorySettingsReader,
  ) {}

  async buildForRun(input: MemoryContextInput): Promise<MemoryContextBlock> {
    const settings = await this.settings.get(input.userId).catch(() => undefined);
    if (settings) {
      const memory = effectiveMemorySettings(settings);
      if (!memory.enabled || memory.paused || !memory.referenceSaved) return { ...EMPTY, latencyBudgetMs: 250 };
    }

    const query = tokens(input.latestUserText);
    if (!query.size) return { ...EMPTY, latencyBudgetMs: 250 };

    const page = await this.store.list(input.userId, { status: 'active', limit: 100 });
    const scored = page.memories
      .map((memory) => ({ memory, score: lexicalScore(query, memory) }))
      .filter((item) => item.score >= 0.2)
      .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt) || b.memory.id.localeCompare(a.memory.id));

    const budget = input.tokenBudget ?? 1200;
    const selected: typeof scored = [];
    let tokenEstimate = 0;
    for (const item of scored) {
      const cost = estimateTokens(item.memory.text) + 12;
      if (selected.length >= 8 || tokenEstimate + cost > budget) continue;
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
}

export function renderMemoryContext(block: MemoryContextBlock): string {
  if (!block.memories.length && !block.instructions.length && !block.summary) return '';
  const lines = ['Relevant saved memory:'];
  if (block.summary) lines.push(`- Summary: ${block.summary}`);
  for (const instruction of block.instructions) lines.push(`- Instruction: ${instruction}`);
  for (const memory of block.memories) {
    if (memory.kind === 'instruction') continue;
    lines.push(`- ${memory.kind}: ${memory.text}`);
  }
  return lines.join('\n');
}