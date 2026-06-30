import { useState } from 'react';
import type { WebImage } from '../../lib/types';
import { Icon } from '../../design/icons';
import { Lightbox } from './Lightbox';
import { attachWebImage } from './webImageActions';

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Inline strip of images surfaced by web search. Each can be opened (lightbox) or attached to the
 *  composer in one tap ("Use") so the user can edit/use it without a manual upload. Broken thumbnails
 *  drop out silently. */
export function WebImages({ images }: { images: WebImage[] }) {
  const [light, setLight] = useState<{ src: string; alt: string } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [using, setUsing] = useState<string | null>(null);
  const visible = images.filter((im) => !hidden.has(im.id));
  if (!visible.length) return null;

  const use = async (im: WebImage) => {
    setUsing(im.id);
    try {
      await attachWebImage(im.url);
    } finally {
      setUsing(null);
    }
  };

  return (
    <div className="web-images">
      <div className="web-images__head">
        <Icon name="image" size={14} />
        <span>Images from the web</span>
      </div>
      <div className="web-images__strip">
        {visible.map((im) => (
          <div key={im.id} className="web-image">
            <button
              type="button"
              className="web-image__hit"
              onClick={() => setLight({ src: im.url, alt: im.description || '' })}
              aria-label={im.description || 'Open web image'}
            >
              <img
                src={im.url}
                alt={im.description || ''}
                loading="lazy"
                onError={() => setHidden((h) => new Set(h).add(im.id))}
              />
            </button>
            <div className="web-image__bar">
              {domainOf(im.url) && (
                <a
                  className="web-image__src"
                  href={im.sourceUrl || im.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={im.sourceUrl || im.url}
                >
                  <Icon name="globe" size={12} />
                  <span>{domainOf(im.url)}</span>
                </a>
              )}
              <button
                type="button"
                className="web-image__use"
                onClick={() => use(im)}
                disabled={using === im.id}
                title="Add this image to your message"
              >
                <Icon name="add-image" size={14} />
                <span>{using === im.id ? 'Adding…' : 'Use'}</span>
              </button>
            </div>
          </div>
        ))}
      </div>
      {light && <Lightbox src={light.src} alt={light.alt} onClose={() => setLight(null)} />}
    </div>
  );
}
