import { useEffect, useState, lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
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
import { repo, cloudApi, seedMockDataIfEmpty, purgeDemoData, syncNow, backfillSync, realtime } from '../data';
import { restoreInterruptedRuns } from '../features/chat/runStore';
import { clearApiCredentials } from '../data/secureStore';
import { isSignedIn, signOut } from '../auth/cloudAuth';
import { loadMe, cachedMe } from '../auth/access';
import { newId } from '../lib/ids';

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
      <div style={{ width: 'var(--size-control-md)' }} />
    </div>
  );
}

/** Recency window: reopening within this of the last activity resumes the most recent chat;
 *  beyond it, a fresh empty chat opens instead. */
const RESUME_WINDOW_MS = 5 * 60 * 1000;

function RootRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    let live = true;
    repo.listThreads().then((threads) => {
      if (!live) return;
      // threads[0] is the most recently active chat (listThreads sorts by updatedAt desc). Resume
      // it only if its last activity is recent; otherwise start a fresh empty chat. updatedAt is
      // server-synced, so "recent activity" reflects other tabs/devices too.
      const recent = threads[0];
      const fresh = recent && Date.now() - new Date(recent.updatedAt).getTime() < RESUME_WINDOW_MS;
      navigate(fresh ? `/c/${recent.id}` : '/new', { replace: true });
    });
    return () => {
      live = false;
    };
  }, [navigate]);
  return (
    <div className="center-screen">
      <Spinner size="xl" />
    </div>
  );
}

/** A fresh chat: mint an id and redirect to /c/{id} so the thread id lives in the URL from the
 *  start. The thread itself is only persisted once the first prompt commits it (lazy create), so
 *  an abandoned welcome page never litters history. */
function NewChatRedirect() {
  const [id] = useState(() => newId());
  return <Navigate to={`/c/${id}`} replace />;
}

type SetupState = 'loading' | 'no-session' | 'no-access' | 'no-config' | 'ready';

// Remember the last *confirmed* "endpoint configured" result so a transient status-check failure
// (token refresh, function cold start, a network blip) never forces a configured account back
// through onboarding. Only a definitive empty vault (a successful `configured: false`) does.
const CONFIGURED_KEY = 'watai.configured';
function rememberConfigured(v: boolean): void {
  try {
    if (v) localStorage.setItem(CONFIGURED_KEY, '1');
    else localStorage.removeItem(CONFIGURED_KEY);
  } catch {
    /* storage unavailable — best effort */
  }
}
function wasConfigured(): boolean {
  try {
    return localStorage.getItem(CONFIGURED_KEY) === '1';
  } catch {
    return false;
  }
}

function useSetupState(): SetupState {
  // Optimistic boot: a browser that was configured before shows the app immediately while we
  // re-verify in the background, so the home page never waits on an auth/credentials round-trip.
  // Only a definitive negative (signed out / empty vault) corrects it.
  const [state, setState] = useState<SetupState>(() => (wasConfigured() ? 'ready' : 'loading'));
  useEffect(() => {
    let live = true;
    (async () => {
      // Cloud-account-only: a signed-in Entra account is required.
      if (!(await isSignedIn())) {
        if (live) setState('no-session');
        return;
      }
      // Invite-only: a definitive "not invited" blocks the UI. Transient API/network errors
      // fall through (the backend still enforces access on every call).
      const me = await loadMe();
      if (me && !me.isInvited) {
        if (live) setState('no-access');
        return;
      }
      // Credentials live in the server vault now; wipe anything a pre-cloud build stored locally.
      void clearApiCredentials();
      // `configured`: true (vault has keys), false (definitely empty), null (couldn't verify — do
      // not downgrade a previously-configured account over a transient failure).
      const configured = await cloudApi
        .getCredentialStatus()
        .then((s) => s.configured)
        .catch(() => null);
      if (configured !== null) rememberConfigured(configured);
      if (live) setState((configured ?? wasConfigured()) ? 'ready' : 'no-config');
    })();
    return () => {
      live = false;
    };
  }, []);
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
        <Spinner size="xl" />
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

  // Global realtime: keep a persistent 'thread' handler so a title/preview push (emitted as the
  // server auto-names a chat from its first exchange) refreshes the sidebar + header title in real
  // time — even when it lands after a run's own short-lived handlers were torn down. This is what
  // makes a fresh chat rename itself without a page refresh. Best-effort; sync polling is fallback.
  useEffect(() => {
    let off: (() => void) | undefined;
    (async () => {
      if (!(await isSignedIn())) return;
      void realtime.ensure();
      off = realtime.on('thread', (payload) => {
        const threadId = (payload as { thread?: { id?: string } } | null)?.thread?.id;
        const ui = useUi.getState();
        ui.bumpThreads();
        if (threadId) ui.bumpThread(threadId);
        void syncNow()
          .then((changed) => {
            const ui = useUi.getState();
            ui.bumpThreads();
            changed?.forEach((tid) => ui.bumpThread(tid));
            if (threadId) ui.bumpThread(threadId);
          })
          .catch(() => undefined);
      });
      const offMemory = realtime.on('memory', (payload) => {
        const count = (payload as { acceptedCount?: number } | null)?.acceptedCount ?? 1;
        useUi.getState().pushToast(count > 1 ? `${count} memories updated` : 'Memory updated', 'success', {
          persistent: true,
          key: 'memory-updated',
        });
      });
      const previousOff = off;
      off = () => {
        previousOff?.();
        offMemory();
      };
    })();
    return () => off?.();
  }, []);

  // Cloud-account-only: ensure sync is on for the signed-in user (migrating any stale
  // sync=false saved before cloud-only), backfill pre-existing local data once, then sync.
  useEffect(() => {
    (async () => {
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
        <Route path="/new" element={<NewChatRedirect />} />
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
                  <Spinner size="xl" />
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
