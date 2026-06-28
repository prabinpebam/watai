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

export async function extractMemories(
  creds: DecryptedCredentials,
  input: MemoryExtractionInput,
  fetchImpl?: typeof fetch,
): Promise<MemoryExtractionOutput> {
  const system = [
    'You extract durable memories for Watai.',
    'Store only facts, preferences, instructions, work style, project context, avoidances, procedures, or completed-work context that will be useful in future conversations.',
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
  return parseMemoryExtractionOutput(extractJson(raw));
}