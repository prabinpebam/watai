// Entra External ID (CIAM) auth for Watai. The app is cloud-account-only: sign-in is
// mandatory and uses the redirect flow (reliable on mobile). MSAL is loaded lazily and
// processes any returning redirect on first use, so the active account is ready before
// the app's auth gate reads it.
import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';

const TENANT_ID = 'f009d35a-019c-4374-8987-2509caf7f66f';
const CLIENT_ID =
  (import.meta.env.VITE_WATAI_CLIENT_ID as string) || 'd26b2bca-8003-4f2a-a3ec-1d36ca706c45';
const AUTHORITY =
  (import.meta.env.VITE_WATAI_AUTHORITY as string) ||
  `https://wataiexternal.ciamlogin.com/${TENANT_ID}`;
const KNOWN_AUTHORITY = 'wataiexternal.ciamlogin.com';
const API_SCOPE =
  (import.meta.env.VITE_WATAI_API_SCOPE as string) || `api://${CLIENT_ID}/access_as_user`;

let pcaPromise: Promise<IPublicClientApplication> | null = null;

function redirectUri(): string {
  if (typeof window === 'undefined') return 'http://localhost:5173';
  return window.location.hostname.endsWith('github.io')
    ? 'https://prabinpebam.github.io/watai/'
    : window.location.origin;
}

async function getPca(): Promise<IPublicClientApplication> {
  if (!pcaPromise) {
    pcaPromise = (async () => {
      const { PublicClientApplication } = await import('@azure/msal-browser');
      const pca = new PublicClientApplication({
        auth: {
          clientId: CLIENT_ID,
          authority: AUTHORITY,
          knownAuthorities: [KNOWN_AUTHORITY],
          redirectUri: redirectUri(),
          postLogoutRedirectUri: redirectUri(),
        },
        cache: { cacheLocation: 'localStorage' },
      });
      await pca.initialize();
      // Complete a returning sign-in redirect (no-op on a normal load). The app's HashRouter
      // owns routing, so MSAL must not navigate or it fights the router over the URL hash.
      // CRITICAL: a redirect we cannot redeem — a stale/duplicate auth code left in the URL, a
      // wrong-issuer grant (AADSTS399266), clock skew, etc. — must NOT reject this *cached* promise,
      // or every later auth call rejects and the app becomes permanently unusable. Swallow it,
      // strip the dead auth response from the URL so it isn't retried on reload, and hand back a
      // usable client the user can sign in with fresh.
      try {
        const result = await pca.handleRedirectPromise({ navigateToLoginRequestUrl: false });
        if (result?.account) pca.setActiveAccount(result.account);
      } catch (e) {
        console.warn('[auth] could not complete the sign-in redirect; starting clean', e);
        if (typeof window !== 'undefined' && /[#&]code=/.test(window.location.hash)) {
          history.replaceState(null, '', window.location.pathname + window.location.search);
        }
      }
      return pca;
    })();
  }
  return pcaPromise;
}

function activeAccount(pca: IPublicClientApplication): AccountInfo | null {
  return pca.getActiveAccount() ?? pca.getAllAccounts()[0] ?? null;
}

/** Initialise MSAL and complete any returning sign-in redirect. Must run BEFORE the
 *  HashRouter mounts so the auth response in the URL hash is consumed first. */
export async function initAuth(): Promise<void> {
  await getPca();
}

/** Guard so a stale session triggers at most ONE automatic recovery redirect per browsing
 *  session — set before redirecting, cleared on the next silent success — so a token that still
 *  can't be minted after re-auth falls through to the sign-in screen instead of looping. */
const REAUTH_FLAG = 'watai.reauth';

/** Token provider for the API client. Silent-first; if the session can't be renewed silently
 *  (an expired refresh token, or — on static hosts like GitHub Pages — the browser blocking the
 *  third-party cookie the renewal iframe needs), recover with a top-level interactive redirect,
 *  which reaches the session and mints a fresh refresh token. Resolves to null only when truly
 *  signed out or already mid-recovery. */
export async function getCloudToken(): Promise<string | null> {
  const pca = await getPca();
  const account = activeAccount(pca);
  if (!account) return null;
  try {
    const res = await pca.acquireTokenSilent({ account, scopes: [API_SCOPE] });
    try {
      sessionStorage.removeItem(REAUTH_FLAG);
    } catch {
      /* ignore */
    }
    return res.accessToken;
  } catch (e) {
    const { InteractionRequiredAuthError } = await import('@azure/msal-browser');
    let alreadyTried = false;
    try {
      alreadyTried = sessionStorage.getItem(REAUTH_FLAG) === '1';
    } catch {
      /* ignore */
    }
    // Only an interaction-required failure is recoverable by redirect; network/other errors just
    // resolve to null (the caller retries later). The guard prevents a redirect loop.
    if (e instanceof InteractionRequiredAuthError && !alreadyTried) {
      try {
        sessionStorage.setItem(REAUTH_FLAG, '1');
      } catch {
        /* ignore */
      }
      try {
        await pca.acquireTokenRedirect({ account, scopes: [API_SCOPE] });
      } catch {
        try {
          sessionStorage.removeItem(REAUTH_FLAG);
        } catch {
          /* ignore */
        }
      }
    }
    return null;
  }
}

/** Interactive sign-in / sign-up via the Entra External ID user flow (popup). */
export async function signIn(): Promise<AccountInfo | null> {
  const pca = await getPca();
  const res = await pca.loginPopup({ scopes: [API_SCOPE] });
  if (res.account) pca.setActiveAccount(res.account);
  return res.account ?? null;
}

/** Interactive sign-in / sign-up via redirect (reliable on mobile). Navigates away; the
 *  app reloads at the redirect URI and `getPca()` completes it. */
export async function signInRedirect(): Promise<void> {
  const pca = await getPca();
  await pca.loginRedirect({ scopes: [API_SCOPE] });
}

export async function signOut(): Promise<void> {
  const pca = await getPca();
  const account = activeAccount(pca);
  await pca.logoutRedirect({ account: account ?? undefined });
}

export async function getSignedInAccount(): Promise<AccountInfo | null> {
  return activeAccount(await getPca());
}

export async function isSignedIn(): Promise<boolean> {
  return (await getSignedInAccount()) !== null;
}
