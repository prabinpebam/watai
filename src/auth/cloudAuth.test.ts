import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  acquireTokenSilent: vi.fn(),
  loginPopup: vi.fn(),
}));

vi.mock('@azure/msal-browser', () => {
  class InteractionRequiredAuthError extends Error {}
  class PublicClientApplication {
    initialize = vi.fn().mockResolvedValue(undefined);
    handleRedirectPromise = vi.fn().mockResolvedValue(null);
    getActiveAccount = vi.fn().mockReturnValue({ homeAccountId: 'account' });
    getAllAccounts = vi.fn().mockReturnValue([]);
    setActiveAccount = vi.fn();
    acquireTokenSilent = auth.acquireTokenSilent;
    acquireTokenRedirect = vi.fn();
    loginPopup = auth.loginPopup;
    loginRedirect = vi.fn();
    logoutRedirect = vi.fn();
  }
  return {
    CacheLookupPolicy: { AccessTokenAndRefreshToken: 2 },
    InteractionRequiredAuthError,
    PublicClientApplication,
  };
});

import { clearStaleAuthCacheOnce, getCloudToken, signIn } from './cloudAuth';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  auth.acquireTokenSilent.mockClear();
  auth.loginPopup.mockReset();
});

describe('clearStaleAuthCacheOnce', () => {
  it('removes wedged auth cache without deleting Watai data', () => {
    localStorage.setItem('msal.account', 'stale');
    localStorage.setItem('watai.ui', 'keep');

    clearStaleAuthCacheOnce();

    expect(localStorage.getItem('msal.account')).toBeNull();
    expect(localStorage.getItem('watai.ui')).toBe('keep');
    expect(localStorage.getItem('watai.authReset.v2')).toBe('1');
  });
});

describe('getCloudToken', () => {
  it('shares one silent acquisition across concurrent startup callers', async () => {
    let resolve!: (value: { accessToken: string }) => void;
    auth.acquireTokenSilent.mockReturnValueOnce(new Promise((done) => {
      resolve = done;
    }));

    const first = getCloudToken();
    const second = getCloudToken();

    expect(second).toBe(first);
    await vi.waitFor(() => expect(auth.acquireTokenSilent).toHaveBeenCalledTimes(1));
    expect(auth.acquireTokenSilent).toHaveBeenCalledWith(expect.objectContaining({
      cacheLookupPolicy: 2,
    }));

    resolve({ accessToken: 'token' });
    await expect(first).resolves.toBe('token');
    await expect(second).resolves.toBe('token');
  });
});

describe('signIn', () => {
  it('clears a failed recovery guard before popup authentication', async () => {
    sessionStorage.setItem('watai.reauth', '1');
    auth.loginPopup.mockResolvedValueOnce({ account: { homeAccountId: 'account' } });

    await signIn();

    expect(sessionStorage.getItem('watai.reauth')).toBeNull();
  });
});