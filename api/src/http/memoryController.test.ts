import { describe, expect, it, beforeEach } from 'vitest';
import { InMemoryMemoryStore } from '../adapters/memory/memoryStore';
import { MemoryService } from '../application/memoryService';
import { createMemoryController } from './memoryController';

function makeController() {
  const store = new InMemoryMemoryStore();
  let n = 0;
  let t = 0;
  const service = new MemoryService(store, {
    newId: () => `mem_${++n}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z`,
  });
  return createMemoryController(service);
}

describe('memoryController', () => {
  let ctrl: ReturnType<typeof makeController>;
  beforeEach(() => (ctrl = makeController()));

  it('creates, lists, patches, and deletes caller-owned memories', async () => {
    const created = await ctrl.create({ claims: { sub: 'userA' }, body: { text: 'Remember rg-watai-dev.', kind: 'project_context' } });
    expect(created.status).toBe(201);
    const id = (created.body as any).id;

    const listed = await ctrl.list({ claims: { sub: 'userA' }, query: { q: 'rg-watai' } });
    expect(listed.status).toBe(200);
    expect((listed.body as any).memories).toHaveLength(1);

    const patched = await ctrl.patch({ claims: { sub: 'userA' }, params: { memoryId: id }, body: { status: 'suppressed' } });
    expect(patched.status).toBe(200);
    expect((patched.body as any).status).toBe('suppressed');

    const removed = await ctrl.remove({ claims: { sub: 'userA' }, params: { memoryId: id } });
    expect(removed.status).toBe(204);
  });

  it('maps auth, validation, and cross-user failures to envelopes', async () => {
    expect((await ctrl.list({ claims: {} })).status).toBe(401);
    const invalid = await ctrl.create({ claims: { sub: 'userA' }, body: { text: 'my token is sk-1234567890abcdef' } });
    expect(invalid.status).toBe(400);
    expect((invalid.body as any).error.code).toBe('validation');

    const created = await ctrl.create({ claims: { sub: 'userA' }, body: { text: 'Only mine.' } });
    const hidden = await ctrl.patch({ claims: { sub: 'userB' }, params: { memoryId: (created.body as any).id }, body: { pinned: true } });
    expect(hidden.status).toBe(404);
  });

  it('reads and writes the summary endpoint', async () => {
    const empty = await ctrl.getSummary({ claims: { sub: 'userA' } });
    expect(empty.status).toBe(200);
    expect((empty.body as any).summary).toBeNull();

    const saved = await ctrl.putSummary({ claims: { sub: 'userA' }, body: { text: 'Short summary.' } });
    expect(saved.status).toBe(200);
    expect((saved.body as any).text).toBe('Short summary.');

    const next = await ctrl.getSummary({ claims: { sub: 'userA' } });
    expect((next.body as any).summary.text).toBe('Short summary.');
  });

  it('returns a structured profile derived from active memory evidence', async () => {
    await ctrl.create({ claims: { sub: 'userA' }, body: { text: 'User has a dog named Chopper inspired by One Piece.', kind: 'fact' } });

    const res = await ctrl.profile({ claims: { sub: 'userA' } });

    expect(res.status).toBe(200);
    expect((res.body as any).profile.user.family.pets[0]).toMatchObject({ name: 'Chopper', species: 'dog' });
  });
});