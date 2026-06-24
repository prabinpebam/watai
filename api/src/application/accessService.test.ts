import { describe, it, expect } from 'vitest';
import { AccessService } from './accessService';
import { InMemoryInviteStore } from '../adapters/memory/inviteStore';
import { AppError } from '../domain/errors';

const ADMIN = 'admin@example.com';
const ADMIN_OID = 'admin-oid-123';

function setup() {
  const invites = new InMemoryInviteStore();
  return { invites, access: new AccessService(invites, ADMIN, [ADMIN_OID]) };
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
    expect(access.isAdmin({ email: 'ADMIN@example.com' })).toBe(true);
    expect(await access.isInvited({ email: 'admin@example.com' })).toBe(true);
    await access.requireInvited({ email: 'Admin@Example.com' });
    await access.requireAdmin({ email: 'admin@example.com' });
  });

  it('the admin is recognized by oid even when the email claim is absent', async () => {
    const { access } = setup();
    expect(access.isAdmin({ oid: 'ADMIN-OID-123' })).toBe(true);
    expect(await access.isInvited({ oid: 'admin-oid-123' })).toBe(true);
    await access.requireAdmin({ oid: 'admin-oid-123' });
  });

  it('an invited user passes the data gate but not the admin gate', async () => {
    const { invites, access } = setup();
    await invites.put({ email: 'friend@example.com', invitedBy: ADMIN, createdAt: 'now' });
    expect(await access.isInvited({ email: 'FRIEND@example.com' })).toBe(true);
    expect(access.isAdmin({ email: 'friend@example.com' })).toBe(false);
    await access.requireInvited({ email: 'friend@example.com' });
    expect(await code(() => access.requireAdmin({ email: 'friend@example.com' }))).toBe('forbidden');
  });

  it('an uninvited user is forbidden from both data and admin routes', async () => {
    const { access } = setup();
    expect(await access.isInvited({ email: 'stranger@example.com' })).toBe(false);
    expect(await code(() => access.requireInvited({ email: 'stranger@example.com' }))).toBe('forbidden');
    expect(await code(() => access.requireAdmin({ email: 'stranger@example.com' }))).toBe('forbidden');
  });

  it('a token with no email is forbidden (fails closed)', async () => {
    const { access } = setup();
    expect(await access.isInvited({})).toBe(false);
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
