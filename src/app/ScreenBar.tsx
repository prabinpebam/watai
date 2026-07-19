import type { ReactNode } from 'react';
import { IconButton } from '../design/ui';
import { useIsExpanded } from '../lib/hooks';
import { useUi } from '../state/store';

export function ScreenBar({ title, trailing }: { title: string; trailing?: ReactNode }) {
  const expanded = useIsExpanded();
  const toggleDrawer = useUi((state) => state.toggleDrawer);
  const toggleSidebar = useUi((state) => state.toggleSidebar);
  return (
    <div className="appbar">
      {expanded ? (
        <IconButton name="sidebar" label="Toggle sidebar" onClick={() => toggleSidebar()} />
      ) : (
        <IconButton name="menu" label="Open menu" onClick={() => toggleDrawer(true)} />
      )}
      <div className="appbar__title">{title}</div>
      <div className="appbar__actions">{trailing}</div>
    </div>
  );
}
