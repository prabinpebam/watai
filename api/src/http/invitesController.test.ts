import { describe, it, expect } from 'vitest';
import { createInvitesController } from './invitesController';
import { createMeController } from './meController';
import { AccessService } from '../application/accessService';
import { InMemoryInviteStore } from '../adapters/memory/inviteStore';

const clock = { now: () => '2026-01-01T00:00:00Z', newId: () => 'id' };

describe('invitesController', () => {
  it('POST adds an invite (201), recording invitedBy from the token and normalizing the email', async () => {
    const invites = new InMemoryInviteStore();
    const ctrl = createInvitesController(invites, clock);
    const res = await ctrl.create({
      claims: { email: 'admin@example.com' },
      body: { email: 'Friend@Example.com' },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ email: 'friend@example.com', invitedBy: 'admin@example.com' });
  });

  it('GET lists invites and DELETE removes one (204)', async () => {
    const invites = new InMemoryInviteStore();
    const ctrl = createInvitesController(invites, clock);
    await invites.put({ email: 'a@b.com', invitedBy: 'admin@example.com', createdAt: 'now' });

    const list = await ctrl.list({ claims: { email: 'admin@example.com' } });
    expect((list.body as { invites: unknown[] }).invites).toHaveLength(1);

    const del = await ctrl.remove({ claims: { email: 'admin@example.com' }, params: { email: 'a@b.com' } });
    expect(del.status).toBe(204);
    expect((await ctrl.list({ claims: {} })).body).toEqual({ invites: [] });
  });

  it('rejects an invalid email → 400', async () => {
    const ctrl = createInvitesController(new InMemoryInviteStore(), clock);
    const res = await ctrl.create({ claims: { email: 'admin@example.com' }, body: { email: 'nope' } });
    expect(res.status).toBe(400);
  });
});

describe('meController', () => {
  it('reports admin / invited / neither based on the allowlist', async () => {
    const invites = new InMemoryInviteStore();
    await invites.put({ email: 'friend@example.com', invitedBy: 'admin@example.com', createdAt: 'now' });
    const ctrl = createMeController(new AccessService(invites, 'admin@example.com'));

    expect((await ctrl.get({ claims: { email: 'admin@example.com' } })).body).toEqual({
      email: 'admin@example.com',
      isAdmin: true,
      isInvited: true,
    });
    expect((await ctrl.get({ claims: { email: 'friend@example.com' } })).body).toEqual({
      email: 'friend@example.com',
      isAdmin: false,
      isInvited: true,
    });
    expect((await ctrl.get({ claims: { email: 'stranger@example.com' } })).body).toEqual({
      email: 'stranger@example.com',
      isAdmin: false,
      isInvited: false,
    });
  });
});
