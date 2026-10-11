import { describe, it, expect } from 'vitest';
import { AccessService } from './accessService';
import { InMemoryInviteStore } from '../adapters/memory/inviteStore';
import { AppError } from '../domain/errors';

const ADMIN = 'admin@example.com';
const ADMIN_OID = 'admin-oid-123';
const ISSUER = 'https://tenant.ciamlogin.com/tenant/v2.0';

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
  it('the configured immutable admin remains allowed when email changes', async () => {
    const { access } = setup();
    const claims = { oid: ADMIN_OID, email: 'changed@example.com' };
    expect(access.isAdmin(claims)).toBe(true);
    expect(await access.isInvited(claims)).toBe(true);
    await access.requireInvited(claims);
    await access.requireAdmin(claims);
  });

  it.each([
    { email: ADMIN },
    { oid: 'other-oid', email: ADMIN },
    { oid: 'other-oid', preferred_username: ADMIN },
    { oid: 'other-oid', emails: [ADMIN] },
    { sub: ADMIN_OID, email: ADMIN },
  ])('never grants admin authority from a mutable email alias: %j', async (claims) => {
    const { access } = setup();
    expect(access.isAdmin(claims)).toBe(false);
    expect(await code(() => access.requireAdmin(claims))).toBe('forbidden');
    expect(await access.isInvited(claims)).toBe(false);
  });

  it('fails closed when no immutable admin principal is configured', async () => {
    const access = new AccessService(new InMemoryInviteStore(), ADMIN);
    expect(access.isAdmin({ oid: ADMIN_OID, email: ADMIN })).toBe(false);
    expect(await code(() => access.requireAdmin({ email: ADMIN }))).toBe('forbidden');
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
    const claims = { iss: ISSUER, oid: 'friend-oid', email: 'FRIEND@example.com', email_verified: true };
    expect(await access.isInvited(claims)).toBe(true);
    expect(access.isAdmin({ email: 'friend@example.com' })).toBe(false);
    await access.requireInvited(claims);
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

  it('does not use preferred_username or emails aliases to redeem an invitation', async () => {
    const { invites, access } = setup();
    await invites.put({ email: 'pu@example.com', invitedBy: ADMIN, createdAt: 'now' });
    expect(await access.isInvited({ iss: ISSUER, oid: 'alias-user', preferred_username: 'PU@example.com', email_verified: true })).toBe(false);
    await invites.put({ email: 'arr@example.com', invitedBy: ADMIN, createdAt: 'now' });
    expect(await access.isInvited({ iss: ISSUER, oid: 'alias-user', emails: ['arr@example.com'], email_verified: true })).toBe(false);
  });

  it.each([
    { email: 'friend@example.com' },
    { iss: ISSUER, oid: 'friend-oid', email: 'friend@example.com' },
    { iss: ISSUER, oid: 'friend-oid', email: 'friend@example.com', email_verified: 'true' },
    { oid: 'friend-oid', email: 'friend@example.com', email_verified: true },
    { iss: ISSUER, sub: 'friend-oid', email: 'friend@example.com', email_verified: true },
  ])('rejects missing immutable identity or unverified email on redemption: %j', async (claims) => {
    const { invites, access } = setup();
    await invites.put({ email: 'friend@example.com', invitedBy: ADMIN, createdAt: 'now' });
    expect(await access.isInvited(claims)).toBe(false);
  });

  it('keeps verified principal access after email changes and rejects another owner reusing the email', async () => {
    const { invites, access } = setup();
    await invites.put({ email: 'friend@example.com', invitedBy: ADMIN, createdAt: 'now' });
    expect(await access.isInvited({iss:ISSUER,oid:'friend-oid',email:'friend@example.com',email_verified:true})).toBe(true);
    expect(await access.isInvited({iss:ISSUER,oid:'friend-oid',email:'changed@example.com'})).toBe(true);
    expect(await access.isInvited({iss:ISSUER,oid:'other-oid',email:'friend@example.com',email_verified:true})).toBe(false);
    await invites.remove('friend@example.com');
    expect(await access.isInvited({iss:ISSUER,oid:'friend-oid',email:'changed@example.com'})).toBe(false);
  });

  it('allows only one immutable claimant to redeem a shared email invitation', async () => {
    const { invites, access } = setup();
    await invites.put({email:'friend@example.com',invitedBy:ADMIN,createdAt:'now'});
    const results = await Promise.all(['first','second'].map(oid=>access.isInvited({iss:ISSUER,oid,email:'friend@example.com',email_verified:true})));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('does not reset the principal binding when the admin adds the same invitation again', async () => {
    const { invites, access } = setup();
    const invitation = {email:'friend@example.com',invitedBy:ADMIN,createdAt:'now'};
    await invites.put(invitation);
    await access.requireInvited({iss:ISSUER,oid:'original',email:invitation.email,email_verified:true});
    const before = await invites.get(invitation.email);
    expect(before?.principal).toEqual({issuer:ISSUER,objectId:'original'});
    expect(Number.isFinite(Date.parse(before!.redeemedAt!))).toBe(true);
    await invites.put({...invitation,createdAt:'later'});
    expect(await invites.get(invitation.email)).toEqual(before);
    expect(await access.isInvited({iss:ISSUER,oid:'other',email:invitation.email,email_verified:true})).toBe(false);
  });
});
