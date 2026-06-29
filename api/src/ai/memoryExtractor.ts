import { completeChat } from './chat';
import type { DecryptedCredentials } from '../application/credentialService';
import { memoryExtractionOperationSchema, type MemoryExtractionOperation, type MemoryExtractionOutput } from '../domain/memoryExtraction';

export interface MemoryExtractionInput {
  mode: 'command' | 'turn' | 'rebuild';
  now: string;
  threadId: string;
  threadTitle?: string;
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string }>;
  existingMemories: Array<{ id: string; kind: string; status: string; text: string; entities?: string[]; topics?: string[]; validAt?: string; invalidAt?: string }>;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Extractor returned no JSON object.');
  return JSON.parse(trimmed.slice(start, end + 1));
}

function normalizeOperation(raw: unknown, fallbackSourceMessageIds: string[] = []): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  let input = raw as Record<string, unknown>;
  // Some models wrap the payload in a memory/item/data/fact object instead of using flat fields;
  // lift those fields up (flat top-level fields win) so the strict schema can still parse them.
  const nested = input.memory ?? input.item ?? input.data ?? input.fact;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const { memory: _m, item: _i, data: _d, fact: _f, ...top } = input;
    input = { ...(nested as Record<string, unknown>), ...top };
  }
  const op = input.op ?? input.operation ?? input.action;
  const sourceMessageIds =
    input.sourceMessageIds ?? input.source_message_ids ?? input.sourceIds ?? input.source_ids ?? input.sourceMessageId ?? input.source ?? input.sources;
  const kindRaw = input.kind ?? input.type ?? input.category;
  const normalizedOp = typeof op === 'string' ? op.toLowerCase() : undefined;
  const normalizedKind = typeof kindRaw === 'string' ? normalizeKind(kindRaw) : undefined;
  const {
    operation: _operation,
    action: _action,
    source_message_ids: _sourceMessageIdsSnake,
    sourceIds: _sourceIds,
    source_ids: _sourceIdsSnake,
    sourceMessageId: _sourceMessageId,
    source: _source,
    sources: _sources,
    memory: _memory,
    item: _item,
    data: _data,
    fact: _fact,
    type: _type,
    category: _category,
    memory_id: _memoryId,
    replacement_text: _replacementText,
    valid_at: _validAt,
    kind: _kind,
    ...rest
  } = input;
  return {
    ...rest,
    ...(normalizedOp ? { op: normalizeOp(normalizedOp) } : {}),
    ...(input.memoryId === undefined && input.memory_id !== undefined ? { memoryId: input.memory_id } : {}),
    ...(input.replacementText === undefined && input.replacement_text !== undefined ? { replacementText: input.replacement_text } : {}),
    ...(input.validAt === undefined && input.valid_at !== undefined ? { validAt: input.valid_at } : {}),
    ...(sourceMessageIds !== undefined
      ? { sourceMessageIds: Array.isArray(sourceMessageIds) ? sourceMessageIds : [sourceMessageIds] }
      : normalizedOp && normalizedOp !== 'ignore' && fallbackSourceMessageIds.length
        ? { sourceMessageIds: fallbackSourceMessageIds }
      : {}),
    ...(normalizeOp(normalizedOp ?? '') === 'add' && normalizedKind ? { kind: normalizedKind } : {}),
    ...(normalizedOp === 'add' && input.confidence === undefined ? { confidence: 0.75 } : {}),
    ...(normalizedOp === 'add' && input.salience === undefined ? { salience: 0.6 } : {}),
    ...(input.reason === undefined ? { reason: 'Extractor proposed this operation.' } : {}),
  };
}

function normalizeOp(op: string): string {
  const value = op.toLowerCase().replace(/[\s-]+/g, '_');
  if (value === 'update') return 'merge';
  if (value === 'delete' || value === 'forget' || value === 'hide') return 'suppress';
  return value;
}

function normalizeKind(kind: string): string {
  const value = kind.toLowerCase().replace(/[\s-]+/g, '_');
  if (['personal_fact', 'user_fact', 'profile', 'profile_fact'].includes(value)) return 'fact';
  if (['communication_style', 'response_style', 'style'].includes(value)) return 'work_style';
  if (['project', 'project_fact', 'workspace_context'].includes(value)) return 'project_context';
  if (['dont', 'do_not', 'negative_preference'].includes(value)) return 'avoidance';
  return value;
}

export function normalizeMemoryExtractionJson(raw: unknown, fallbackSourceMessageIds: string[] = []): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const input = raw as Record<string, unknown>;
  const operations = Array.isArray(raw) ? raw : input.operations ?? input.memories ?? input.memory_updates ?? input.memoryUpdates;
  return {
    operations: Array.isArray(operations) ? operations.map((op) => normalizeOperation(op, fallbackSourceMessageIds)) : operations,
  };
}

/**
 * Parse the normalized extractor output resiliently. A single malformed operation must never
 * discard the entire turn (small models frequently emit a slightly-off optional `target`).
 * For each operation: try strict parse; if it fails and the op carries a `target`, retry without
 * the target (keeping the atomic memory); drop only operations that are still invalid. If nothing
 * survives, return an `ignore` so the job completes cleanly instead of failing/poisoning.
 */
