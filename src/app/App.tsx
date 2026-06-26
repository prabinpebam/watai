import { useEffect, useState, lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ChatScreen } from '../features/chat/ChatScreen';
import { SearchView } from '../features/history/SearchView';
import { ImagesView } from '../features/images/ImagesView';
import { Settings } from '../features/settings/Settings';
import { Onboarding } from '../features/onboarding/Onboarding';
import { VoiceMode } from '../features/voice/VoiceMode';
import { IconButton, Spinner, Button } from '../design/ui';
import { useIsExpanded } from '../lib/hooks';
import { useUi } from '../state/store';
import { repo, seedMockDataIfEmpty, purgeDemoData, syncNow, backfillSync } from '../data';
import { restoreInterruptedRuns } from '../features/chat/runStore';
import { hasValidConfig } from '../data/secureStore';
import { isSignedIn, signOut } from '../auth/cloudAuth';
import { loadMe, cachedMe } from '../auth/access';

// Dev-only chat component gallery. The dynamic import sits in a branch that is statically
// false in production, so the chunk is tree-shaken out of the prod bundle entirely.
const ChatGallery = import.meta.env.DEV ? lazy(() => import('../mocks/ChatGallery')) : null;

/** Top bar with a menu (compact) or sidebar toggle (expanded) for non-chat screens. */
function ScreenBar({ title }: { title: string }) {
  const expanded = useIsExpanded();
  const toggleDrawer = useUi((s) => s.toggleDrawer);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  return (
    <div className="appbar">
      {expanded ? (
        <IconButton name="sidebar" label="Toggle sidebar" onClick={() => toggleSidebar()} />
      ) : (
        <IconButton name="menu" label="Open menu" onClick={() => toggleDrawer(true)} />
      )}
      <div className="appbar__title">{title}</div>
      <div style={{ width: 40 }} />
    </div>
  );
}

function RootRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    let live = true;
    repo.listThreads().then((threads) => {
      if (!live) return;
      navigate(threads.length > 0 ? `/c/${threads[0].id}` : '/new', { replace: true });
    });
    return () => {
      live = false;
    };
  }, [navigate]);
  return (
    <div className="center-screen">
      <Spinner large />
    </div>
  );
}

type SetupState = 'loading' | 'no-session' | 'no-access' | 'no-config' | 'ready';

function useSetupState(): SetupState {
  const [state, setState] = useState<SetupState>('loading');
  const mockAi = useUi((s) => s.mockAi);
  const location = useLocation();
  useEffect(() => {
    let live = true;
    (async () => {
      // Cloud-account-only: a signed-in Entra account is required (dev mock mode aside).
      const devMock = import.meta.env.DEV && mockAi;
      if (!devMock && !(await isSignedIn())) {
        if (live) setState('no-session');
        return;
      }
      if (!devMock) {
        // Invite-only: a definitive "not invited" blocks the UI. Transient API/network errors
        // fall through (the backend still enforces access on every call).
        const me = await loadMe();
        if (me && !me.isInvited) {
          if (live) setState('no-access');
          return;
        }
      }
      const ok = devMock || (await hasValidConfig());
      if (live) setState(ok ? 'ready' : 'no-config');
    })();
    return () => {
      live = false;
    };
  }, [mockAi, location.pathname]);
  return state;
}

