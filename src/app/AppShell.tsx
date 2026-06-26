import { useEffect } from 'react';
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
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
  hideBrand?: boolean;
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
        <Button variant="secondary" icon="pen-square" onClick={newChat} full>
          {!collapsed && <span className="btn--full-label">New chat</span>}
        </Button>
        <Button
          variant="ghost"
          icon="search"
          full
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
          icon="image"
          full
          onClick={() => {
            navigate('/images');
            onNavigate?.();
          }}
          className="btn--align-start"
        >
          {!collapsed && <span className="btn--full-label">Images</span>}
        </Button>
      </div>

      <HistoryList activeId={activeId} onNavigate={onNavigate} collapsed={collapsed} />

      <div className="sidebar__footer">
        <Button
          variant="ghost"
          icon="settings"
          full
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

export function AppShell() {
  const expanded = useIsExpanded();
  const drawerOpen = useUi((s) => s.drawerOpen);
  const toggleDrawer = useUi((s) => s.toggleDrawer);
  const collapsed = useUi((s) => s.sidebarCollapsed);

  // Close the drawer when switching to expanded layout
  useEffect(() => {
    if (expanded && drawerOpen) toggleDrawer(false);
  }, [expanded, drawerOpen, toggleDrawer]);

  return (
    <div className="app">
      {expanded && (
        <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''}`}>
          <SidebarContent collapsed={collapsed} />
        </aside>
      )}

      <div className="app__main">
        <Outlet />
      </div>

      {!expanded && drawerOpen && (
        <>
          <div className="drawer-scrim" onClick={() => toggleDrawer(false)} />
          <aside className="drawer">
            <div className="sidebar__top">
              <div className="sidebar__brand">
                <Logo size={26} />
                <span>Watai</span>
              </div>
              <IconButton name="close" label="Close menu" onClick={() => toggleDrawer(false)} />
            </div>
            <SidebarContent hideBrand onNavigate={() => toggleDrawer(false)} />
          </aside>
        </>
      )}
    </div>
  );
}

export { SidebarContent };
