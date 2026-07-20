import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { LibraryItemDTO, LibraryListQuery } from '../../data/cloud/types';
import { Button, IconButton, InlineAlert } from '../../design/ui';
import { Icon } from '../../design/icons';
import { saveFile } from '../../lib/saveFile';
import { Markdown } from '../chat/Markdown';
import { LIBRARY_COPY } from './content';
import { formatBytes, formatDate, iconForKind, itemTitle, kindLabel, originLabel } from './format';
import { useLibraryRuntime } from './LibraryApi';
import { useUi } from '../../state/store';
import { newId } from '../../lib/ids';
import { canUseLibraryItem } from './LibraryPicker';
import { useIsExpanded } from '../../lib/hooks';
import './library.css';
import { LibraryImage } from './LibraryImage';

function useTextPreview(item: LibraryItemDTO | null): { text?: string; error?: boolean; loading: boolean } {
  const [state, setState] = useState<{ text?: string; error?: boolean; loading: boolean }>({ loading: false });
  useEffect(() => {
    if (!item?.url || !['text', 'code', 'data'].includes(item.kind)) {
      setState({ loading: false });
      return;
    }
    const controller = new AbortController();
    setState({ loading: true });
    fetch(item.url, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('preview');
      const text = await response.text();
      setState({ text: text.slice(0, 500_000), loading: false });
    }).catch((error) => {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setState({ loading: false, error: true });
    });
    return () => controller.abort();
  }, [item]);
  return state;
}

