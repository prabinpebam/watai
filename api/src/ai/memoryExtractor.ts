import { completeChat } from './chat';
import type { DecryptedCredentials } from '../application/credentialService';
import { parseMemoryExtractionOutput, type MemoryExtractionOutput } from '../domain/memoryExtraction';

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
  const input = raw as Record<string, unknown>;
  const op = input.op ?? input.operation ?? input.action;
  const sourceMessageIds =
    input.sourceMessageIds ?? input.source_message_ids ?? input.sourceIds ?? input.source_ids ?? input.sourceMessageId;
  const normalizedOp = typeof op === 'string' ? op.toLowerCase() : undefined;
  const normalizedKind = typeof input.kind === 'string' ? normalizeKind(input.kind) : undefined;
  const {
    operation: _operation,
    action: _action,
    source_message_ids: _sourceMessageIdsSnake,
    sourceIds: _sourceIds,
    source_ids: _sourceIdsSnake,
    sourceMessageId: _sourceMessageId,
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

export async function extractMemories(
  creds: DecryptedCredentials,
  input: MemoryExtractionInput,
  fetchImpl?: typeof fetch,
): Promise<MemoryExtractionOutput> {
  const system = [
    'You extract durable memories for Watai.',
    'Store durable facts, preferences, instructions, work style, project context, avoidances, procedures, or completed-work context that will be useful in future conversations.',
    'Stable personal facts are memory-worthy when non-sensitive, for example pet names, recurring interests, project names, preferred tools, communication style, or durable fandom/context the user volunteers.',
    'Example: if the user says "I have a dog called Chopper inspired by One Piece", add a fact memory that the user has a dog named Chopper inspired by One Piece.',
    'Do not store secrets, credentials, one-off requests, private third-party details, hidden reasoning, or guesses about emotions.',
    'Prefer concise source-linked memories. Current user corrections can invalidate older memories.',
    'Return strict JSON only with shape {"operations":[...]}. Valid ops are add, merge, invalidate, suppress, ignore.',
  ].join('\n');
  const raw = await completeChat({
    baseUrl: creds.baseUrl,
    key: creds.key,
    model: creds.models.chat,
    reasoningEffort: 'minimal',
    maxCompletionTokens: 1200,
    timeoutMs: 45_000,
    fetchImpl,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: JSON.stringify(input) },
    ],
  });
  if (!raw) throw new Error('Memory extractor returned an empty response.');
  const fallbackSourceMessageIds = [...input.messages].reverse().filter((message) => message.role === 'user').slice(0, 1).map((message) => message.id);
  return parseMemoryExtractionOutput(normalizeMemoryExtractionJson(extractJson(raw), fallbackSourceMessageIds));
}