// Entra External ID (CIAM) auth for the cloud sync plane. MSAL is loaded lazily
// (dynamic import) and only initialised on first use, so it never affects startup
// or the local-only experience. The token provider is silent-only: it returns null
// when the user isn't signed in, and `signIn()` is the explicit interactive action.
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
        },
        cache: { cacheLocation: 'localStorage' },
      });
      await pca.initialize();
      return pca;
    })();
  }
  return pcaPromise;
}

function activeAccount(pca: IPublicClientApplication): AccountInfo | null {
  return pca.getActiveAccount() ?? pca.getAllAccounts()[0] ?? null;
}

/** Token provider for the API client: silent-only, resolves to null when signed out. */
export async function getCloudToken(): Promise<string | null> {
  const pca = await getPca();
  const account = activeAccount(pca);
  if (!account) return null;
  try {
    const res = await pca.acquireTokenSilent({ account, scopes: [API_SCOPE] });
    return res.accessToken;
  } catch {
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

export async function signOut(): Promise<void> {
  const pca = await getPca();
  const account = activeAccount(pca);
  await pca.logoutPopup({ account: account ?? undefined });
}

export async function getSignedInAccount(): Promise<AccountInfo | null> {
  return activeAccount(await getPca());
}

export async function isSignedIn(): Promise<boolean> {
  return (await getSignedInAccount()) !== null;
}
