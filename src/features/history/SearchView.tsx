import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { repo } from '../../data';
import type { SearchHit } from '../../data/repository';
import { Icon } from '../../design/icons';
import { IconButton } from '../../design/ui';

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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    const id = setTimeout(() => {
      repo.search(query).then((h) => live && setHits(h));
    }, 180);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [query]);

  return (
    <div className="page">
      <div className="page__inner" style={{ paddingTop: 'var(--space-5)' }}>
        <div className="row" style={{ marginBottom: 'var(--space-5)' }}>
          <div className="search-bar grow">
            <Icon name="search" size={18} className="muted" />
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

        {query && hits.length === 0 && <p className="muted">No matches for "{query}".</p>}

        <div className="col" style={{ gap: 'var(--space-1)' }}>
          {hits.map((h) => (
            <button
              key={h.thread.id + h.messageId}
              className="search-result"
              onClick={() => {
                navigate(`/c/${h.thread.id}`);
                onClose?.();
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{highlight(h.thread.title, query)}</div>
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
