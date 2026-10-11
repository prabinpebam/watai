import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {BlobServiceClient,UserDelegationKey} from '@azure/storage-blob';
import {AzureSasMinter} from './sasMinter';

const start = Date.parse('2026-09-11T00:00:00Z');
function key(expires = start + 3600000, begins = start - 300000): UserDelegationKey {
  return {signedObjectId:'11111111-1111-1111-1111-111111111111',signedTenantId:'22222222-2222-2222-2222-222222222222',
    signedStartsOn:new Date(begins),signedExpiresOn:new Date(expires),signedService:'b',signedVersion:'2023-11-03',value:Buffer.alloc(32,7).toString('base64')};
}
function setup() {
  const getUserDelegationKey = vi.fn().mockResolvedValue(key());
  const minter = new AzureSasMinter({accountName:'syntheticaccount',container:'media',client:{getUserDelegationKey} as unknown as BlobServiceClient});
  return {minter,getUserDelegationKey};
}
const request = {blobPath:'owner/thread/file name.txt',op:'read' as const,ttlSeconds:300};
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(start));});
afterEach(()=>vi.useRealTimers());

describe('AzureSasMinter actual key validity',()=>{
  it('caps signed expiry at the returned key expiry and reports the exact signed date',async()=>{
    const {minter,getUserDelegationKey}=setup();
    getUserDelegationKey.mockResolvedValue(key(start+90250));
    const grant=await minter.mint(request);
    const url=new URL(grant.url);
    const signedExpiry=new Date(url.searchParams.get('se')!).toISOString();
    expect(Date.parse(grant.expiresAt)).toBeLessThanOrEqual(start+90250);
    expect(grant.expiresAt).toBe(signedExpiry);
    expect(url.pathname).toBe('/media/owner/thread/file%20name.txt');
  });

  it('does not start a grant before the actual delegation key starts',async()=>{
    const {minter,getUserDelegationKey}=setup();
    getUserDelegationKey.mockResolvedValue(key(start+3600000,start-30250));
    const grant=await minter.mint(request);
    expect(Date.parse(new URL(grant.url).searchParams.get('st')!)).toBeGreaterThanOrEqual(start-30250);
  });

  it('refreshes based on the returned expiry rather than the requested hour',async()=>{
    const {minter,getUserDelegationKey}=setup();
    getUserDelegationKey.mockResolvedValueOnce(key(start+90000));
    await minter.mint(request);
    vi.setSystemTime(new Date(start+31000));
    await minter.mint(request);
    expect(getUserDelegationKey).toHaveBeenCalledTimes(2);
  });

  it('reuses a still-usable cached key',async()=>{
    const {minter,getUserDelegationKey}=setup();
    await minter.mint(request);
    vi.setSystemTime(new Date(start+60000));
    await minter.mint(request);
    expect(getUserDelegationKey).toHaveBeenCalledOnce();
  });

  it.each([0,-1,NaN,Infinity,Number.MAX_VALUE])('rejects invalid TTL before acquiring a key: %s',async ttlSeconds=>{
    const {minter,getUserDelegationKey}=setup();
    await expect(minter.mint({...request,ttlSeconds})).rejects.toThrow();
    expect(getUserDelegationKey).not.toHaveBeenCalled();
  });

  it.each([
    key(start-1000),key(start+3600000,start+1000),key(NaN),key(start+3600000,NaN),key(start,start),
  ])('rejects invalid key validity without poisoning the cache',async invalid=>{
    const {minter,getUserDelegationKey}=setup();
    getUserDelegationKey.mockResolvedValueOnce(invalid);
    await expect(minter.mint(request)).rejects.toThrow();
    await minter.mint(request);
    expect(getUserDelegationKey).toHaveBeenCalledTimes(2);
  });

  it('rechecks current time after key acquisition before issuing a grant',async()=>{
    const {minter,getUserDelegationKey}=setup();
    getUserDelegationKey.mockImplementationOnce(async()=>{vi.setSystemTime(new Date(start+400000));return key();});
    await expect(minter.mint(request)).rejects.toThrow();
  });

  it.each([['read','r'],['write','cw'],['delete','d']] as const)('preserves least-privilege %s permissions',async(op,expected)=>{
    const {minter}=setup();
    const url=new URL((await minter.mint({...request,op})).url);
    expect(url.searchParams.get('sp')).toBe(expected);
    expect(url.searchParams.get('spr')).toBe('https');
  });
});