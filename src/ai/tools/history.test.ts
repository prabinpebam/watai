import { describe, it, expect, vi } from 'vitest';
import type { Repository } from '../../data/repository';
import {
  searchHistoryTool,
  runSearchHistory,
  threadSummaryTool,
  runThreadSummary,
} from './history';

function fakeRepo(over: Partial<Repository> = {}): Repository {
  return {
    search: vi.fn(async () => []),
    listMessages: vi.fn(async () => []),
    ...over,
  } as unknown as Repository;
}

describe('search_history tool', () => {
  it('is a function tool named search_history requiring a query', () => {
    expect(searchHistoryTool.type).toBe('function');
    expect(searchHistoryTool.name).toBe('search_history');
    expect((searchHistoryTool.parameters as { required: string[] }).required).toContain('query');
  });

  it('asks for a query when none is given', async () => {
    const res = await runSearchHistory({}, fakeRepo());
    expect(res.output).toMatch(/no search query/i);
  });

  it('reports when there are no matches', async () => {
    const res = await runSearchHistory({ query: 'bicep' }, fakeRepo({ search: vi.fn(async () => []) }));
    expect(res.output).toMatch(/no matching/i);
  });

  it('summarizes hits and bounds the output length', async () => {
    const hits = Array.from({ length: 30 }, (_, i) => ({
      thread: { id: `t${i}`, title: `Title ${i}` },
      messageId: `m${i}`,
      snippet: `snippet ${i} `.repeat(40),
    }));
    const res = await runSearchHistory(
      { query: 'x' },
      fakeRepo({ search: vi.fn(async () => hits as never) }),
    );
    expect(res.output).toContain('Title 0');
    expect(res.output.length).toBeLessThanOrEqual(2100);
  });
});

describe('get_thread_summary tool', () => {
  it('requires a threadId', async () => {
    const res = await runThreadSummary({}, fakeRepo());
    expect(res.output).toMatch(/no thread/i);
    expect(threadSummaryTool.name).toBe('get_thread_summary');
  });

  it('returns the conversation transcript, bounded', async () => {
    const msgs = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello there' },
    ];
    const res = await runThreadSummary(
      { threadId: 't1' },
      fakeRepo({ listMessages: vi.fn(async () => msgs as never) }),
    );
    expect(res.output).toContain('user: hi');
    expect(res.output).toContain('assistant: hello there');
  });

  it('handles an empty thread', async () => {
    const res = await runThreadSummary({ threadId: 't1' }, fakeRepo({ listMessages: vi.fn(async () => []) }));
    expect(res.output).toMatch(/no messages/i);
  });
});
