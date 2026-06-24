import { useEffect, useState, lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ChatScreen } from '../features/chat/ChatScreen';
import { SearchView } from '../features/history/SearchView';
import { ImagesView } from '../features/images/ImagesView';
import { Settings } from '../features/settings/Settings';
import { Onboarding } from '../features/onboarding/Onboarding';
import { VoiceMode } from '../features/voice/VoiceMode';
import { IconButton, Spinner } from '../design/ui';
import { useIsExpanded } from '../lib/hooks';
import { useUi } from '../state/store';
import { repo, seedMockDataIfEmpty, purgeDemoData, syncNow, backfillSync } from '../data';
import { hasValidConfig } from '../data/secureStore';
import { isSignedIn } from '../auth/cloudAuth';

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

type SetupState = 'loading' | 'no-session' | 'no-config' | 'ready';

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
      const ok = devMock || (await hasValidConfig());
      if (live) setState(ok ? 'ready' : 'no-config');
    })();
    return () => {
      live = false;
    };
  }, [mockAi, location.pathname]);
  return state;
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
  }, []);

  // Background cloud sync: a no-op unless Settings.data.sync is on and a user is signed in.
  useEffect(() => {
    const tick = () => void syncNow().catch(() => undefined);
    tick();
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    const id = window.setInterval(tick, 30_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(id);
    };
  }, []);

  // One-time backfill: push any pre-existing local data to the cloud on the first
  // signed-in load (e.g. data created before signing in, or in a prior build).
  useEffect(() => {
    (async () => {
      if (import.meta.env.DEV && useUi.getState().mockAi) return;
      if (!(await isSignedIn())) return;
      if (localStorage.getItem('watai.backfilled')) return;
      await backfillSync().catch(() => undefined);
      localStorage.setItem('watai.backfilled', '1');
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
