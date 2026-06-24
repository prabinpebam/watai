import { describe, it, expect } from 'vitest';
import { AccessService } from './accessService';
import { InMemoryInviteStore } from '../adapters/memory/inviteStore';
import { AppError } from '../domain/errors';

const ADMIN = 'admin@example.com';

function setup() {
  const invites = new InMemoryInviteStore();
  return { invites, access: new AccessService(invites, ADMIN) };
}

async function code(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

describe('AccessService', () => {
  it('the admin is always allowed (case-insensitive), even without an invite', async () => {
    const { access } = setup();
    expect(access.isAdmin('ADMIN@example.com')).toBe(true);
    expect(await access.isInvited('admin@example.com')).toBe(true);
    await access.requireInvited({ email: 'Admin@Example.com' });
    await access.requireAdmin({ email: 'admin@example.com' });
  });

  it('an invited user passes the data gate but not the admin gate', async () => {
    const { invites, access } = setup();
    await invites.put({ email: 'friend@example.com', invitedBy: ADMIN, createdAt: 'now' });
    expect(await access.isInvited('FRIEND@example.com')).toBe(true);
    expect(access.isAdmin('friend@example.com')).toBe(false);
    await access.requireInvited({ email: 'friend@example.com' });
    expect(await code(() => access.requireAdmin({ email: 'friend@example.com' }))).toBe('forbidden');
  });

  it('an uninvited user is forbidden from both data and admin routes', async () => {
    const { access } = setup();
    expect(await access.isInvited('stranger@example.com')).toBe(false);
    expect(await code(() => access.requireInvited({ email: 'stranger@example.com' }))).toBe('forbidden');
    expect(await code(() => access.requireAdmin({ email: 'stranger@example.com' }))).toBe('forbidden');
  });

  it('a token with no email is forbidden (fails closed)', async () => {
    const { access } = setup();
    expect(await access.isInvited(undefined)).toBe(false);
    expect(await code(() => access.requireInvited({ sub: 'x' }))).toBe('forbidden');
  });

  it('reads email from preferred_username and emails[] claim shapes', async () => {
    const { invites, access } = setup();
    await invites.put({ email: 'pu@example.com', invitedBy: ADMIN, createdAt: 'now' });
    await access.requireInvited({ preferred_username: 'PU@example.com' });
    await invites.put({ email: 'arr@example.com', invitedBy: ADMIN, createdAt: 'now' });
    await access.requireInvited({ emails: ['arr@example.com'] });
  });
});
