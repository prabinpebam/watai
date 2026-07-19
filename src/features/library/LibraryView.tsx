import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { LibraryItemDTO, LibraryKind, LibraryListQuery } from '../../data/cloud/types';
import { Button, InlineAlert, SelectMenu, Spinner } from '../../design/ui';
import { Icon } from '../../design/icons';
import { ScreenBar } from '../../app/ScreenBar';
import { LIBRARY_COPY } from './content';
import { formatBytes, formatDate, iconForKind, itemTitle, kindLabel, originLabel } from './format';
import { useLibraryRuntime } from './LibraryApi';
import { uploadToLibrary } from './upload';
import './library.css';

const KIND_FILTERS: Array<{ value: string; label: string; kinds?: LibraryKind[] }> = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images', kinds: ['image'] },
  { value: 'pdf', label: 'PDFs', kinds: ['pdf'] },
  { value: 'document', label: 'Documents', kinds: ['document', 'text', 'code'] },
  { value: 'data', label: 'Data', kinds: ['spreadsheet', 'data'] },
  { value: 'other', label: 'Other', kinds: ['presentation', 'audio', 'archive', 'other'] },
];

function queryFromParams(params: URLSearchParams, cursor?: string): LibraryListQuery {
  const filter = KIND_FILTERS.find((option) => option.value === (params.get('kind') ?? 'all')) ?? KIND_FILTERS[0];
  const origin = params.get('origin');
  const sort = params.get('sort');
  const q = params.get('q')?.trim();
  return {
    ...(q ? { q } : {}),
    ...(filter.kinds ? { kind: filter.kinds } : {}),
    ...(origin === 'uploaded' || origin === 'generated' ? { origin } : {}),
    ...(sort === 'oldest' || sort === 'largest' || sort === 'name' ? { sort } : { sort: 'newest' }),
    ...(cursor ? { cursor } : {}),
    limit: 50,
  };
}

function LibraryRow({ item, onOpen }: { item: LibraryItemDTO; onOpen: () => void }) {
  return (
    <button className="library-row" type="button" onClick={onOpen} data-library-item-id={item.id}>
      <span className="library-row__visual">
        {item.kind === 'image' && (item.thumbnailUrl || item.url) ? (
          <img src={item.thumbnailUrl ?? item.url} alt="" loading="lazy" />
        ) : (
          <Icon name={iconForKind(item.kind)} size={22} />
        )}
      </span>
      <span className="library-row__body">
        <span className="library-row__title">{itemTitle(item)}</span>
        <span className="library-row__meta">
          {originLabel(item.origin)} · {kindLabel(item.kind)}
          {item.source.threadTitleSnapshot ? ` · ${item.source.threadTitleSnapshot}` : ''}
        </span>
      </span>
      <time className="library-row__date" dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
      <span className="library-row__size">{formatBytes(item.bytes)}</span>
      <Icon name="chevron-right" size={18} className="library-row__chevron" />
    </button>
  );
}

function ImageTile({ item, onOpen }: { item: LibraryItemDTO; onOpen: () => void }) {
  const src = item.thumbnailUrl ?? item.url;
  return (
    <button className="library-tile" type="button" onClick={onOpen} data-library-item-id={item.id}>
      {src ? (
        <img src={src} alt={itemTitle(item)} loading="lazy" />
      ) : (
        <span className="library-tile__missing"><Icon name="file-image" size={32} /> Preview unavailable</span>
      )}
      <span className="library-tile__scrim">
        <span>{item.userMetadata?.title ?? item.image?.prompt ?? item.name}</span>
        <span className="library-tile__badge">{item.origin.includes('generated') ? 'Generated' : 'Uploaded'}</span>
      </span>
    </button>
  );
}

