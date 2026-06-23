import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CapabilityMatrix, Density, TextScale, Theme, Toast } from '../lib/types';
import { newId } from '../lib/ids';

interface StreamState {
  status: 'idle' | 'pending' | 'streaming' | 'stopped' | 'error';
  threadId?: string;
  messageId?: string;
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
  mockAi: boolean;

  stream: StreamState;
  capability: CapabilityMatrix | null;
  connectivity: 'online' | 'offline';
  toasts: Toast[];
  threadsVersion: number;

  setTheme: (t: Theme) => void;
  setTextScale: (s: TextScale) => void;
  setDensity: (d: Density) => void;
  setReduceMotion: (r: boolean | 'system') => void;
  toggleDrawer: (open?: boolean) => void;
  toggleSidebar: (collapsed?: boolean) => void;
  setDraft: (threadId: string, text: string) => void;
  setModelForThread: (threadId: string, model: string) => void;
  setTemporaryChat: (v: boolean) => void;
  setMockAi: (v: boolean) => void;
  setStream: (s: StreamState) => void;
  setCapability: (c: CapabilityMatrix | null) => void;
  setConnectivity: (c: 'online' | 'offline') => void;
  pushToast: (message: string, kind?: Toast['kind']) => void;
  dismissToast: (id: string) => void;
  bumpThreads: () => void;
}

export const useUi = create<UiState>()(
  persist(
    (set) => ({
      theme: 'system',
      textScale: 1.0,
      density: 'comfortable',
      reduceMotion: 'system',

      drawerOpen: false,
      sidebarCollapsed: false,
      activeModelByThread: {},
      composerDrafts: {},
      temporaryChat: false,
      mockAi: false,

      stream: { status: 'idle' },
      capability: null,
      connectivity: 'online',
      toasts: [],
      threadsVersion: 0,

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
      setMockAi: (mockAi) => set({ mockAi }),
      setStream: (stream) => set({ stream }),
      setCapability: (capability) => set({ capability }),
      setConnectivity: (connectivity) => set({ connectivity }),
      pushToast: (message, kind) =>
        set((s) => ({ toasts: [...s.toasts, { id: newId(), message, kind }] })),
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      bumpThreads: () => set((s) => ({ threadsVersion: s.threadsVersion + 1 })),
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
        mockAi: s.mockAi,
      }),
    },
  ),
);
