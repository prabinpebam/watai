import { beforeEach, describe, expect, it, vi } from 'vitest';

const opened = vi.hoisted(() => vi.fn());

vi.mock('idb', () => ({
  openDB: opened,
}));

import { db } from './db';

beforeEach(() => {
  opened.mockReset();
  opened.mockImplementation(async (name: string) => ({ name }));
});

describe('local database owner scope', () => {
  it('opens distinct owner databases and never auto-claims the legacy global database', async () => {
    await db('owner-a');
    await db('owner-b');

    const names = opened.mock.calls.map(([name]) => name);
    expect(names).toHaveLength(2);
    expect(names[0]).not.toBe(names[1]);
    expect(names).not.toContain('watai');
  });
});
