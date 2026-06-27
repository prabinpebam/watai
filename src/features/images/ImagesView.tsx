import { useEffect } from 'react';
import { Composer } from './components/Composer';
import { Toolbar } from './components/Toolbar';
import { Gallery } from './components/Gallery';
import { Lightbox } from './components/Lightbox';
import { useImageStudio, hasPendingImages } from './imageStudioStore';
import './studio.css';

/** Image studio: a server-authoritative workspace to generate, organize, search, and remix
 *  images. Generation runs in a server queue worker, so closing the app never interrupts a job. */
export function ImagesView() {
  const init = useImageStudio((s) => s.init);
  const images = useImageStudio((s) => s.images);
  const pollPending = useImageStudio((s) => s.pollPending);

  useEffect(() => {
    void init();
  }, [init]);

  // Poll fallback while any image is still queued/generating (covers an absent/missed push).
  const pending = hasPendingImages(images);
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void pollPending(), 4000);
    return () => clearInterval(t);
  }, [pending, pollPending]);

  return (
    <div className="studio">
      <div className="studio__top">
        <Composer />
        <Toolbar />
      </div>
      <div className="studio__gallery">
        <Gallery />
      </div>
      <Lightbox />
    </div>
  );
}

