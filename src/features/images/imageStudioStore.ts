// Image studio state: server-authoritative gallery + composer + lightbox. The server owns
// generation (queue worker); this store mirrors records, prepends optimistic queued placeholders on
// generate, and applies live status updates pushed over SignalR (with a poll fallback while any
// image is still non-terminal). Records are not persisted locally — the gallery re-fetches on mount
// and the read URLs are ephemeral.
import { create } from 'zustand';
import { cloudApi, realtime } from '../../data';
import { CloudError } from '../../data/cloud/apiClient';
import type { CreateImagesBody, StudioImage as ImageRecord } from '../../data/cloud/types';

export type SortOrder = 'newest' | 'oldest';
export type SizeFilter = '' | '1024x1024' | '1024x1536' | '1536x1024';
export type Quality = 'low' | 'medium' | 'high';

export interface RemixSource {
  id: string;
  prompt: string;
  size: string;
  url?: string;
}

const PAGE_SIZE = 30;

function isPending(img: ImageRecord): boolean {
  return img.status === 'queued' || img.status === 'generating';
}

/** Merge a server record into the list: update in place, or prepend if it's new to this view. */
function mergeImage(list: ImageRecord[], incoming: ImageRecord): ImageRecord[] {
  const idx = list.findIndex((i) => i.id === incoming.id);
  if (idx === -1) return [incoming, ...list];
  const next = list.slice();
  // Keep an existing url if the incoming one is absent (e.g. a 'generating' push after 'ready').
  next[idx] = { ...next[idx], ...incoming, url: incoming.url ?? next[idx].url };
  return next;
}

interface ImageStudioState {
  images: ImageRecord[];
  cursor?: string;
  loading: boolean;
  loadingMore: boolean;
  generating: boolean;
  /** null = unknown (not yet probed); false = no image model configured. */
  imageCapable: boolean | null;
  initialized: boolean;

  // Toolbar
  query: string;
  sizeFilter: SizeFilter;
  sort: SortOrder;

  // Composer
  prompt: string;
  size: string;
  count: number;
  quality: Quality;
  remix: RemixSource | null;
  useReference: boolean;

  // Lightbox (by id so it tracks live updates)
  lightboxId: string | null;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;

  setQuery: (q: string) => void;
  setSizeFilter: (s: SizeFilter) => void;
  setSort: (s: SortOrder) => void;

  setPrompt: (p: string) => void;
  setSize: (s: string) => void;
  setCount: (n: number) => void;
  setQuality: (q: Quality) => void;
  setUseReference: (v: boolean) => void;
  startRemix: (img: ImageRecord) => void;
  clearRemix: () => void;

  generate: () => Promise<{ ok: boolean; error?: string }>;
  generateVariation: (img: ImageRecord) => Promise<{ ok: boolean; error?: string }>;
  retry: (img: ImageRecord) => Promise<void>;
  remove: (id: string) => Promise<void>;

  openLightbox: (id: string) => void;
  closeLightbox: () => void;
  stepLightbox: (dir: 1 | -1) => void;

  applyServerImage: (img: ImageRecord) => void;
  pollPending: () => Promise<void>;
}

let unsubscribeRealtime: (() => void) | null = null;

