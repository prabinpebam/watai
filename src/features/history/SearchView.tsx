import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { repo } from '../../data';
import type { SearchHit } from '../../data/repository';
import { Icon } from '../../design/icons';
import { Button, IconButton, InlineAlert } from '../../design/ui';

function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function SearchView({ onClose }: { onClose?: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [retry, setRetry] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      setStatus('idle');
      return;
    }
    let live = true;
    setHits([]);
    setStatus('loading');
    const id = setTimeout(() => {
      repo.search(query).then(
        (nextHits) => {
          if (!live) return;
          setHits(nextHits);
          setStatus('success');
        },
        () => {
          if (live) setStatus('error');
        },
      );
    }, 180);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [query, retry]);

  return (
    <div className="page">
      <div className="page__inner" style={{ paddingTop: 'var(--space-5)' }}>
        <div className="row" style={{ marginBottom: 'var(--space-5)' }}>
          <div className="search-bar grow">
            <Icon name="search" size={20} className="muted" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              aria-label="Search conversations"
            />
            {query && <IconButton name="x" label="Clear" size={16} onClick={() => setQuery('')} />}
          </div>
          {onClose && <IconButton name="close" label="Close search" onClick={onClose} />}
        </div>

        {status === 'loading' && <p className="muted" role="status">Searching…</p>}
        {status === 'error' && (
          <div className="col" style={{ alignItems: 'flex-start' }}>
            <InlineAlert tone="danger">Could not search conversations.</InlineAlert>
            <Button variant="secondary" onClick={() => setRetry((value) => value + 1)}>Retry search</Button>
          </div>
        )}
        {status === 'success' && hits.length === 0 && <p className="muted">No matches for "{query}".</p>}

        <div className="col" style={{ gap: 'var(--space-1)' }}>
          {hits.map((h) => (
            <button
              key={h.thread.id + h.messageId}
              className="search-result"
              onClick={() => {
                const target = h.messageId ? `#message-${encodeURIComponent(h.messageId)}` : '';
                navigate(`/c/${h.thread.id}${target}`);
                onClose?.();
              }}
            >
              <div className="text-strong" style={{ marginBottom: 'var(--space-1)' }}>{highlight(h.thread.title, query)}</div>
              <div className="muted" style={{ fontSize: 'var(--text-caption-size)' }}>
                {highlight(h.snippet, query)}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
