import type { Thread } from './types';

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function relativeDay(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Previous 7 days';
  if (days < 30) return 'Previous 30 days';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export interface ThreadGroup {
  label: string;
  threads: Thread[];
}

const ORDER = ['Pinned', 'Today', 'Yesterday', 'Previous 7 days', 'Previous 30 days'];

/** Group threads into recency buckets, pinned first. */
export function groupThreads(threads: Thread[]): ThreadGroup[] {
  const map = new Map<string, Thread[]>();
  const sorted = [...threads].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  for (const t of sorted) {
    const label = t.pinned ? 'Pinned' : relativeDay(t.updatedAt);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(t);
  }
  const groups = [...map.entries()].map(([label, ts]) => ({ label, threads: ts }));
  groups.sort((a, b) => {
    const ia = ORDER.indexOf(a.label);
    const ib = ORDER.indexOf(b.label);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return groups;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