export const useImageStudio = create<ImageStudioState>((set, get) => ({
  images: [],
  cursor: undefined,
  loading: false,
  loadingMore: false,
  generating: false,
  imageCapable: null,
  initialized: false,

  query: '',
  sizeFilter: '',
  sort: 'newest',

  prompt: '',
  size: '1024x1024',
  count: 1,
  quality: 'medium',
  remix: null,
  useReference: true,

  lightboxId: null,

  async init() {
    if (get().initialized) {
      await get().refresh();
      return;
    }
    set({ initialized: true, loading: true });
    // Probe image capability (best-effort) so the composer can disable with a clear notice.
    cloudApi
      .getCredentialStatus()
      .then((s) => set({ imageCapable: s.capabilities?.image ?? !!s.models?.image }))
      .catch(() => set({ imageCapable: null }));

    // Subscribe to realtime pushes once (singleton store).
    if (!unsubscribeRealtime) {
      unsubscribeRealtime = realtime.on('image', (payload: unknown) => {
        const img = (payload as { image?: ImageRecord } | null)?.image;
        if (img) get().applyServerImage(img);
      });
      void realtime.ensure();
    }
    await get().refresh();
  },

  async refresh() {
    const { query, sizeFilter, sort } = get();
    set({ loading: true });
    try {
      const res = await cloudApi.listImages({
        ...(query.trim() ? { q: query.trim() } : {}),
        ...(sizeFilter ? { size: sizeFilter } : {}),
        sort,
        limit: PAGE_SIZE,
      });
      set({ images: res.images, cursor: res.cursor, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  async loadMore() {
    const { cursor, loadingMore, query, sizeFilter, sort, images } = get();
    if (!cursor || loadingMore) return;
    set({ loadingMore: true });
    try {
      const res = await cloudApi.listImages({
        ...(query.trim() ? { q: query.trim() } : {}),
        ...(sizeFilter ? { size: sizeFilter } : {}),
        sort,
        limit: PAGE_SIZE,
        cursor,
      });
      // De-dupe in case a live push already prepended one of these.
      const seen = new Set(images.map((i) => i.id));
      const fresh = res.images.filter((i) => !seen.has(i.id));
      set({ images: [...images, ...fresh], cursor: res.cursor, loadingMore: false });
    } catch {
      set({ loadingMore: false });
    }
  },

  setQuery(q) {
    set({ query: q });
    void get().refresh();
  },
  setSizeFilter(s) {
    set({ sizeFilter: s });
    void get().refresh();
  },
  setSort(s) {
    set({ sort: s });
    void get().refresh();
  },

  setPrompt(p) {
    set({ prompt: p });
  },
  setSize(s) {
    set({ size: s });
  },
  setCount(n) {
    set({ count: Math.min(Math.max(n, 1), 4) });
  },
  setQuality(q) {
    set({ quality: q });
  },
  setUseReference(v) {
    set({ useReference: v });
  },

  startRemix(img) {
    set({
      remix: { id: img.id, prompt: img.prompt, size: img.size, url: img.url },
      prompt: img.prompt,
      size: img.size,
      useReference: true,
      lightboxId: null,
    });
  },
  clearRemix() {
    set({ remix: null });
  },

  async generate() {
    const { prompt, size, count, quality, remix, useReference } = get();
    const text = prompt.trim();
    if (!text || get().generating) return { ok: false };
    set({ generating: true });
    const body: CreateImagesBody = {
      prompt: text,
      size,
      count,
      quality,
      ...(remix ? { sourceImageId: remix.id, useReference } : {}),
    };
    try {
      const created = await cloudApi.createImages(body);
      set((s) => ({
        images: [...created, ...s.images],
        generating: false,
        prompt: '',
        remix: null,
      }));
      return { ok: true };
    } catch (e) {
      set({ generating: false });
      const msg = e instanceof CloudError ? e.message : 'Could not start generation.';
      return { ok: false, error: msg };
    }
  },

  async generateVariation(img) {
    set({ generating: true });
    try {
      const created = await cloudApi.createImages({
        prompt: img.prompt,
        size: img.size,
        count: 1,
        ...(img.quality ? { quality: img.quality } : {}),
        sourceImageId: img.id,
        useReference: true,
      });
      set((s) => ({ images: [...created, ...s.images], generating: false }));
      return { ok: true };
    } catch (e) {
      set({ generating: false });
      const msg = e instanceof CloudError ? e.message : 'Could not start generation.';
      return { ok: false, error: msg };
    }
  },

  async retry(img) {
    set({
      prompt: img.prompt,
      size: img.size,
      ...(img.quality ? { quality: img.quality } : {}),
      ...(img.sourceImageId ? { remix: { id: img.sourceImageId, prompt: img.prompt, size: img.size } } : {}),
    });
    const res = await get().generate();
    if (res.ok) await get().remove(img.id);
  },

  async remove(id) {
    const prev = get().images;
    set({
      images: prev.filter((i) => i.id !== id),
      lightboxId: get().lightboxId === id ? null : get().lightboxId,
    });
    try {
      await cloudApi.deleteImage(id);
    } catch {
      set({ images: prev }); // rollback
    }
  },

  openLightbox(id) {
    set({ lightboxId: id });
  },
  closeLightbox() {
    set({ lightboxId: null });
  },
  stepLightbox(dir) {
    const { images, lightboxId } = get();
    const ready = images.filter((i) => i.status === 'ready');
    const idx = ready.findIndex((i) => i.id === lightboxId);
    if (idx === -1) return;
    const next = ready[(idx + dir + ready.length) % ready.length];
    if (next) set({ lightboxId: next.id });
  },

  applyServerImage(img) {
    set((s) => ({ images: mergeImage(s.images, img) }));
  },

  async pollPending() {
    const pending = get().images.filter(isPending);
    if (pending.length === 0) return;
    const results = await Promise.allSettled(pending.map((p) => cloudApi.getImage(p.id)));
    for (const r of results) {
      if (r.status === 'fulfilled') get().applyServerImage(r.value);
    }
  },
}));

/** Whether any image is still queued/generating (drives the poll fallback). */
export function hasPendingImages(images: ImageRecord[]): boolean {
  return images.some(isPending);
}
