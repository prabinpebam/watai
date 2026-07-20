import { useEffect, useState } from 'react';
import type { LibraryItemDTO, LibraryKind } from '../../data/cloud/types';
import { Button, Field } from '../../design/ui';
import { Modal } from '../../design/overlays';
import { Icon } from '../../design/icons';
import { useUi, type StagedLibraryItem } from '../../state/store';
import { formatBytes, iconForKind, itemTitle, kindLabel } from './format';
import './library.css';
import { useLibraryRuntime } from './LibraryApi';

const TABS: Array<{ value: 'recent' | 'images' | 'files'; label: string; kinds?: LibraryKind[] }> = [
  { value: 'recent', label: 'Recent' },
  { value: 'images', label: 'Images', kinds: ['image'] },
  { value: 'files', label: 'Files', kinds: ['pdf', 'document', 'spreadsheet', 'presentation', 'data', 'audio', 'code', 'text', 'other', 'archive'] },
];

export function canUseLibraryItem(item: LibraryItemDTO): boolean {
  return item.state === 'active' && item.kind !== 'archive';
}

export function LibraryPicker({ threadId, onClose, returnFocus }: { threadId: string; onClose: () => void; returnFocus?: () => void }) {
  const [tab, setTab] = useState<'recent' | 'images' | 'files'>('recent');
  const [query, setQuery] = useState('');
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [items, setItems] = useState<LibraryItemDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<Map<string, StagedLibraryItem>>(new Map());
  const stageLibraryItems = useUi((state) => state.stageLibraryItems);
  const { api } = useLibraryRuntime();

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(false);
      const selectedTab = TABS.find((candidate) => candidate.value === tab)!;
      api.listLibrary({ ...(query.trim() ? { q: query.trim() } : {}), ...(selectedTab.kinds ? { kind: selectedTab.kinds } : {}), limit: 50 })
        .then((result) => { if (live) setItems(result.items); })
        .catch(() => { if (live) setError(true); })
        .finally(() => { if (live) setLoading(false); });
    }, 200);
    return () => { live = false; window.clearTimeout(timer); };
  }, [api, query, tab]);

  const close = () => {
    onClose();
    window.setTimeout(() => returnFocus?.(), 0);
  };

  const done = () => {
    stageLibraryItems(threadId, [...selected.values()]);
    close();
  };

  const visible = showUnavailable ? items : items.filter(canUseLibraryItem);
  return (
    <Modal
      title="Add from Library"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" disabled={!selected.size} onClick={done}>Done ({selected.size})</Button>
        </>
      }
    >
      <div className="library-picker">
        <Field autoFocus aria-label="Search Library" placeholder="Search Library" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="library-picker__tabs" role="tablist" aria-label="Library category">
          {TABS.map((option) => <button key={option.value} role="tab" aria-selected={tab === option.value} onClick={() => setTab(option.value)}>{option.label}</button>)}
        </div>
        <label className="library-picker__unavailable"><input type="checkbox" checked={showUnavailable} onChange={(event) => setShowUnavailable(event.target.checked)} /> Show unavailable</label>
        <div className="library-picker__results" aria-busy={loading}>
          {loading ? <div className="library-picker-skeleton" role="status" aria-label="Loading Library">{Array.from({ length: 5 }, (_, index) => <span key={index} className="library-picker-skeleton__row"><span className="skeleton" /><span><i className="skeleton" /><i className="skeleton" /></span></span>)}</div> : error ? <div className="library-picker__state"><Icon name="alert" /><span>Library couldn’t be loaded.</span></div> : !visible.length ? <div className="library-picker__state"><Icon name="search" /><span>No compatible items found.</span></div> : visible.map((item) => {
            const usable = canUseLibraryItem(item);
            const active = selected.has(item.id);
            return (
              <button
                key={item.id}
                type="button"
                className="library-picker__item"
                disabled={!usable}
                aria-pressed={active}
                title={!usable ? 'This item is download-only and cannot be added to chat.' : undefined}
                onClick={() => setSelected((current) => {
                  const next = new Map(current);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.set(item.id, { item, mode: 'attach' });
                  return next;
                })}
              >
                <span className="library-picker__visual">{item.kind === 'image' && (item.thumbnailUrl ?? item.url) ? <img src={item.thumbnailUrl ?? item.url} alt="" /> : <Icon name={iconForKind(item.kind)} />}</span>
                <span className="library-picker__body"><strong>{itemTitle(item)}</strong><span>{kindLabel(item.kind)} · {formatBytes(item.bytes)}{!usable ? ' · Download only' : ''}</span></span>
                <span className="library-picker__check"><Icon name={active ? 'check-circle' : usable ? 'plus' : 'error'} filled={active} /></span>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
