import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../../design/ui';
import type { ImageRef } from '../../lib/types';

export interface GalleryImage {
  image: ImageRef;
  url: string;
}

export function ImagePrompt({ text, compact = false }: { text: string; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      className={`image-prompt ${compact ? 'image-prompt--compact' : ''} ${expanded ? 'image-prompt--expanded' : ''}`}
      aria-expanded={expanded}
      onClick={() => setExpanded((value) => !value)}
      title={expanded ? 'Collapse prompt' : 'Expand prompt'}
    >
      <span>{text}</span>
    </button>
  );
}

interface LightboxProps {
  src: string;
  alt?: string;
  prompt?: string;
  onClose: () => void;
  onDownload?: () => void;
  images?: GalleryImage[];
  currentIndex?: number;
  onSelect?: (image: GalleryImage) => void;
}

/** Full-screen image viewer. Reuses the `.viewer` chrome from components.css. */
export function Lightbox({ src, alt, prompt, onClose, onDownload, images = [], currentIndex = 0, onSelect }: LightboxProps) {
  const hasGallery = images.length > 1 && !!onSelect;
  const previous = hasGallery ? images[(currentIndex - 1 + images.length) % images.length] : undefined;
  const next = hasGallery ? images[(currentIndex + 1) % images.length] : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && previous) onSelect?.(previous);
      if (e.key === 'ArrowRight' && next) onSelect?.(next);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [next, onClose, onSelect, previous]);

  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label={alt || 'Image'} onClick={onClose}>
      <div className="viewer__bar" onClick={(e) => e.stopPropagation()}>
        <span className="viewer__title">{hasGallery ? `${currentIndex + 1} of ${images.length}` : alt}</span>
        {onDownload && <IconButton name="download" label="Download" onClick={onDownload} />}
        <IconButton name="close" label="Close" onClick={onClose} />
      </div>
      <div className="viewer__stage" onClick={onClose}>
        {previous && (
          <IconButton
            className="viewer__nav viewer__nav--prev"
            name="chevron-left"
            label="Previous image"
            big
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(previous);
            }}
          />
        )}
        <img src={src} alt={alt || ''} onClick={(e) => e.stopPropagation()} />
        {next && (
          <IconButton
            className="viewer__nav viewer__nav--next"
            name="chevron-right"
            label="Next image"
            big
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(next);
            }}
          />
        )}
      </div>
      <div className="viewer__bottom" onClick={(e) => e.stopPropagation()}>
        {prompt && <ImagePrompt text={prompt} />}
        {hasGallery && (
          <div className="viewer__thumbs" aria-label="Images in this thread">
            {images.map((item, index) => (
              <button
                key={item.image.id}
                type="button"
                className={`viewer__thumb ${index === currentIndex ? 'viewer__thumb--active' : ''}`}
                aria-label={`Open image ${index + 1}`}
                aria-current={index === currentIndex ? 'true' : undefined}
                onClick={() => onSelect?.(item)}
              >
                <img src={item.url} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
