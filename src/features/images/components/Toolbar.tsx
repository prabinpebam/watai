import { useEffect, useRef, useState } from 'react';
import { Segmented } from '../../../design/ui';
import { Icon } from '../../../design/icons';
import { useImageStudio, type SizeFilter, type SortOrder } from '../imageStudioStore';

const SIZE_FILTERS: { value: SizeFilter; label: string }[] = [
  { value: '', label: 'All' },
  { value: '1024x1024', label: 'Square' },
  { value: '1024x1536', label: 'Portrait' },
  { value: '1536x1024', label: 'Landscape' },
];
const SORTS: { value: SortOrder; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
];

export function Toolbar() {
  const query = useImageStudio((s) => s.query);
  const sizeFilter = useImageStudio((s) => s.sizeFilter);
  const sort = useImageStudio((s) => s.sort);
  const setQuery = useImageStudio((s) => s.setQuery);
  const setSizeFilter = useImageStudio((s) => s.setSizeFilter);
  const setSort = useImageStudio((s) => s.setSort);

  const [local, setLocal] = useState(query);
  const mounted = useRef(false);

  // Debounce the text input into the store (which re-queries the server).
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const t = setTimeout(() => setQuery(local), 300);
    return () => clearTimeout(t);
  }, [local, setQuery]);

  return (
    <div className="studio-toolbar">
      <div className="studio-search">
        <Icon name="search" size={18} className="studio-search__icon" />
        <input
          className="studio-search__input"
          value={local}
          placeholder="Search prompts…"
          onChange={(e) => setLocal(e.target.value)}
          aria-label="Search image prompts"
        />
        {local && (
          <button className="studio-search__clear" onClick={() => setLocal('')} aria-label="Clear search">
            <Icon name="close" size={16} />
          </button>
        )}
      </div>
      <Segmented value={sizeFilter} onChange={setSizeFilter} options={SIZE_FILTERS} />
      <Segmented value={sort} onChange={setSort} options={SORTS} />
    </div>
  );
}
