import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './design/tokens.css';
import './design/global.css';
import './design/components.css';
import { App } from './app/App';
import { ThemeProvider } from './app/ThemeProvider';
import { ToastHost } from './app/ToastHost';
import { ConnectionBanner } from './app/ConnectionBanner';
import { ConfirmHost } from './app/ConfirmHost';
import { DevMenu } from './mocks/DevMenu';
import { clearStaleAuthCacheOnce, initAuth, setBeforeSignOut } from './auth/cloudAuth';
import { installViewportFrame } from './app/viewportFrame';
import { activateAccountData } from './data';
import { activateUiOwner } from './state/store';
import { stopAllRunsForAccountTransition } from './features/chat/runStore';

setBeforeSignOut(async () => {
  await stopAllRunsForAccountTransition();
  await activateAccountData(null);
  await activateUiOwner(null);
});

function mount() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <HashRouter>
        <ThemeProvider>
          <App />
          <ConnectionBanner />
          <ToastHost />
          <ConfirmHost />
          {import.meta.env.DEV && <DevMenu />}
        </ThemeProvider>
      </HashRouter>
    </StrictMode>,
  );
}

// One-time: wipe stale MSAL auth cache left by the local-account → cloud migration (it wedges
// sign-in; a clean profile / incognito works). Must run before MSAL reads localStorage.
// MSAL's prompt=none flow returns to this same URL inside a hidden sandboxed iframe. The parent
// MSAL instance reads that iframe's hash itself; booting Watai here would start sync and another
// silent token iframe recursively. Render and initialise auth only in the top-level window.
if (window.self === window.top) {
  installViewportFrame();
  clearStaleAuthCacheOnce();
  // Complete any returning sign-in redirect BEFORE the HashRouter mounts (so the auth
  // response in the URL hash isn't clobbered by the router), then render either way.
  void (async () => {
    let ownerId: string | null = null;
    try {
      ownerId = (await initAuth())?.homeAccountId ?? null;
    } finally {
      await activateAccountData(ownerId);
      await activateUiOwner(ownerId);
      mount();
    }
  })();
}
