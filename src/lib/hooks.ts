import { useEffect, useState, type RefObject } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = () => setMatches(mql.matches);
    handler();
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

/** Expanded layout: persistent sidebar + dialogs (>= 1024px). */
export function useIsExpanded(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/**
 * Dismiss a popover/menu on Escape or a pointer-down outside it. Pass the panel ref plus any
 * refs that must NOT count as "outside" (e.g. the trigger button). Shared by every anchored
 * surface (Menu, ToolsMenu, …) so dismiss behavior is defined once.
 */
export function useDismiss(
  active: boolean,
  onClose: () => void,
  refs: Array<RefObject<HTMLElement | null>>,
): void {
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (refs.some((r) => r.current?.contains(target))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
    // refs are stable ref objects; re-subscribe only when active/onClose change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onClose]);
}
