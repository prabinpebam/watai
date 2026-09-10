import { useEffect, useState, lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { AppShell } from './AppShell';
import { Spinner, Button } from '../design/ui';
import { useUi } from '../state/store';
import { accountLocalStorageKey, repo, cloudApi, seedMockDataIfEmpty, purgeDemoData, syncNow, backfillSync, realtime } from '../data';
import { restoreInterruptedRuns } from '../features/chat/runStore';
import { clearApiCredentials } from '../data/secureStore';
import { isSignedIn, signOut } from '../auth/cloudAuth';
import { loadMe, cachedMe } from '../auth/access';
import { newId } from '../lib/ids';
import { ScreenBar } from './ScreenBar';
import { AppErrorBoundary } from './AppErrorBoundary';

const ChatScreen = lazy(() => import('../features/chat/ChatScreen').then((module) => ({ default: module.ChatScreen })));
const SearchView = lazy(() => import('../features/history/SearchView').then((module) => ({ default: module.SearchView })));
const ImagesView = lazy(() => import('../features/images/ImagesView').then((module) => ({ default: module.ImagesView })));
const Settings = lazy(() => import('../features/settings/Settings').then((module) => ({ default: module.Settings })));
const Onboarding = lazy(() => import('../features/onboarding/Onboarding').then((module) => ({ default: module.Onboarding })));
const VoiceMode = lazy(() => import('../features/voice/VoiceMode').then((module) => ({ default: module.VoiceMode })));
const LibraryView = lazy(() => import('../features/library/LibraryView').then((module) => ({ default: module.LibraryView })));
const LibraryDetail = lazy(() => import('../features/library/LibraryDetail').then((module) => ({ default: module.LibraryDetail })));

// Dev-only chat component gallery. The dynamic import sits in a branch that is statically
// false in production, so the chunk is tree-shaken out of the prod bundle entirely.
const ChatGallery = import.meta.env.DEV ? lazy(() => import('../mocks/ChatGallery')) : null;
const LibraryExperienceFixture = import.meta.env.DEV
  ? lazy(() => import('../features/library/LibraryExperienceFixture').then((module) => ({ default: module.LibraryExperienceFixture })))
  : null;
const LibraryPickerExperienceFixture = import.meta.env.DEV
  ? lazy(() => import('../features/library/LibraryPickerExperienceFixture').then((module) => ({ default: module.LibraryPickerExperienceFixture })))
  : null;

/** Recency window: reopening within this of the last activity resumes the most recent chat;
 *  beyond it, a fresh empty chat opens instead. */
const RESUME_WINDOW_MS = 5 * 60 * 1000;

export function RootRedirect() {
  const navigate = useNavigate();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setError(false);
    repo.listThreads().then((threads) => {
      if (!live) return;
      // threads[0] is the most recently active chat (listThreads sorts by updatedAt desc). Resume
      // it only if its last activity is recent; otherwise start a fresh empty chat. updatedAt is
      // server-synced, so "recent activity" reflects other tabs/devices too.
      const recent = threads[0];
      const fresh = recent && Date.now() - new Date(recent.updatedAt).getTime() < RESUME_WINDOW_MS;
      navigate(fresh ? `/c/${recent.id}` : '/new', { replace: true });
    }).catch(() => { if (live) setError(true); });
    return () => {
      live = false;
    };
  }, [attempt, navigate]);
  if (error) {
    return (
      <div className="center-screen" role="alert">
        <div className="col" style={{ alignItems: 'center' }}>
          <p>Conversations couldn’t be loaded.</p>
          <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>Retry conversations</Button>
        </div>
      </div>
    );
  }
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

type SetupState = 'loading' | 'error' | 'no-session' | 'no-access' | 'no-config' | 'ready';
const BOOTSTRAP_TIMEOUT_MS = 15_000;

function boundedBootstrap<T>(operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('Setup timed out.')), BOOTSTRAP_TIMEOUT_MS);
    operation.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error) => { window.clearTimeout(timer); reject(error); },
    );
  });
}

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

function useSetupState(): { state: SetupState; retry: () => void } {
  // Optimistic boot: a browser that was configured before shows the app immediately while we
  // re-verify in the background, so the home page never waits on an auth/credentials round-trip.
  // Only a definitive negative (signed out / empty vault) corrects it.
  const [state, setState] = useState<SetupState>(() => (wasConfigured() ? 'ready' : 'loading'));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // Cloud-account-only: a signed-in Entra account is required.
        if (!(await boundedBootstrap(isSignedIn()))) {
          if (live) setState('no-session');
          return;
        }
        const me = await boundedBootstrap(loadMe(attempt > 0));
        if (!me) throw new Error('Access status unavailable.');
        if (!me.isInvited) {
          if (live) setState('no-access');
          return;
        }
        // Credentials live in the server vault now; wipe anything a pre-cloud build stored locally.
        void clearApiCredentials();
        const configured = (await boundedBootstrap(cloudApi.getCredentialStatus())).configured;
        rememberConfigured(configured);
        if (live) setState(configured ? 'ready' : 'no-config');
      } catch {
        if (live) setState(wasConfigured() ? 'ready' : 'error');
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt]);
  return { state, retry: () => { setState('loading'); setAttempt((value) => value + 1); } };
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

