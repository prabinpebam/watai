import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyVaultWrapper } from './keyVaultWrapper';

const sdk = vi.hoisted(() => ({ getKey: vi.fn(), wrap: vi.fn(), unwrap: vi.fn(), clients: vi.fn() }));
vi.mock('@azure/identity', () => ({ DefaultAzureCredential: class {} }));
vi.mock('@azure/keyvault-keys', () => ({
  KeyClient: class { getKey = sdk.getKey; },
  CryptographyClient: class {
    constructor(readonly keyId: string) { sdk.clients(keyId); }
    wrapKey(algorithm: string, value: Buffer) { return sdk.wrap(this.keyId, algorithm, value); }
    unwrapKey(algorithm: string, value: Buffer) { return sdk.unwrap(this.keyId, algorithm, value); }
  },
}));
const vault = 'https://test-vault.vault.azure.net';
const keyName = 'watai-cred-kek';
const firstId = `${vault}/keys/${keyName}/version1`;
const secondId = `${vault}/keys/${keyName}/version2`;
const dek = Buffer.alloc(32, 5);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-11T00:00:00Z'));
  vi.resetAllMocks();
  sdk.getKey.mockResolvedValue({ id: firstId });
  sdk.wrap.mockImplementation(async (keyID: string) => ({ result: Buffer.from('wrapped'), keyID }));
  sdk.unwrap.mockResolvedValue({ result: dek });
});
afterEach(() => vi.useRealTimers());

describe('KeyVaultWrapper rotation', () => {
  it('reuses current lookup for five minutes, then resolves the new key version', async () => {
    const wrapper = new KeyVaultWrapper(vault, keyName);
    expect((await wrapper.wrapKey(dek)).kekVersion).toBe(firstId);
    await wrapper.wrapKey(dek);
    expect(sdk.getKey).toHaveBeenCalledOnce();
    sdk.getKey.mockResolvedValue({ id: secondId });
    vi.setSystemTime(new Date('2026-09-11T00:05:01Z'));
    expect((await wrapper.wrapKey(dek)).kekVersion).toBe(secondId);
    expect(sdk.getKey).toHaveBeenCalledTimes(2);
  });

  it('evicts a rejected lookup so the next operation can recover', async () => {
    sdk.getKey.mockRejectedValueOnce(new Error('Transient lookup failure'));
    const wrapper = new KeyVaultWrapper(vault, keyName);
    await expect(wrapper.wrapKey(dek)).rejects.toThrow('Transient lookup failure');
    expect((await wrapper.wrapKey(dek)).kekVersion).toBe(firstId);
  });

  it.each([403, 404, 410])('refreshes once after a stale-key failure %s', async (statusCode) => {
    sdk.getKey.mockResolvedValueOnce({ id: firstId }).mockResolvedValue({ id: secondId });
    sdk.wrap.mockRejectedValueOnce({ statusCode });
    const wrapper = new KeyVaultWrapper(vault, keyName);
    expect((await wrapper.wrapKey(dek)).kekVersion).toBe(secondId);
    expect(sdk.wrap).toHaveBeenCalledTimes(2);
    expect(sdk.getKey).toHaveBeenCalledTimes(2);
  });

  it('never retries a wrap more than once', async () => {
    sdk.wrap.mockRejectedValue({ statusCode: 403 });
    await expect(new KeyVaultWrapper(vault, keyName).wrapKey(dek)).rejects.toMatchObject({ statusCode: 403 });
    expect(sdk.wrap).toHaveBeenCalledTimes(2);
  });

  it('does not retry throttling or unrelated failures', async () => {
    sdk.wrap.mockRejectedValue({ statusCode: 429 });
    await expect(new KeyVaultWrapper(vault, keyName).wrapKey(dek)).rejects.toMatchObject({ statusCode: 429 });
    expect(sdk.wrap).toHaveBeenCalledOnce();
  });

  it('stores the resolved version when wrap response omits its key ID', async () => {
    sdk.wrap.mockResolvedValue({ result: Buffer.from('wrapped') });
    expect((await new KeyVaultWrapper(vault, keyName).wrapKey(dek)).kekVersion).toBe(firstId);
  });

  it.each([undefined, `${vault}/keys/${keyName}`, 'https://other.vault.azure.net/keys/watai-cred-kek/version1'])('rejects an invalid current key ID: %s', async (id) => {
    sdk.getKey.mockResolvedValue({ id });
    await expect(new KeyVaultWrapper(vault, keyName).wrapKey(dek)).rejects.toThrow();
    expect(sdk.wrap).not.toHaveBeenCalled();
  });

  it('rejects a wrap response that changes the selected version', async () => {
    sdk.wrap.mockResolvedValue({ result: Buffer.from('wrapped'), keyID: secondId });
    await expect(new KeyVaultWrapper(vault, keyName).wrapKey(dek)).rejects.toThrow();
  });

  it('unwraps historical records using only their recorded version', async () => {
    sdk.getKey.mockResolvedValue({ id: secondId });
    const wrapper = new KeyVaultWrapper(vault, keyName);
    await wrapper.wrapKey(dek);
    expect(await wrapper.unwrapKey(Buffer.from('wrapped').toString('base64'), firstId)).toEqual(dek);
    expect(sdk.unwrap).toHaveBeenCalledWith(firstId, 'RSA-OAEP-256', Buffer.from('wrapped'));
    expect(sdk.getKey).toHaveBeenCalledOnce();
  });

  it('rejects unversioned historical references without latest-key fallback', async () => {
    await expect(new KeyVaultWrapper(vault, keyName).unwrapKey('value', keyName)).rejects.toThrow();
    expect(sdk.getKey).not.toHaveBeenCalled();
    expect(sdk.unwrap).not.toHaveBeenCalled();
  });
});