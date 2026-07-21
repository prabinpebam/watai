import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { repo } from '../../data';
import { useUi } from '../../state/store';
import { useRuns } from '../chat/runStore';
import { groupThreads } from '../../lib/format';
import { Icon } from '../../design/icons';
import { IconButton } from '../../design/ui';
import { Menu, ConfirmDialog, PromptDialog, type MenuItemDef } from '../../design/overlays';
import type { Thread } from '../../lib/types';

interface HistoryListProps {
  activeId?: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}

export function HistoryList({ activeId, onNavigate, collapsed }: HistoryListProps) {
  const navigate = useNavigate();
  const version = useUi((s) => s.threadsVersion);
  const checkingForUpdates = useUi((s) => s.threadSyncCount > 0);
  const bump = useUi((s) => s.bumpThreads);
  const pushToast = useUi((s) => s.pushToast);
  // Thread ids with an active run. Subscribe to the keys (joined) so the list only re-renders
  // when a run starts/stops — not on every streamed token.
  const runKey = useRuns((s) => Object.keys(s.runs).sort().join('|'));
  const runningSet = new Set(runKey ? runKey.split('|') : []);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; thread: Thread } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Thread | null>(null);
  const [renameTarget, setRenameTarget] = useState<Thread | null>(null);

  useEffect(() => {
    repo.listThreads({ includeArchived: false }).then(setThreads);
  }, [version]);

  const go = (id: string) => {
    navigate(`/c/${id}`);
    onNavigate?.();
  };

  const openMenu = (e: React.MouseEvent, thread: Thread) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ x: rect.right - 8, y: rect.bottom + 4, thread });
  };

  const rename = (thread: Thread) => setRenameTarget(thread);

  const menuItems = (thread: Thread): MenuItemDef[] => [
    {
      label: thread.pinned ? 'Unpin' : 'Pin',
      icon: 'pin',
      onClick: async () => {
        await repo.updateThread(thread.id, { pinned: !thread.pinned });
        bump();
      },
    },
    { label: 'Rename', icon: 'pen-square', onClick: () => rename(thread) },
    {
      label: 'Archive',
      icon: 'archive',
      onClick: async () => {
        await repo.updateThread(thread.id, { archived: true });
        bump();
        pushToast('Conversation archived');
      },
    },
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => setConfirmDelete(thread) },
  ];

  const groups = groupThreads(threads);

  return (
    <div className="sidebar__list">
      {!collapsed && (
        <div
          className={`thread-sync-status${checkingForUpdates ? ' thread-sync-status--active' : ''}`}
          role={checkingForUpdates ? 'progressbar' : undefined}
          aria-label={checkingForUpdates ? 'Checking for conversation updates' : undefined}
        />
      )}
      {groups.length === 0 && (
        <p className="muted" style={{ padding: 'var(--space-4)', fontSize: 'var(--text-caption-size)' }}>
          No conversations yet.
        </p>
      )}
      {groups.map((g) => (
        <div className="nav-group" key={g.label}>
          {!collapsed && <div className="nav-group__label">{g.label}</div>}
          {g.threads.map((t) => (
            <div
              key={t.id}
              className={`conv-row ${
                t.id === activeId
                  ? 'conv-row--active'
                  : runningSet.has(t.id)
                    ? 'conv-row--running'
                    : ''
              }`}
              onClick={() => go(t.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && go(t.id)}
              title={t.title}
            >
              {collapsed ? (
                <Icon name="sparkle" size={20} />
              ) : (
                <>
                  {t.pinned && <Icon name="pin" size={14} />}
                  <div className="conv-row__body">
                    <div className="conv-row__title">{t.title}</div>
                  </div>
                  <IconButton
                    name="more"
                    label="Conversation options"
                    size={18}
                    className="conv-row__menu"
                    onClick={(e) => openMenu(e, t)}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      ))}

      {menu && <Menu x={menu.x} y={menu.y} items={menuItems(menu.thread)} onClose={() => setMenu(null)} />}
      {renameTarget && (
        <PromptDialog
          title="Rename conversation"
          initialValue={renameTarget.title}
          placeholder="Conversation name"
          confirmLabel="Save"
          icon="pen-square"
          onSubmit={async (title) => {
            await repo.updateThread(renameTarget.id, { title });
            bump();
          }}
          onClose={() => setRenameTarget(null)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete conversation?"
          message={`“${confirmDelete.title}” — including its messages and any uploaded or generated files — will be permanently deleted from your devices and the cloud. This can’t be undone.`}
          confirmLabel="Delete"
          icon="trash"
          danger
          onConfirm={async () => {
            await repo.deleteThread(confirmDelete.id);
            bump();
            pushToast('Conversation deleted');
            if (confirmDelete.id === activeId) navigate('/new');
          }}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
