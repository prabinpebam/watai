import { describe, expect, it, vi } from 'vitest';
import type { Container } from '@azure/cosmos';
import { CosmosInviteStore } from './inviteStore';
import type { InvitationPrincipal } from '../../ports/inviteStore';

const invitation = { email:'friend@example.com', invitedBy:'admin@example.com', createdAt:'now' };
const principal = { issuer:'https://tenant.ciamlogin.com/tenant/v2.0', objectId:'first-owner' };
const redeemedAt = '2026-09-11T00:00:00Z';
type Document = typeof invitation & {id:string;pk:string;_etag?:string;principal?:InvitationPrincipal;redeemedAt?:string};

function setup() {
  let document: Document | undefined = {...invitation,id:invitation.email,pk:'invite',_etag:'etag-1'};
  const read = vi.fn(async () => ({resource:structuredClone(document)}));
  const replace = vi.fn(async (value: Document, options: {accessCondition:{type:string;condition:string}}) => {
    if (!document) throw {code:404};
    if (options.accessCondition.condition !== document._etag) throw {code:412};
    document = {...value,_etag:'etag-2'};
    return {resource:document};
  });
  const create = vi.fn(async (value: Document) => {
    if (document) throw {code:409};
    document = {...value,_etag:'etag-1'};
    return {resource:document};
  });
  const remove = vi.fn(async () => { document=undefined; });
  const item = vi.fn().mockReturnValue({read,replace,delete:remove});
  const fetchAll = vi.fn().mockResolvedValue({resources:[]});
  const query = vi.fn().mockReturnValue({fetchAll});
  const upsert = vi.fn();
  const store = new CosmosInviteStore({item,items:{query,create,upsert}} as unknown as Container);
  return {store,item,read,replace,create,upsert,query,fetchAll,clear:()=>{document=undefined;},withoutEtag:()=>{delete document!._etag;}};
}

describe('CosmosInviteStore immutable redemption', () => {
  it('binds existing invitation using its exact ETag and retains a redemption timestamp', async () => {
    const {store,replace,create} = setup();
    expect(await store.redeem(invitation.email,principal,redeemedAt)).toMatchObject({...invitation,principal,redeemedAt});
    expect(replace).toHaveBeenCalledWith(expect.objectContaining({principal,redeemedAt}),{accessCondition:{type:'IfMatch',condition:'etag-1'}});
    expect(create).not.toHaveBeenCalled();
  });

  it('allows only one of two concurrent immutable claimants to bind', async () => {
    const {store} = setup();
    const results = await Promise.all([store.redeem(invitation.email,principal,redeemedAt),store.redeem(invitation.email,{...principal,objectId:'second-owner'},redeemedAt)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store.get(invitation.email))?.principal).toEqual(principal);
  });

  it('preserves a binding on repeated invite creation', async () => {
    const {store,upsert} = setup();
    await store.redeem(invitation.email,principal,redeemedAt);
    expect(await store.put({...invitation,createdAt:'later'})).toMatchObject({...invitation,principal,redeemedAt});
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not recreate a deleted invite during redemption', async () => {
    const {store,clear,create,replace} = setup();
    const write = replace.getMockImplementation()!;
    replace.mockImplementationOnce(async (...arguments_) => {clear();return write(...arguments_);});
    expect(await store.redeem(invitation.email,principal,redeemedAt)).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(await store.get(invitation.email)).toBeNull();
  });

  it('rejects a missing ETag rather than performing an unconditional replace', async () => {
    const {store,withoutEtag,replace} = setup();
    withoutEtag();
    await expect(store.redeem(invitation.email,principal,redeemedAt)).rejects.toThrow('version token');
    expect(replace).not.toHaveBeenCalled();
  });

  it('returns no redemption for absent invitations and mismatched owners', async () => {
    const {store,clear} = setup();
    await store.redeem(invitation.email,principal,redeemedAt);
    expect(await store.redeem(invitation.email,{...principal,objectId:'other'},redeemedAt)).toBeNull();
    clear();
    expect(await store.redeem(invitation.email,principal,redeemedAt)).toBeNull();
  });

  it('looks up both issuer and OID within the invitation partition', async () => {
    const {store,query,fetchAll} = setup();
    fetchAll.mockResolvedValue({resources:[{...invitation,id:invitation.email,pk:'invite',principal,redeemedAt}]});
    expect((await store.getByPrincipal(principal))?.principal).toEqual(principal);
    expect(query).toHaveBeenCalledWith(expect.objectContaining({
      query:expect.stringContaining('c.principal.issuer = @issuer AND c.principal.objectId = @objectId'),
      parameters:expect.arrayContaining([{name:'@issuer',value:principal.issuer},{name:'@objectId',value:principal.objectId}]),
    }),{partitionKey:'invite'});
  });

  it('does not query or bind an empty immutable identity', async () => {
    const {store,query,item} = setup();
    expect(await store.getByPrincipal({...principal,objectId:''})).toBeNull();
    expect(await store.redeem(invitation.email,{...principal,issuer:''},redeemedAt)).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(item).not.toHaveBeenCalled();
  });
});