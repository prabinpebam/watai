import { useEffect, useState } from 'react';
import { cloudApi } from '../data';
import type { MeInfo } from '../data/cloud/types';

// Caches the caller's access status (GET /api/me) for the session. The backend is the
// real security gate (403 for non-invited); this is for routing the UI.
let cache: MeInfo | null = null;
let inflight: Promise<MeInfo | null> | null = null;

export async function loadMe(force = false): Promise<MeInfo | null> {
  if (cache && !force) return cache;
  if (!inflight) {
    inflight = cloudApi
      .getMe()
      .then((m) => {
        cache = m;
        inflight = null;
        return m;
      })
      .catch(() => {
        inflight = null;
        return null;
      });
  }
  return inflight;
}

export function cachedMe(): MeInfo | null {
  return cache;
}

export function clearMe(): void {
  cache = null;
  inflight = null;
}

/** React hook: the caller's access status, loaded once. */
export function useMe(): MeInfo | null {
  const [me, setMe] = useState<MeInfo | null>(cachedMe());
  useEffect(() => {
    let live = true;
    loadMe().then((m) => {
      if (live) setMe(m);
    });
    return () => {
      live = false;
    };
  }, []);
  return me;
}