function CsvPreview({ text }: { text: string }) {
  const rows = text.split(/\r?\n/).filter(Boolean).slice(0, 200).map((line) => line.split(',').slice(0, 50));
  if (!rows.length) return <p className="library-preview__empty">This file has no previewable rows.</p>;
  return (
    <div className="library-csv" tabIndex={0}>
      <table>
        <thead><tr>{rows[0].map((cell, index) => <th key={index} title={cell}>{cell}</th>)}</tr></thead>
        <tbody>{rows.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} title={cell}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function TextPreview({ item }: { item: LibraryItemDTO }) {
  const preview = useTextPreview(item);
  const [wrap, setWrap] = useState(true);
  if (preview.loading) return <div className="library-preview__loading" role="status" aria-label="Loading preview"><span className="library-preview-skeleton skeleton" /></div>;
  if (preview.error || preview.text === undefined) return <InlineAlert tone="warning">Preview couldn’t be loaded. The original file is still available to download.</InlineAlert>;
  if (item.mime === 'text/csv') return <CsvPreview text={preview.text} />;
  if (/markdown/.test(item.mime) || /\.(md|markdown)$/i.test(item.name)) return <div className="library-markdown"><Markdown content={preview.text} /></div>;
  let value = preview.text;
  if (item.mime === 'application/json') {
    try { value = JSON.stringify(JSON.parse(value), null, 2); } catch { /* show original invalid JSON safely */ }
  }
  return (
    <div className="library-source">
      <div className="library-source__bar">
        <Button size="sm" variant="ghost" icon="copy" onClick={() => navigator.clipboard.writeText(value)}>Copy</Button>
        <Button size="sm" variant="ghost" icon="wrap" onClick={() => setWrap((current) => !current)}>{wrap ? 'No wrap' : 'Wrap'}</Button>
      </div>
      <pre className={wrap ? 'is-wrapped' : ''}>{value}</pre>
    </div>
  );
}

function Preview({ item }: { item: LibraryItemDTO }) {
  if (item.state === 'purged' || item.state === 'missing') {
    return <div className="library-preview__unsupported"><Icon name="error" size={42} /><h2>{item.state === 'purged' ? 'Permanently deleted' : 'File missing'}</h2></div>;
  }
  if (item.kind === 'image' && item.url) return <div className="library-image-stage"><LibraryImage src={item.url} previewSrc={item.thumbnailUrl} alt={itemTitle(item)} loading="eager" /></div>;
  if (item.kind === 'pdf' && item.url) return <iframe className="library-pdf" src={`${item.url}#toolbar=1&navpanes=0`} title={`Preview ${itemTitle(item)}`} sandbox="allow-same-origin" />;
  if (item.kind === 'audio' && item.url) return <div className="library-audio"><Icon name="file-audio" size={48} /><audio src={item.url} controls /></div>;
  if (['text', 'code', 'data'].includes(item.kind)) return <TextPreview item={item} />;
  return (
    <div className="library-preview__unsupported">
      <Icon name={iconForKind(item.kind)} size={56} />
      <h2>{itemTitle(item)}</h2>
      <p>{LIBRARY_COPY.noPreview}</p>
    </div>
  );
}

export function LibraryDetail() {
  const { api, basePath, newChatPath } = useLibraryRuntime();
  const expanded = useIsExpanded();
  const { itemId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [item, setItem] = useState<LibraryItemDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [references, setReferences] = useState<LibraryItemDTO[]>([]);
  const [derived, setDerived] = useState<LibraryItemDTO[]>([]);
  const [imageItems, setImageItems] = useState<LibraryItemDTO[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stageLibraryItems = useUi((state) => state.stageLibraryItems);
  const state = location.state as { backTo?: string; focusId?: string; imageQuery?: LibraryListQuery } | null;
  const backTo = state?.backTo ?? basePath;

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError(false);
    api.getLibraryItem(itemId).then((result) => {
      if (live) setItem(result);
    }).catch(() => {
      if (live) setError(true);
    }).finally(() => {
      if (live) setLoading(false);
    });
    return () => { live = false; };
  }, [api, itemId]);

  useEffect(() => {
    let live = true;
    if (!item) return () => { live = false; };
    Promise.all([
      api.getLibraryLineage(item.id, 'references').catch(() => ({ items: [] })),
      api.getLibraryLineage(item.id, 'derived').catch(() => ({ items: [] })),
    ]).then(([forward, reverse]) => {
      if (!live) return;
      setReferences(forward.items);
      setDerived(reverse.items);
    });
    return () => { live = false; };
  }, [api, item]);

  useEffect(() => {
    let live = true;
    if (item?.kind !== 'image') {
      setImageItems([]);
      return () => { live = false; };
    }
    api.listLibrary(state?.imageQuery ?? { kind: ['image'], state: 'active', sort: 'newest', limit: 100 })
      .then((result) => {
        if (!live) return;
        const unique = new Map(result.items.filter((candidate) => candidate.kind === 'image').map((candidate) => [candidate.id, candidate]));
        unique.set(item.id, item);
        setImageItems([...unique.values()]);
      })
      .catch(() => { if (live) setImageItems([item]); });
    return () => { live = false; };
  }, [api, item, state?.imageQuery]);

  useEffect(() => {
    if (item) headingRef.current?.focus();
  }, [item]);

  const goBack = () => navigate(backTo, { replace: false, state: state?.focusId ? { restoreFocusId: state.focusId } : undefined });
  const download = async () => {
    if (!item?.url) return;
    setDownloading(true);
    try { await saveFile(item.url, item.name); } finally { setDownloading(false); }
  };
  const useInNewChat = () => {
    if (!canUseLibraryItem(item!)) return;
    const threadId = newId();
    stageLibraryItems(threadId, [{ item: item!, mode: 'attach' }]);
    navigate(newChatPath(threadId));
  };
  const imageIndex = item?.kind === 'image' ? imageItems.findIndex((candidate) => candidate.id === item.id) : -1;
  const openImage = (target: LibraryItemDTO) => navigate(`${basePath}/${encodeURIComponent(target.id)}`, {
    replace: true,
    state: { ...state, backTo, focusId: target.id },
  });
  const previousImage = imageIndex > 0 ? imageItems[imageIndex - 1] : undefined;
  const nextImage = imageIndex >= 0 && imageIndex < imageItems.length - 1 ? imageItems[imageIndex + 1] : undefined;

  useEffect(() => {
    if (item?.kind !== 'image') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === 'ArrowLeft' && previousImage) {
        event.preventDefault();
        openImage(previousImage);
      } else if (event.key === 'ArrowRight' && nextImage) {
        event.preventDefault();
        openImage(nextImage);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (loading) return <section className="library-detail"><div className="library-detail-skeleton" role="status" aria-label="Loading item"><div className="library-detail-skeleton__bar skeleton" /><div className="library-detail-skeleton__layout"><div className="library-detail-skeleton__preview skeleton" /><div className="library-detail-skeleton__meta">{Array.from({ length: 5 }, (_, index) => <span key={index} className="skeleton" />)}</div></div></div></section>;
  if (error || !item) return (
    <section className="library-detail">
      <div className="library-detail__bar"><Button variant="ghost" icon="chevron-left" onClick={goBack}>Back</Button></div>
      <div className="library-state"><Icon name="alert" size={28} /><h1>We couldn’t open this item</h1><Button onClick={goBack}>Back to Library</Button></div>
    </section>
  );

  return (
    <section className="library-detail" aria-labelledby="library-detail-title">
      <div className="library-detail__bar">
        <Button variant="ghost" icon="chevron-left" onClick={goBack}>Back</Button>
        <h1 id="library-detail-title" ref={headingRef} tabIndex={-1}>{kindLabel(item.kind)}</h1>
        <div className="library-detail__actions">
          {canUseLibraryItem(item) && (expanded
            ? <Button variant="outline" icon="chat" onClick={useInNewChat}>Use in new chat</Button>
            : <IconButton name="chat" label="Use in new chat" onClick={useInNewChat} />)}
          {expanded
            ? <Button variant="primary" icon="download" loading={downloading} disabled={!item.url} onClick={download}>{LIBRARY_COPY.download}</Button>
            : <IconButton name="download" label={downloading ? 'Downloading' : LIBRARY_COPY.download} variant="accent" disabled={!item.url || downloading} onClick={download} />}
        </div>
      </div>
      <div className="library-detail__scroll">
        <div className="library-detail__layout">
          <main className="library-detail__preview">
            <Preview item={item} />
            {item.kind === 'image' && imageItems.length > 0 && (
              <nav className="library-filmstrip" aria-label="Image navigation">
                <IconButton name="chevron-left" label="Previous image" disabled={!previousImage} onClick={() => previousImage && openImage(previousImage)} />
                <div className="library-filmstrip__track" role="list" aria-label="Images in current filter">
                  {imageItems.map((image) => (
                    <span key={image.id} role="listitem">
                      <button
                        type="button"
                        className={`library-filmstrip__item ${image.id === item.id ? 'is-active' : ''}`}
                        aria-label={itemTitle(image)}
                        aria-current={image.id === item.id ? 'true' : undefined}
                        onClick={() => openImage(image)}
                      >
                        {image.thumbnailUrl || image.url ? <LibraryImage src={image.url ?? image.thumbnailUrl!} previewSrc={image.thumbnailUrl} alt="" /> : <Icon name="file-image" size={20} />}
                      </button>
                    </span>
                  ))}
                </div>
                <IconButton name="chevron-right" label="Next image" disabled={!nextImage} onClick={() => nextImage && openImage(nextImage)} />
              </nav>
            )}
          </main>
          <aside className="library-detail__meta" aria-label="Item details">
            <section>
              <h2>Details</h2>
              <dl>
                <div><dt>Type</dt><dd>{kindLabel(item.kind)}</dd></div>
                <div><dt>Name</dt><dd>{itemTitle(item)}</dd></div>
                <div><dt>Size</dt><dd>{formatBytes(item.bytes)}</dd></div>
                <div><dt>Format</dt><dd>{item.mime}</dd></div>
                <div><dt>Created</dt><dd>{formatDate(item.createdAt)}</dd></div>
                {item.image?.size && <div><dt>Dimensions</dt><dd>{item.image.size}</dd></div>}
                {item.image?.model && <div><dt>Model</dt><dd>{item.image.model}</dd></div>}
              </dl>
            </section>
            {item.image?.prompt && (
              <section>
                <div className="library-detail__section-heading"><h2>{LIBRARY_COPY.originalPrompt}</h2><Button variant="ghost" size="sm" icon="copy" onClick={() => navigator.clipboard.writeText(item.image!.prompt!)}>Copy</Button></div>
                <p className="library-detail__prompt">{item.image.prompt}</p>
                {!item.image.provenanceComplete && <InlineAlert>{LIBRARY_COPY.referenceUnavailable}</InlineAlert>}
              </section>
            )}
            <section>
              <h2>Source</h2>
              <p className="library-origin"><Icon name={item.source.surface === 'chat' ? 'chat' : item.source.surface === 'image_studio' ? 'images' : 'library'} size={18} />{originLabel(item.origin)}</p>
              {item.source.threadTitleSnapshot && <p>{item.source.threadTitleSnapshot}</p>}
              {item.source.threadId && <Button variant="outline" icon="chat" onClick={() => navigate(`/c/${encodeURIComponent(item.source.threadId!)}`)}>{LIBRARY_COPY.showInChat}</Button>}
            </section>
            {(references.length > 0 || derived.length > 0) && (
              <section className="library-lineage">
                <h2>Lineage</h2>
                {references.length > 0 && <h3>References</h3>}
                {references.map((reference) => (
                  <button key={reference.id} type="button" onClick={() => navigate(`${basePath}/${encodeURIComponent(reference.id)}`, { state: { backTo: location.pathname } })}>
                    <Icon name={iconForKind(reference.kind)} size={18} /><span>{itemTitle(reference)}</span><Icon name="chevron-right" size={16} />
                  </button>
                ))}
                {derived.length > 0 && <h3>Derived outputs</h3>}
                {derived.map((output) => (
                  <button key={output.id} type="button" onClick={() => navigate(`${basePath}/${encodeURIComponent(output.id)}`, { state: { backTo: location.pathname } })}>
                    <Icon name={iconForKind(output.kind)} size={18} /><span>{itemTitle(output)}</span><Icon name="chevron-right" size={16} />
                  </button>
                ))}
              </section>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
