import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from '../../design/ui';

interface LightboxProps {
  src: string;
  alt?: string;
  onClose: () => void;
  onDownload?: () => void;
}

/** Full-screen image viewer. Reuses the `.viewer` chrome from components.css. */
export function Lightbox({ src, alt, onClose, onDownload }: LightboxProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return createPortal(
    <div className="viewer" role="dialog" aria-modal="true" aria-label={alt || 'Image'} onClick={onClose}>
      <div className="viewer__bar" onClick={(e) => e.stopPropagation()}>
        <span className="viewer__title">{alt}</span>
        {onDownload && <IconButton name="download" label="Download" onClick={onDownload} />}
        <IconButton name="close" label="Close" onClick={onClose} />
      </div>
      <div className="viewer__stage" onClick={onClose}>
        <img src={src} alt={alt || ''} onClick={(e) => e.stopPropagation()} />
      </div>
    </div>,
    document.body,
  );
}
