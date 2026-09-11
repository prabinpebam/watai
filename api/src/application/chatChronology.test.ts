import { describe, expect, it, vi } from 'vitest';
import { RunService } from './runService';
import { MessageService } from './messageService';
import { processRun } from './runWorker';
import { parseRunInput } from '../domain/run';
import { InMemoryRunStore } from '../adapters/memory/runStore';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { InMemoryMessageStore } from '../adapters/memory/messageStore';
import type { MessageRecord } from '../ports/messageStore';

describe('release-blocking chat chronology', () => {
  it('preserves admitted logical times in every server snapshot and retry', async () => {
    const runStore = new InMemoryRunStore();
    const threads = new InMemoryThreadStore();
    const messages = new InMemoryMessageStore();
    let sequence = 0;
    const clock = { newId: () => `id-${++sequence}`, now: () => new Date(Date.parse('2026-01-01T00:00:00.000Z') + ++sequence).toISOString() };
    await threads.put({ id: 'thread', userId: 'owner', title: 'Chronology', pinned: false, archived: false, temporary: false, messageCount: 0, createdAt: clock.now(), updatedAt: clock.now(), deletedAt: null });
    const messageOrder = { user: '2026-09-11T12:00:00.000Z', assistant: '2026-09-11T12:00:00.001Z' };
    const service = new RunService(threads, new MessageService(threads, messages, clock), runStore, { start: async () => ({ instanceId: 'instance' }), cancel: async () => undefined }, clock);
    const input = { text: 'Keep this turn stable.', clientMessageId: 'prompt', messageOrder };
    const run = await service.submit('owner', 'thread', input);
    expect(await messages.get('owner', 'thread', 'prompt')).toMatchObject({ orderAt: messageOrder.user });
    expect(run).toMatchObject({ messageOrder });
    expect(run.createdAt.startsWith('2026-01-01')).toBe(true);
    expect((await service.submit('owner', 'thread', input)).id).toBe(run.id);
    await expect(service.submit('owner', 'thread', { ...input, messageOrder: { ...messageOrder, assistant: '2026-09-11T12:00:00.002Z' } })).rejects.toMatchObject({ code: 'conflict' });
    const snapshots: MessageRecord[] = [];
    const append = messages.append.bind(messages);
    vi.spyOn(messages, 'append').mockImplementation(async record => { snapshots.push(structuredClone(record)); return append(record); });
    await processRun({ runStore, threadStore: threads, messageStore: messages, clock, flushIntervalMs: 0,
      credentials: { getDecrypted: async () => ({ baseUrl: 'https://test.openai.azure.com/openai/v1', key: 'synthetic', models: { chat: 'test' } }) },
      runAgent: async function* () { yield { type: 'text', delta: 'First chunk.' }; yield { type: 'text', delta: ' Second chunk.' }; yield { type: 'done' }; },
    }, 'owner', 'thread', run.id);
    expect(snapshots.length).toBeGreaterThan(1);
    expect(snapshots.every(record => record.orderAt === messageOrder.assistant && record.createdAt.startsWith('2026-01-01'))).toBe(true);
    expect(snapshots.at(-1)?.status).toBe('complete');
  });

  it.each([
    { user: 'invalid', assistant: '2026-09-11T12:00:00.001Z' },
    { user: '2026-09-11T12:00:00Z', assistant: '2026-09-11T12:00:00.001Z' },
    { user: '2026-09-11T12:00:00.000Z', assistant: '2026-09-11T12:00:00.000Z' },
    { user: '2026-09-11T12:00:00.002Z', assistant: '2026-09-11T12:00:00.001Z' },
  ])('rejects ambiguous or inverted ordering: %j', messageOrder => {
    expect(() => parseRunInput({ text: 'x', messageOrder })).toThrow();
  });
});