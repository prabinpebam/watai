import { describe, it, expect, vi } from 'vitest';
import { runWebSearch, webSearchTool } from './webSearch';

describe('web_search tool', () => {
  it('is a function tool named web_search requiring a query', () => {
    expect(webSearchTool.type).toBe('function');
    expect(webSearchTool.name).toBe('web_search');
    const params = webSearchTool.parameters as { required?: string[] };
    expect(params.required).toContain('query');
  });

  it('summarizes results and returns web citations (with favicons + raw content)', async () => {
    const search = vi.fn(async () => ({
      query: 'q',
      answer: 'Short answer',
      results: [
        { title: 'A', url: 'https://a.com', content: 'alpha', favicon: 'https://a.com/f.ico' },
        { title: 'B', url: 'https://b.com', content: 'beta' },
      ],
    }));
    const res = await runWebSearch({ query: 'q' }, { search });
    expect(res.output).toContain('Short answer');
    expect(res.output).toContain('https://a.com');
    expect(res.citations).toEqual([
      { source: 'web', url: 'https://a.com', title: 'A', favicon: 'https://a.com/f.ico', content: 'alpha' },
      { source: 'web', url: 'https://b.com', title: 'B', content: 'beta' },
    ]);
    expect(search).toHaveBeenCalledWith('q', { topic: undefined, timeRange: undefined });
  });

  it('passes a valid topic and time_range through', async () => {
    const search = vi.fn(async () => ({ query: 'q', results: [] }));
    await runWebSearch({ query: 'q', topic: 'news', time_range: 'week' }, { search });
    expect(search).toHaveBeenCalledWith('q', { topic: 'news', timeRange: 'week' });
  });

  it('guards a blank query without calling Tavily', async () => {
    const search = vi.fn();
    const res = await runWebSearch({ query: '   ' }, { search });
    expect(res.output).toMatch(/No query/);
    expect(search).not.toHaveBeenCalled();
  });

  it('returns a friendly output (not a throw) when the search fails', async () => {
    const search = vi.fn(async () => {
      throw new Error('boom');
    });
    const res = await runWebSearch({ query: 'q' }, { search });
    expect(res.output).toMatch(/Web search failed: boom/);
    expect(res.citations).toBeUndefined();
  });
});
