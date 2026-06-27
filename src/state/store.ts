import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CapabilityMatrix, Citation, Density, TextScale, Theme, ThreadLock, Toast } from '../lib/types';
import { newId } from '../lib/ids';

interface StreamState {
  status: 'idle' | 'pending' | 'streaming' | 'stopped' | 'error';
  threadId?: string;
  messageId?: string;
}

/** A pending confirmation surfaced as a design-system dialog (no native window.confirm). */
export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

interface UiState {
  theme: Theme;
  textScale: TextScale;
  density: Density;
  reduceMotion: boolean | 'system';

  drawerOpen: boolean;
  sidebarCollapsed: boolean;
  activeModelByThread: Record<string, string>;
  composerDrafts: Record<string, string>;
  temporaryChat: boolean;

  stream: StreamState;
  capability: CapabilityMatrix | null;
  connectivity: 'online' | 'offline';
  toasts: Toast[];
  threadsVersion: number;
  /** Per-thread message revision; bumped when a thread's persisted messages change. */
  threadRev: Record<string, number>;
  /** Per-thread run lock (another device is generating). Transient; never persisted/synced. */
  threadLocks: Record<string, ThreadLock | null>;
  confirmRequest: ConfirmRequest | null;
  /** Open source-detail pane (web search results) — transient, never persisted. */
  sourcePane: { citations: Citation[]; index: number } | null;
  /** Open thread-files pane (the thread id whose knowledge base is shown) — transient. */
  filesPane: string | null;

  setTheme: (t: Theme) => void;
  setTextScale: (s: TextScale) => void;
  setDensity: (d: Density) => void;
  setReduceMotion: (r: boolean | 'system') => void;
  toggleDrawer: (open?: boolean) => void;
  toggleSidebar: (collapsed?: boolean) => void;
  setDraft: (threadId: string, text: string) => void;
  setModelForThread: (threadId: string, model: string) => void;
  setTemporaryChat: (v: boolean) => void;
  setStream: (s: StreamState) => void;
  setCapability: (c: CapabilityMatrix | null) => void;
  setConnectivity: (c: 'online' | 'offline') => void;
  pushToast: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: string) => void;
  bumpThreads: () => void;
  bumpThread: (threadId: string) => void;
  setThreadLock: (threadId: string, lock: ThreadLock | null) => void;
  requestConfirm: (opts: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>;
  resolveConfirm: (ok: boolean) => void;
  openSourcePane: (citations: Citation[], index: number) => void;
  setSourceIndex: (index: number) => void;
  closeSourcePane: () => void;
  openFilesPane: (threadId: string) => void;
  toggleFilesPane: (threadId: string) => void;
  closeFilesPane: () => void;
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      textScale: 1.0,
      density: 'comfortable',
      reduceMotion: 'system',

      drawerOpen: false,
      sidebarCollapsed: false,
      activeModelByThread: {},
      composerDrafts: {},
      temporaryChat: false,

      stream: { status: 'idle' },
      capability: null,
      connectivity: 'online',
      toasts: [],
      threadsVersion: 0,
      threadRev: {},
      threadLocks: {},
      confirmRequest: null,
      sourcePane: null,
      filesPane: null,

      setTheme: (theme) => set({ theme }),
      setTextScale: (textScale) => set({ textScale }),
      setDensity: (density) => set({ density }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      toggleDrawer: (open) => set((s) => ({ drawerOpen: open ?? !s.drawerOpen })),
      toggleSidebar: (collapsed) => set((s) => ({ sidebarCollapsed: collapsed ?? !s.sidebarCollapsed })),
      setDraft: (threadId, text) =>
        set((s) => ({ composerDrafts: { ...s.composerDrafts, [threadId]: text } })),
      setModelForThread: (threadId, model) =>
        set((s) => ({ activeModelByThread: { ...s.activeModelByThread, [threadId]: model } })),
      setTemporaryChat: (temporaryChat) => set({ temporaryChat }),
      setStream: (stream) => set({ stream }),
      setCapability: (capability) => set({ capability }),
      setConnectivity: (connectivity) => set({ connectivity }),
      pushToast: (message, kind) =>
        set((s) => ({ toasts: [...s.toasts, { id: newId(), message, kind }] })),
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      bumpThreads: () => set((s) => ({ threadsVersion: s.threadsVersion + 1 })),
      bumpThread: (threadId) =>
        set((s) => ({ threadRev: { ...s.threadRev, [threadId]: (s.threadRev[threadId] ?? 0) + 1 } })),
      setThreadLock: (threadId, lock) =>
        set((s) => ({ threadLocks: { ...s.threadLocks, [threadId]: lock } })),
      requestConfirm: (opts) =>
        new Promise<boolean>((resolve) => set({ confirmRequest: { ...opts, resolve } })),
      resolveConfirm: (ok) => {
        const req = get().confirmRequest;
        if (req) req.resolve(ok);
        set({ confirmRequest: null });
      },
      openSourcePane: (citations, index) => set({ sourcePane: { citations, index }, filesPane: null }),
      setSourceIndex: (index) =>
        set((s) => (s.sourcePane ? { sourcePane: { ...s.sourcePane, index } } : {})),
      closeSourcePane: () => set({ sourcePane: null }),
      openFilesPane: (threadId) => set({ filesPane: threadId, sourcePane: null }),
      toggleFilesPane: (threadId) =>
        set((s) => ({ filesPane: s.filesPane === threadId ? null : threadId, sourcePane: null })),
      closeFilesPane: () => set({ filesPane: null }),
    }),
    {
      name: 'watai.ui',
      partialize: (s) => ({
        theme: s.theme,
        textScale: s.textScale,
        density: s.density,
        reduceMotion: s.reduceMotion,
        sidebarCollapsed: s.sidebarCollapsed,
        composerDrafts: s.composerDrafts,
        activeModelByThread: s.activeModelByThread,
      }),
    },
  ),
);
