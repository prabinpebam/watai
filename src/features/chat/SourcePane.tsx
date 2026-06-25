import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useUi } from '../../state/store';
import { useIsExpanded } from '../../lib/hooks';
import { IconButton } from '../../design/ui';
import { Icon } from '../../design/icons';

function domainOf(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Right-docked (desktop) / slide-over (compact) panel showing the raw web-search results behind
 *  a message's citations. Opened by clicking a source chip; dismissed by the user. */
export function SourcePane() {
  const pane = useUi((s) => s.sourcePane);
  const close = useUi((s) => s.closeSourcePane);
  const expanded = useIsExpanded();
  const activeRef = useRef<HTMLElement>(null);

  // Bring the clicked source into view when the pane opens or the active index changes.
  useEffect(() => {
    if (pane) activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [pane]);

  // Escape closes the slide-over.
  useEffect(() => {
    if (!pane) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pane, close]);

  if (!pane) return null;
  const sources = pane.citations.filter((c) => c.url || c.content || c.title || c.filename);

  const aside = (
    <aside className={`source-pane ${expanded ? '' : 'source-pane--overlay'}`} aria-label="Sources">
      <header className="source-pane__head">
        <Icon name="globe" size={16} />
        <span className="source-pane__title">Sources</span>
        <span className="source-pane__count">{sources.length}</span>
        <IconButton name="close" label="Close sources" onClick={close} />
      </header>
      <div className="source-pane__list">
        {sources.length === 0 && (
          <p className="muted source-pane__empty">No source details were saved for this answer.</p>
        )}
        {sources.map((c, i) => {
          const active = i === pane.index;
          return (
            <article
              key={i}
              ref={active ? activeRef : undefined}
              className={`source-item ${active ? 'source-item--active' : ''}`}
            >
              <div className="source-item__head">
                <span className="source-item__num">{i + 1}</span>
                {c.favicon ? (
                  <img className="source-item__favicon" src={c.favicon} alt="" width={16} height={16} />
                ) : (
                  <Icon name={c.url ? 'globe' : 'paperclip'} size={14} />
                )}
                <span className="source-item__title">{c.title || c.filename || domainOf(c.url)}</span>
              </div>
              {c.url && <div className="source-item__domain">{domainOf(c.url)}</div>}
              {c.content && <p className="source-item__content">{c.content}</p>}
              {c.url && (
                <a
                  className="btn btn--outline source-item__open"
                  href={c.url}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  <Icon name="external" size={14} />
                  Open page
                </a>
              )}
            </article>
          );
        })}
      </div>
    </aside>
  );

  if (expanded) return aside;
  return createPortal(
    <>
      <div className="drawer-scrim" onClick={close} />
      {aside}
    </>,
    document.body,
  );
}
