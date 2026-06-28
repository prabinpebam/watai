import { describe, expect, it } from 'vitest';
import { CosmosMemoryStore } from './memoryStore';

describe('CosmosMemoryStore', () => {
  it('lists memories without requiring a composite ORDER BY index', async () => {
    let queryText = '';
    const container = {
      items: {
        query: (spec: { query: string }) => {
          queryText = spec.query;
          return { fetchAll: async () => ({ resources: [] }) };
        },
      },
    };
    const store = new CosmosMemoryStore(container as never);

    await store.list('userA', { status: 'active', limit: 50 });

    expect(queryText).toContain('ORDER BY c.updatedAt DESC');
    expect(queryText).not.toContain('ORDER BY c.updatedAt DESC, c.id DESC');
  });
});