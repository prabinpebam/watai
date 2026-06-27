import { useEffect } from 'react';
import { IconButton, Button } from '../../../design/ui';
import { Icon } from '../../../design/icons';
import { useUi } from '../../../state/store';
import { useImageStudio } from '../imageStudioStore';
import { downloadImage } from './download';

const SIZE_LABEL: Record<string, string> = {
  '1024x1024': 'Square · 1024×1024',
  '1024x1536': 'Portrait · 1024×1536',
  '1536x1024': 'Landscape · 1536×1024',
};

export function Lightbox() {
  const pushToast = useUi((s) => s.pushToast);
  const images = useImageStudio((s) => s.images);
  const lightboxId = useImageStudio((s) => s.lightboxId);
  const close = useImageStudio((s) => s.closeLightbox);
  const step = useImageStudio((s) => s.stepLightbox);
  const open = useImageStudio((s) => s.openLightbox);
  const startRemix = useImageStudio((s) => s.startRemix);
  const generateVariation = useImageStudio((s) => s.generateVariation);
  const remove = useImageStudio((s) => s.remove);

  const img = images.find((i) => i.id === lightboxId) ?? null;

  useEffect(() => {
    if (!img) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [img, close, step]);

  if (!img) return null;

  const source = img.sourceImageId ? images.find((i) => i.id === img.sourceImageId) : undefined;

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(img.prompt);
      pushToast('Prompt copied', 'success');
    } catch {
      pushToast('Could not copy', 'error');
    }
  };

  const onVariations = async () => {
    const res = await generateVariation(img);
    pushToast(res.ok ? 'Generating a variation…' : res.error ?? 'Could not start', res.ok ? 'success' : 'error');
  };

  return (
    <div className="viewer studio-lightbox" role="dialog" aria-label="Image viewer" aria-modal="true">
      <div className="viewer__bar">
        <IconButton name="close" label="Close" onClick={close} />
        <span className="grow" />
        <IconButton name="chevron-left" label="Previous" onClick={() => step(-1)} />
        <IconButton name="chevron-right" label="Next" onClick={() => step(1)} />
      </div>

      <div className="studio-lightbox__body">
        <div className="viewer__stage">{img.url && <img src={img.url} alt={img.prompt} />}</div>

        <aside className="studio-lightbox__meta">
          <div className="studio-lightbox__actions">
            <Button variant="secondary" icon="remix" onClick={() => startRemix(img)}>
              Remix
            </Button>
            <Button variant="secondary" icon="image" onClick={() => void onVariations()}>
              Variations
            </Button>
            <Button variant="secondary" icon="download" onClick={() => void downloadImage(img)}>
              Download
            </Button>
            <Button variant="ghost" icon="trash" onClick={() => void remove(img.id)}>
              Delete
            </Button>
          </div>

          <section className="studio-lightbox__section">
            <div className="studio-lightbox__section-head">
              <span className="studio-lightbox__label">Prompt</span>
              <button className="studio-lightbox__copy" onClick={() => void copyPrompt()} title="Copy prompt">
                <Icon name="copy" size={15} /> Copy
              </button>
            </div>
            <p className="studio-lightbox__prompt">{img.prompt}</p>
          </section>

          {img.revisedPrompt && img.revisedPrompt !== img.prompt && (
            <section className="studio-lightbox__section">
              <span className="studio-lightbox__label">Model interpretation</span>
              <p className="studio-lightbox__prompt studio-lightbox__prompt--muted">{img.revisedPrompt}</p>
            </section>
          )}

          <section className="studio-lightbox__section studio-lightbox__facts">
            <div>
              <span className="studio-lightbox__label">Size</span>
              <span>{SIZE_LABEL[img.size] ?? img.size}</span>
            </div>
            {img.quality && (
              <div>
                <span className="studio-lightbox__label">Quality</span>
                <span style={{ textTransform: 'capitalize' }}>{img.quality}</span>
              </div>
            )}
            <div>
              <span className="studio-lightbox__label">Model</span>
              <span>{img.model}</span>
            </div>
            <div>
              <span className="studio-lightbox__label">Created</span>
              <span>{new Date(img.createdAt).toLocaleString()}</span>
            </div>
          </section>

          {img.sourceImageId && (
            <section className="studio-lightbox__section">
              <span className="studio-lightbox__label">Remixed from</span>
              {source?.url ? (
                <button className="studio-lightbox__lineage" onClick={() => open(source.id)} title="Open source image">
                  <img src={source.url} alt={source.prompt} />
                  <span>{source.prompt}</span>
                </button>
              ) : (
                <p className="studio-lightbox__prompt studio-lightbox__prompt--muted">The source image is no longer available.</p>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
