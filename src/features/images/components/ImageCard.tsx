import { useRef, useState } from 'react';
import { Icon } from '../../../design/icons';
import { cloudApi } from '../../../data';
import type { StudioImage as ImageRecord } from '../../../data/cloud/types';
import { useImageStudio } from '../imageStudioStore';
import { aspectRatio, downloadImage } from './download';

/** Friendlier copy for the common, user-correctable error codes. */
function errorLabel(img: ImageRecord): string {
  const code = img.error?.code;
  if (code === 'content_filtered') return 'Blocked by the content policy. Try a different prompt.';
  if (code === 'no_image_model') return 'No image model is configured.';
  return img.error?.message ?? 'Generation failed.';
}

export function ImageCard({ img }: { img: ImageRecord }) {
  const openLightbox = useImageStudio((s) => s.openLightbox);
  const startRemix = useImageStudio((s) => s.startRemix);
  const remove = useImageStudio((s) => s.remove);
  const retry = useImageStudio((s) => s.retry);
  const applyServerImage = useImageStudio((s) => s.applyServerImage);
  const recoveredRef = useRef(false);
  const [broken, setBroken] = useState(false);

  const style = { aspectRatio: aspectRatio(img.size) };

  // A 403/expired SAS URL: re-fetch a fresh read URL once.
  const onImgError = async () => {
    if (recoveredRef.current) {
      setBroken(true);
      return;
    }
    recoveredRef.current = true;
    try {
      const fresh = await cloudApi.getImage(img.id);
      applyServerImage(fresh);
    } catch {
      setBroken(true);
    }
  };

  if (img.status === 'ready' && img.url && !broken) {
    return (
      <div className="studio-card studio-card--ready">
        <button className="studio-card__open" onClick={() => openLightbox(img.id)} aria-label="Open image">
          <img src={img.url} alt={img.prompt} loading="lazy" onError={onImgError} style={style} />
        </button>
        <div className="studio-card__overlay">
          <span className="studio-card__prompt" title={img.prompt}>
            {img.prompt}
          </span>
          <div className="studio-card__actions">
            <button className="studio-card__action" onClick={() => startRemix(img)} aria-label="Remix" title="Remix">
              <Icon name="remix" size={18} />
            </button>
            <button className="studio-card__action" onClick={() => void downloadImage(img)} aria-label="Download" title="Download">
              <Icon name="download" size={18} />
            </button>
            <button className="studio-card__action" onClick={() => void remove(img.id)} aria-label="Delete" title="Delete">
              <Icon name="trash" size={18} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (img.status === 'error') {
    return (
      <div className="studio-card studio-card--error" style={style}>
        <Icon name="error" size={22} className="studio-card__error-icon" />
        <p className="studio-card__error-text">{errorLabel(img)}</p>
        <div className="studio-card__error-actions">
          <button className="studio-card__retry" onClick={() => void retry(img)}>
            <Icon name="refresh" size={16} /> Retry
          </button>
          <button className="studio-card__retry" onClick={() => void remove(img.id)}>
            <Icon name="trash" size={16} /> Delete
          </button>
        </div>
      </div>
    );
  }

  // queued | generating | (ready but broken/awaiting url)
  const generating = img.status === 'generating';
  return (
    <div className={`studio-card studio-card--pending${generating ? ' studio-card--shimmer' : ''}`} style={style}>
      <span className="studio-card__status">
        {generating ? <Icon name="sparkle" size={18} /> : <Icon name="image" size={18} />}
        {generating ? 'Generating…' : 'Queued'}
      </span>
      <span className="studio-card__pending-prompt">{img.prompt}</span>
    </div>
  );
}
