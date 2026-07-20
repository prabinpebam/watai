import { useEffect, useState } from 'react';

interface LibraryImageProps {
  src: string;
  previewSrc?: string;
  alt: string;
  className?: string;
  loading?: 'eager' | 'lazy';
}

/** Keeps progressive network paint blurred, then reveals the decoded image in one smooth step. */
export function LibraryImage({ src, previewSrc, alt, className = '', loading = 'lazy' }: LibraryImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const preview = previewSrc ?? src;
  const separatePreview = preview !== src;

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  const reveal = async (image: HTMLImageElement) => {
    try {
      await image.decode?.();
    } catch {
      // onLoad already proves the resource is available; decode can reject on older engines.
    }
    setLoaded(true);
  };

  return (
    <span className={`library-image ${loaded ? 'is-loaded' : ''} ${failed ? 'is-failed' : ''} ${className}`.trim()}>
      <span className="library-image__shimmer skeleton" aria-hidden="true" />
      {separatePreview && (
        <img className="library-image__preview" src={preview} alt="" aria-hidden="true" loading={loading} />
      )}
      <img
        className="library-image__full"
        src={src}
        alt={alt}
        loading={loading}
        onLoad={(event) => void reveal(event.currentTarget)}
        onError={() => setFailed(true)}
      />
    </span>
  );
}