export function resilientParseExtraction(normalized: unknown): MemoryExtractionOutput {
  const list =
    normalized && typeof normalized === 'object' && Array.isArray((normalized as { operations?: unknown }).operations)
      ? ((normalized as { operations: unknown[] }).operations)
      : [];
  const operations: MemoryExtractionOperation[] = [];
  for (const op of list) {
    if (operations.length >= 16) break;
    let parsed = memoryExtractionOperationSchema.safeParse(op);
    if (!parsed.success && op && typeof op === 'object' && 'target' in (op as Record<string, unknown>)) {
      const { target: _droppedTarget, ...withoutTarget } = op as Record<string, unknown>;
      parsed = memoryExtractionOperationSchema.safeParse(withoutTarget);
    }
    if (parsed.success) operations.push(parsed.data);
  }
  if (!operations.length) return { operations: [{ op: 'ignore', reason: 'No valid memory operations were produced.' }] };
  return { operations };
}

export async function extractMemories(
  creds: DecryptedCredentials,
  input: MemoryExtractionInput,
  opts?: { model?: string; fetchImpl?: typeof fetch },
): Promise<MemoryExtractionOutput> {
  const system = [
    'You extract durable memories for Watai.',
    'Store durable facts, preferences, instructions, work style, project context, avoidances, procedures, or completed-work context that will be useful in future conversations.',
    'Be selective. Most single-turn requests, casual comments, examples, jokes, temporary formatting requests, and transient task details should return ignore.',
    'Only add memory when the detail is likely to improve future conversations, is explicitly requested, is repeated/confirmed, or is a high-salience stable profile/work fact.',
    'Be eager to capture durable personal/profile facts the user shares about themselves — their name/nickname, family members and their names/ages, pets (with names and breeds), home/location, job/role, and stable preferences — even when stated casually or spread across several short messages.',
    'Named family relationships and directly stated ages are high-salience profile facts; combine them into one concise memory when possible, for example "User has a daughter named Laija who is 9 years old."',
    'Optionally include target for add/merge only when you are fully certain it matches the schema (layer, profilePath, entity, relationship, temporal, evidenceStrategy). If unsure, omit target entirely and never invent profilePath values; a missing target is fine.',
    'Stable personal facts such as pet names can be memory-worthy, but only assign high salience when the fact is clearly durable and likely useful later.',
    'Example high-salience memory: if the user says "Remember that my dog is called Chopper", add a fact memory. Example lower-salience or ignore: a casual one-off example unless future usefulness is clear.',
    'Do not store secrets, credentials, one-off requests, private third-party details, hidden reasoning, or guesses about emotions.',
    'Prefer concise source-linked memories. Current user corrections can invalidate older memories.',
    'When the user gives a NEW detail (age, role, location, name, relationship, status…) about someone or something already present in existingMemories, MERGE it: set memoryId to that existing memory and provide the full updated text that includes the new detail. Do not create a duplicate. Use invalidate only when the new information contradicts and replaces the old.',
    'Return strict JSON only: {"operations":[ ... ]} — no prose, no markdown fences.',
    'Every operation uses FLAT fields with these EXACT names (never nest fields under a "memory" object):',
    '  add:        {"op":"add","kind":"fact|preference|instruction|work_style|project_context|avoidance|procedure","text":"<concise statement>","entities":["<optional>"],"confidence":0.0-1.0,"salience":0.0-1.0,"sourceMessageIds":["<id of the source message>"],"reason":"<why>"}',
    '  merge:      {"op":"merge","memoryId":"<existing memory id>","text":"<optional updated text>","sourceMessageIds":["<id>"],"reason":"<why>"}',
    '  invalidate: {"op":"invalidate","memoryId":"<existing memory id>","sourceMessageIds":["<id>"],"reason":"<why>"}',
    '  suppress:   {"op":"suppress","memoryId":"<existing memory id>","sourceMessageIds":["<id>"],"reason":"<why>"}',
    '  ignore:     {"op":"ignore","reason":"<why nothing was stored>"}',
    'sourceMessageIds must contain the id(s) of the input messages you extracted from. confidence and salience are numbers between 0 and 1. Valid ops: add, merge, invalidate, suppress, ignore.',
  ].join('\n');
  const raw = await completeChat({
    baseUrl: creds.baseUrl,
    key: creds.key,
    model: opts?.model?.trim() || creds.models.chat,
    reasoningEffort: 'minimal',
    maxCompletionTokens: 1200,
    timeoutMs: 45_000,
    fetchImpl: opts?.fetchImpl,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(input) },
    ],
  });
  if (!raw) throw new Error('Memory extractor returned an empty response.');
  const fallbackSourceMessageIds = [...input.messages].reverse().filter((message) => message.role === 'user').slice(0, 1).map((message) => message.id);
  return resilientParseExtraction(normalizeMemoryExtractionJson(extractJson(raw), fallbackSourceMessageIds));
}