export function Protected({ children }: { children: ReactNode }) {
  const { state, retry } = useSetupState();
  if (state === 'loading') {
    return (
      <div className="center-screen">
        <Spinner size="xl" />
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="center-screen" role="alert">
        <div className="onboard" style={{ maxWidth: 440 }}>
          <h1 className="onboard__title">Watai couldn’t finish starting</h1>
          <p className="onboard__sub">Check your connection and try the account check again.</p>
          <div className="onboard__actions"><Button variant="primary" full onClick={retry}>Retry startup</Button></div>
        </div>
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
    let live = true;
    let dispose: (() => void) | undefined;
    const onResume = () => tick();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    void (async () => {
      if (!(await isSignedIn()) || !live) return;
      // The migration effect below performs the initial sync. This effect owns only recurring
      // sync, and must never ask MSAL for a token on the signed-out welcome screen.
      window.addEventListener('focus', onResume);
      window.addEventListener('pageshow', onResume);
      document.addEventListener('visibilitychange', onVisibility);
      const id = window.setInterval(tick, 30_000);
      dispose = () => {
        window.removeEventListener('focus', onResume);
        window.removeEventListener('pageshow', onResume);
        document.removeEventListener('visibilitychange', onVisibility);
        window.clearInterval(id);
      };
    })();
    return () => {
      live = false;
      dispose?.();
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
        const event = payload as { jobId?: string; acceptedCount?: number; threadId?: string; updatedAt?: string; assistantMessageId?: string } | null;
        if (!event?.threadId) return;
        useUi.getState().setMemoryNotice({
          ...(event.jobId ? { id: event.jobId } : {}),
          threadId: event.threadId,
          ...(event.assistantMessageId ? { messageId: event.assistantMessageId } : {}),
          acceptedCount: Math.max(1, event.acceptedCount ?? 1),
          updatedAt: event.updatedAt ?? new Date().toISOString(),
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
  // Also retry the sync whenever the network returns, so a chat composed while offline (or a
  // sync that failed during a transient drop) reconciles without a manual reload.
  useEffect(() => {
    const backfillKey = accountLocalStorageKey('watai.backfilled.v2');
    const runSync = () =>
      syncNow()
        .then((changed) => {
          const ui = useUi.getState();
          ui.bumpThreads();
          changed?.forEach((id) => ui.bumpThread(id));
        })
        .catch((e) => console.warn('[sync] sync failed', e));

    let onOnline: (() => void) | undefined;
    (async () => {
      if (!(await isSignedIn())) return;
      const settings = await repo.getSettings();
      if (!settings.data.sync) {
        await repo.saveSettings({ ...settings, data: { ...settings.data, sync: true } });
        // Sync was off before, so existing local data was never queued — force a re-backfill.
        localStorage.removeItem(backfillKey);
      }
      // v2: earlier builds dropped queued ops on a 403 (not-invited) before invite access
      // was sorted out, so existing chats never reached the cloud. Re-enqueue everything once.
      if (!localStorage.getItem(backfillKey)) {
        await backfillSync().catch((e) => console.warn('[sync] backfill failed', e));
        localStorage.setItem(backfillKey, '1');
      }
      await runSync();
      onOnline = () => void runSync();
      window.addEventListener('online', onOnline);
    })();
    return () => {
      if (onOnline) window.removeEventListener('online', onOnline);
    };
  }, []);

  return (
    <AppErrorBoundary>
    <Suspense fallback={<div className="center-screen"><Spinner size="xl" /></div>}>
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
        <Route path="/library" element={<LibraryView />} />
        <Route path="/library/:itemId" element={<LibraryDetail />} />
        <Route path="/library/create/image" element={<><ScreenBar title="Create image" /><ImagesView /></>} />
        <Route path="/images" element={<Navigate to="/library?kind=image" replace />} />
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

      {LibraryExperienceFixture && (
        <Route
          path="/dev/library-eval"
          element={
            <Suspense fallback={<div className="center-screen"><Spinner size="xl" /></div>}>
              <LibraryExperienceFixture />
            </Suspense>
          }
        >
          <Route index element={<LibraryView />} />
          <Route path=":itemId" element={<LibraryDetail />} />
        </Route>
      )}

      {LibraryPickerExperienceFixture && (
        <>
          <Route path="/dev/library-picker-eval" element={<Suspense fallback={<div className="center-screen"><Spinner size="xl" /></div>}><LibraryPickerExperienceFixture /></Suspense>} />
          <Route path="/dev/library-new-chat-eval/:threadId" element={<Suspense fallback={<div className="center-screen"><Spinner size="xl" /></div>}><LibraryPickerExperienceFixture /></Suspense>} />
        </>
      )}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </AppErrorBoundary>
  );
}
