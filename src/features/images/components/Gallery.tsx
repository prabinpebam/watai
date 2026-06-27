import { Spinner } from '../../../design/ui';
import { Icon } from '../../../design/icons';
import { useImageStudio } from '../imageStudioStore';
import { ImageCard } from './ImageCard';

const EXAMPLES = [
  'A photograph of a red fox in an autumn forest at golden hour',
  'Minimal line-art logo of a paper crane, black on white',
  'Isometric 3D illustration of a cozy reading nook with plants',
];

export function Gallery() {
  const images = useImageStudio((s) => s.images);
  const loading = useImageStudio((s) => s.loading);
  const cursor = useImageStudio((s) => s.cursor);
  const loadingMore = useImageStudio((s) => s.loadingMore);
  const query = useImageStudio((s) => s.query);
  const loadMore = useImageStudio((s) => s.loadMore);
  const setPrompt = useImageStudio((s) => s.setPrompt);

  if (loading && images.length === 0) {
    return (
      <div className="studio-empty">
        <Spinner size="lg" />
      </div>
    );
  }

  if (images.length === 0) {
    if (query.trim()) {
      return (
        <div className="studio-empty">
          <Icon name="search" size={40} className="studio-empty__icon" />
          <p className="studio-empty__hint">{`No images match "${query.trim()}".`}</p>
        </div>
      );
    }
    return (
      <div className="studio-empty">
        <Icon name="add-image" size={44} className="studio-empty__icon" />
        <h2 className="studio-empty__title">Create your first image</h2>
        <p className="studio-empty__hint">Describe anything above — or start from an example:</p>
        <div className="studio-empty__examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="studio-empty__example" onClick={() => setPrompt(ex)}>
              {ex}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="studio-grid">
        {images.map((img) => (
          <ImageCard key={img.id} img={img} />
        ))}
      </div>
      {cursor && (
        <div className="studio-loadmore">
          <button className="btn btn--secondary" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </>
  );
}