/** Signed in, but the account isn't on the invite allowlist. */
function NotInvited() {
  const email = cachedMe()?.email;
  return (
    <div className="center-screen">
      <div className="onboard" style={{ maxWidth: 440 }}>
        <h1 className="onboard__title">Thanks for your interest in Watai</h1>
        <p className="onboard__sub">
          Watai is invite-only for now, so this account doesn&apos;t have access yet.
          {email ? ` Ask the admin to invite ${email}, ` : ' Ask the admin for an invite, '}
          then sign in again to get started.
        </p>
        <div className="onboard__actions">
          <Button variant="outline" icon="logout" full onClick={() => signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const state = useSetupState();
  if (state === 'loading') {
    return (
      <div className="center-screen">
        <Spinner large />
      </div>
    );
  }
  if (state === 'no-session') return <Navigate to="/onboarding/welcome" replace />;
  if (state === 'no-access') return <NotInvited />;
  if (state === 'no-config') return <Navigate to="/onboarding/key" replace />;
  return <>{children}</>;
}

export function App() {
  // Dev builds seed demo data so the UI is reviewable immediately. Production instead PURGES
  // any demo threads a prior build may have seeded into a returning user's browser, so real
  // users always start from an empty state (their own non-seed chats are untouched).
  useEffect(() => {
    if (import.meta.env.DEV) {
      seedMockDataIfEmpty().catch(() => undefined);
    } else {
      purgeDemoData().catch(() => undefined);
    }
    // Recover any assistant run interrupted by a browser close: persist what streamed as an
    // 'interrupted' message so nothing is silently lost.
    restoreInterruptedRuns().catch(() => undefined);
  }, []);

  // Background cloud sync: a no-op unless Settings.data.sync is on and a user is signed in.
  // After each pull, refresh the thread list + any chat whose messages changed, so a prompt or
  // response from another device appears promptly and in correct chronological order.
  useEffect(() => {
    const tick = () =>
      void syncNow()
        .then((changed) => {
          if (!changed || changed.size === 0) return;
          const ui = useUi.getState();
          ui.bumpThreads();
          changed.forEach((id) => ui.bumpThread(id));
        })
        .catch(() => undefined);
    tick();
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    const id = window.setInterval(tick, 30_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(id);
    };
  }, []);

  // Cloud-account-only: ensure sync is on for the signed-in user (migrating any stale
  // sync=false saved before cloud-only), backfill pre-existing local data once, then sync.
  useEffect(() => {
    (async () => {
      if (import.meta.env.DEV && useUi.getState().mockAi) return;
      if (!(await isSignedIn())) return;
      const settings = await repo.getSettings();
      if (!settings.data.sync) {
        await repo.saveSettings({ ...settings, data: { ...settings.data, sync: true } });
        // Sync was off before, so existing local data was never queued — force a re-backfill.
        localStorage.removeItem('watai.backfilled.v2');
      }
      // v2: earlier builds dropped queued ops on a 403 (not-invited) before invite access
      // was sorted out, so existing chats never reached the cloud. Re-enqueue everything once.
      if (!localStorage.getItem('watai.backfilled.v2')) {
        await backfillSync().catch((e) => console.warn('[sync] backfill failed', e));
        localStorage.setItem('watai.backfilled.v2', '1');
      }
      await syncNow()
        .then((changed) => {
          const ui = useUi.getState();
          ui.bumpThreads();
          changed?.forEach((id) => ui.bumpThread(id));
        })
        .catch((e) => console.warn('[sync] initial sync failed', e));
    })();
  }, []);

  return (
    <Routes>
      <Route path="/onboarding/*" element={<Onboarding />} />
      <Route path="/voice/:threadId?" element={<VoiceMode />} />

      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route path="/" element={<RootRedirect />} />
        <Route path="/new" element={<ChatScreen isNew />} />
        <Route path="/c/:threadId" element={<ChatScreen />} />
        <Route
          path="/search"
          element={
            <>
              <ScreenBar title="Search" />
              <SearchView />
            </>
          }
        />
        <Route
          path="/images"
          element={
            <>
              <ScreenBar title="Images" />
              <ImagesView />
            </>
          }
        />
        <Route path="/settings" element={<Settings />} />
        <Route path="/settings/:section" element={<Settings />} />
      </Route>

      {ChatGallery && (
        <Route
          path="/dev/gallery"
          element={
            <Suspense
              fallback={
                <div className="center-screen">
                  <Spinner large />
                </div>
              }
            >
              <ChatGallery />
            </Suspense>
          }
        />
      )}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
