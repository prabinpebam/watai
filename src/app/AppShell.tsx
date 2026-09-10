import { useEffect, useRef } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useIsExpanded } from '../lib/hooks';
import { useUi } from '../state/store';
import { repo } from '../data';
import { HistoryList } from '../features/history/HistoryList';
import { Button, IconButton } from '../design/ui';
import { Icon } from '../design/icons';
import { Logo } from '../design/Logo';

function activeThreadId(pathname: string): string | undefined {
  const m = pathname.match(/^\/c\/(.+)$/);
  return m?.[1];
}

function SidebarContent({
  collapsed,
  onNavigate,
  hideBrand,
  libraryPath = '/library',
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  hideBrand?: boolean;
  libraryPath?: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const bump = useUi((s) => s.bumpThreads);
  const activeId = activeThreadId(location.pathname);

  const newChat = async () => {
    const t = await repo.createThread({ title: 'New chat' });
    bump();
    navigate(`/c/${t.id}`);
    onNavigate?.();
  };

  return (
    <>
      {!hideBrand && (
        <div className="sidebar__top">
          <div className="sidebar__brand">
            <Logo size={26} />
            {!collapsed && <span>Watai</span>}
          </div>
        </div>
      )}
      <div className="sidebar__actions">
        <Button variant="secondary" icon="pen-square" onClick={newChat} full aria-label={collapsed ? 'New chat' : undefined} title={collapsed ? 'New chat' : undefined}>
          {!collapsed && <span className="btn--full-label">New chat</span>}
        </Button>
        <Button
          variant="ghost"
          icon="search"
          full
          aria-label={collapsed ? 'Search' : undefined}
          title={collapsed ? 'Search' : undefined}
          onClick={() => {
            navigate('/search');
            onNavigate?.();
          }}
          className="btn--align-start"
        >
          {!collapsed && <span className="btn--full-label">Search</span>}
        </Button>
        <Button
          variant="ghost"
          icon="library"
          full
          aria-label={collapsed ? 'Library' : undefined}
          title={collapsed ? 'Library' : undefined}
          aria-current={location.pathname.startsWith(libraryPath) ? 'page' : undefined}
          onClick={() => {
            navigate(libraryPath);
            onNavigate?.();
          }}
          className="btn--align-start"
        >
          {!collapsed && <span className="btn--full-label">Library</span>}
        </Button>
      </div>

      <HistoryList activeId={activeId} onNavigate={onNavigate} collapsed={collapsed} />

      <div className="sidebar__footer">
        <Button
          variant="ghost"
          icon="settings"
          full
          aria-label={collapsed ? 'Settings' : undefined}
          title={collapsed ? 'Settings' : undefined}
          onClick={() => {
            navigate('/settings');
            onNavigate?.();
          }}
          className="btn--align-start"
        >
          {!collapsed && <span className="btn--full-label">Settings</span>}
        </Button>
      </div>
    </>
  );
}

export function AppShell({ libraryPath = '/library' }: { libraryPath?: string }) {
  const expanded = useIsExpanded();
  const drawerOpen = useUi((s) => s.drawerOpen);
  const toggleDrawer = useUi((s) => s.toggleDrawer);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const mainRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);

  // Close the drawer when switching to expanded layout
  useEffect(() => {
    if (expanded && drawerOpen) toggleDrawer(false);
  }, [expanded, drawerOpen, toggleDrawer]);

  useEffect(() => {
    if (expanded || !drawerOpen) return;
    drawerTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    mainRef.current?.setAttribute('inert', '');
    drawerRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') toggleDrawer(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      mainRef.current?.removeAttribute('inert');
      if (drawerTriggerRef.current?.isConnected) drawerTriggerRef.current.focus();
    };
  }, [expanded, drawerOpen, toggleDrawer]);

  return (
    <div className="app">
      {expanded && (
        <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
          <SidebarContent collapsed={collapsed} libraryPath={libraryPath} />
        </aside>
      )}

      <div className="app__main" ref={mainRef}>
        <Outlet />
      </div>

      {!expanded && drawerOpen && (
        <>
          <div className="drawer-scrim" onClick={() => toggleDrawer(false)} />
          <aside className="drawer" ref={drawerRef} role="dialog" aria-modal="true" aria-label="Navigation menu">
            <div className="sidebar__top">
              <div className="sidebar__brand">
                <Logo size={26} />
                <span>Watai</span>
              </div>
              <IconButton name="close" label="Close menu" onClick={() => toggleDrawer(false)} />
            </div>
            <SidebarContent hideBrand libraryPath={libraryPath} onNavigate={() => toggleDrawer(false)} />
          </aside>
        </>
      )}
    </div>
  );
}

export { SidebarContent };