export function LibraryView() {
  const { api, basePath, createImagePath } = useLibraryRuntime();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const deferredSearch = useDeferredValue(search);
  const [items, setItems] = useState<LibraryItemDTO[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [total, setTotal] = useState<number>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [error, setError] = useState(false);
  const [requestVersion, setRequestVersion] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Array<{ id: string; name: string; progress: number; error?: string }>>([]);
  const kind = params.get('kind') ?? 'all';
  const origin = params.get('origin') ?? 'all';
  const sort = params.get('sort') ?? 'newest';
  const imageMode = kind === 'image';

  const updateParam = (name: string, value: string, defaultValue: string) => {
    const next = new URLSearchParams(params);
    if (value === defaultValue || !value) next.delete(name);
    else next.set(name, value);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if ((params.get('q') ?? '') === deferredSearch.trim()) return;
      const next = new URLSearchParams(params);
      if (deferredSearch.trim()) next.set('q', deferredSearch.trim());
      else next.delete('q');
      startTransition(() => setParams(next, { replace: true }));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [deferredSearch, params, setParams]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && document.activeElement !== searchRef.current) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(false);
    api.listLibrary(queryFromParams(params)).then((result) => {
      if (!live) return;
      setItems(result.items);
      setCursor(result.cursor);
      setTotal(result.totalApprox);
    }).catch(() => {
      if (live) setError(true);
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => { live = false; };
  }, [api, params, requestVersion]);

  useEffect(() => {
    const focusId = (location.state as { restoreFocusId?: string } | null)?.restoreFocusId;
    if (!loading && focusId) {
      document.querySelector<HTMLElement>(`[data-library-item-id="${CSS.escape(focusId)}"]`)?.focus();
      window.history.replaceState({}, document.title);
    }
  }, [items, loading, location.state]);

  const clearFilters = () => {
    setSearch('');
    setParams({}, { replace: true });
  };

  const open = (item: LibraryItemDTO) => navigate(`${basePath}/${encodeURIComponent(item.id)}`, {
    state: { backTo: `${location.pathname}${location.search}`, focusId: item.id },
  });

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(false);
    try {
      const result = await api.listLibrary(queryFromParams(params, cursor));
      setItems((current) => [...current, ...result.items.filter((item) => !current.some((known) => known.id === item.id))]);
      setCursor(result.cursor);
      setTotal(result.totalApprox ?? total);
    } catch {
      setLoadMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  };

  const uploadFiles = async (list: FileList) => {
    const files = [...list].slice(0, 20);
    if (files.reduce((sum, file) => sum + file.size, 0) > 100 * 1024 * 1024) {
      setUploads([{ id: 'batch-error', name: 'Upload selection', progress: 0, error: 'Select 100 MB or less at a time.' }]);
      return;
    }
    const queued = files.map((file, index) => ({ id: `${Date.now()}-${index}`, name: file.name, progress: 0 }));
    setUploads(queued);
    for (let index = 0; index < files.length; index++) {
      const row = queued[index];
      try {
        await uploadToLibrary(files[index], (progress) => setUploads((current) => current.map((entry) => entry.id === row.id ? { ...entry, progress } : entry)), api);
      } catch (error) {
        setUploads((current) => current.map((entry) => entry.id === row.id ? { ...entry, error: error instanceof Error ? error.message : 'Upload failed.' } : entry));
      }
    }
    setRequestVersion((version) => version + 1);
  };

  const filtered = ['q', 'kind', 'origin', 'sort'].some((name) => params.has(name));
  return (
    <section className="library" aria-labelledby="library-heading">
      <ScreenBar title={LIBRARY_COPY.title} trailing={<><Button size="sm" icon="upload" onClick={() => uploadRef.current?.click()}>Upload</Button>{imageMode && <Button size="sm" icon="images" onClick={() => navigate(createImagePath)}>Create image</Button>}<input ref={uploadRef} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,.md,.docx,.pptx,text/csv,application/json,.xlsx,audio/webm,audio/mpeg,.mp3,application/zip" onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); event.target.value = ''; }} /></>} />
      <h1 id="library-heading" ref={headingRef} tabIndex={-1} className="sr-only">{LIBRARY_COPY.title}</h1>
      <div className="library__toolbar">
        <label className="library-search">
          <Icon name="search" size={19} />
          <span className="sr-only">Search Library</span>
          <input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={LIBRARY_COPY.searchPlaceholder} />
          {search && <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><Icon name="close" size={17} /></button>}
        </label>
        <div className="library-kind-tabs" role="tablist" aria-label="File type">
          {KIND_FILTERS.map((option) => (
            <button key={option.value} type="button" role="tab" aria-selected={kind === option.value} onClick={() => updateParam('kind', option.value, 'all')}>
              {option.label}
            </button>
          ))}
        </div>
        <div className="library-filters">
          <SelectMenu value={origin} label="Source" onChange={(value) => updateParam('origin', value, 'all')} options={[
            { value: 'all', label: 'All sources' },
            { value: 'uploaded', label: 'Uploaded' },
            { value: 'generated', label: 'Generated' },
          ]} />
          <SelectMenu value={sort} label="Sort" onChange={(value) => updateParam('sort', value, 'newest')} options={[
            { value: 'newest', label: 'Newest' },
            { value: 'oldest', label: 'Oldest' },
            { value: 'largest', label: 'Largest' },
            { value: 'name', label: 'Name' },
          ]} />
          {filtered && (loading || items.length > 0) && <Button variant="ghost" size="sm" onClick={clearFilters}>{LIBRARY_COPY.clearFilters}</Button>}
        </div>
      </div>

      <div className="library__results" aria-busy={loading}>
        {uploads.length > 0 && (
          <div className="library-uploads" aria-label="Uploads">
            {uploads.map((upload) => <div key={upload.id} className="library-upload-row"><Icon name={upload.error ? 'error' : upload.progress === 100 ? 'check-circle' : 'upload'} size={18} /><span>{upload.name}</span><progress max={100} value={upload.progress} /><span>{upload.error ?? `${upload.progress}%`}</span></div>)}
          </div>
        )}
        <div className="sr-only" aria-live="polite">{total !== undefined ? `${total} Library items` : ''}</div>
        {error && !items.length ? (
          <div className="library-state">
            <Icon name="alert" size={28} />
            <h2>{LIBRARY_COPY.unavailableTitle}</h2>
            <Button onClick={() => setRequestVersion((version) => version + 1)}>{LIBRARY_COPY.retry}</Button>
          </div>
        ) : loading ? (
          <div className="library-loading" role="status"><Spinner size="lg" /><span>Loading Library</span></div>
        ) : !items.length ? (
          <div className="library-state">
            <Icon name={filtered ? 'search' : 'library'} size={30} />
            <h2>{filtered ? LIBRARY_COPY.filteredTitle : LIBRARY_COPY.emptyTitle}</h2>
            <p>{filtered ? LIBRARY_COPY.filteredBody : LIBRARY_COPY.emptyBody}</p>
            {filtered && <Button onClick={clearFilters}>{LIBRARY_COPY.clearFilters}</Button>}
          </div>
        ) : (
          <>
            {error && <InlineAlert tone="warning">Some Library items may be out of date. Try again when your connection is stable.</InlineAlert>}
            {imageMode ? (
              <div className="library-grid">{items.map((item) => <ImageTile key={item.id} item={item} onOpen={() => open(item)} />)}</div>
            ) : (
              <div className="library-list">{items.map((item) => <LibraryRow key={item.id} item={item} onOpen={() => open(item)} />)}</div>
            )}
            {loadMoreError && <InlineAlert tone="warning">More items couldn’t be loaded. Retry to continue.</InlineAlert>}
            {cursor && <div className="library-load-more"><Button variant="outline" loading={loadingMore} onClick={loadMore}>{loadMoreError ? LIBRARY_COPY.retry : 'Load more'}</Button></div>}
          </>
        )}
      </div>
    </section>
  );
}
