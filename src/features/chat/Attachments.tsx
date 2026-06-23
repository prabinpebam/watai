import { useEffect, useState } from 'react';
import { repo } from '../../data';
import { Icon } from '../../design/icons';
import { IconButton } from '../../design/ui';
import { Lightbox } from './Lightbox';
import { formatBytes } from '../../lib/format';
import type { Attachment, ImageRef } from '../../lib/types';

function isDirectUrl(s?: string): s is string {
  return !!s && /^(data:|blob:|https?:)/.test(s);
}

/** Resolve an attachment to a usable object URL (direct URL or IndexedDB blob). */
function useObjectUrl(blobPath?: string, localBlobKey?: string): string | null {
  const [url, setUrl] = useState<string | null>(isDirectUrl(blobPath) ? blobPath : null);
  useEffect(() => {
    let live = true;
    if (isDirectUrl(blobPath)) {
      setUrl(blobPath);
      return;
    }
    if (localBlobKey) {
      repo
        .getBlobUrl(localBlobKey)
        .then((u) => live && setUrl(u))
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [blobPath, localBlobKey]);
  return url;
}

function download(url: string, name?: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function iconForMime(mime: string, name = ''): string {
  if (mime.startsWith('image/')) return 'file-image';
  if (mime.startsWith('audio/')) return 'file-audio';
  if (mime.startsWith('video/')) return 'file-video';
  if (mime === 'application/pdf') return 'file-pdf';
  if (/zip|compressed|tar|rar|7z/.test(mime)) return 'file-zip';
  if (mime === 'text/csv' || name.endsWith('.csv')) return 'file-csv';
  if (/json|javascript|typescript|xml|html|css|x-|code/.test(mime) || /\.(json|js|ts|tsx|py|rs|go|java|css|html)$/.test(name))
    return 'file-code';
  if (mime.startsWith('text/')) return 'file-text';
  return 'file';
}

function ImageAttachment({ att }: { att: Attachment }) {
  const url = useObjectUrl(att.blobPath, att.localBlobKey);
  const [open, setOpen] = useState(false);
  if (!url) return <div className="attach-thumb attach-thumb--loading skeleton" />;
  return (
    <>
      <button className="attach-thumb" onClick={() => setOpen(true)} title={att.name || 'Image'}>
        <img src={url} alt={att.name || ''} loading="lazy" />
      </button>
      {open && (
        <Lightbox
          src={url}
          alt={att.name}
          onClose={() => setOpen(false)}
          onDownload={() => download(url, att.name)}
        />
      )}
    </>
  );
}

function PdfAttachment({ att }: { att: Attachment }) {
  const url = useObjectUrl(att.blobPath, att.localBlobKey);
  const [preview, setPreview] = useState(false);
  // data: URLs can't be opened top-level and some viewers won't embed them,
  // so resolve a blob: URL for both the inline <object> and the open/download links.
  const [navUrl, setNavUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!url) return;
    if (!url.startsWith('data:')) {
      setNavUrl(url);
      return;
    }
    let made: string | null = null;
    let revoked = false;
    fetch(url)
      .then((r) => r.blob())
      .then((b) => {
        if (revoked) return;
        made = URL.createObjectURL(b);
        setNavUrl(made);
      })
      .catch(() => undefined);
    return () => {
      revoked = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [url]);

  return (
    <div className="file-card">
      <div className="file-card__row">
        <span className="file-card__icon file-card__icon--pdf">
          <Icon name="file-pdf" size={20} />
        </span>
        <div className="file-card__meta">
          <div className="file-card__name">{att.name || 'Document.pdf'}</div>
          <div className="file-card__sub">PDF{att.bytes ? ` · ${formatBytes(att.bytes)}` : ''}</div>
        </div>
        <div className="file-card__actions">
          <IconButton
            name="external"
            label="Open in new tab"
            size={16}
            onClick={() => navUrl && window.open(navUrl, '_blank', 'noopener')}
            disabled={!navUrl}
          />
          <IconButton
            name={preview ? 'chevron-up' : 'expand'}
            label={preview ? 'Hide preview' : 'Preview'}
            size={16}
            onClick={() => setPreview((p) => !p)}
            disabled={!navUrl}
          />
          <IconButton name="download" label="Download" size={16} onClick={() => navUrl && download(navUrl, att.name)} disabled={!navUrl} />
        </div>
      </div>
      {preview && navUrl && (
        <object className="file-card__pdf" data={navUrl} type="application/pdf" aria-label={att.name || 'PDF preview'}>
          <div className="file-card__fallback">
            Preview unavailable.{' '}
            <a href={navUrl} target="_blank" rel="noopener noreferrer">
              Open in new tab
            </a>
          </div>
        </object>
      )}
    </div>
  );
}

function MediaAttachment({ att }: { att: Attachment }) {
  const url = useObjectUrl(att.blobPath, att.localBlobKey);
  if (!url) return <div className="file-card file-card--loading skeleton" />;
  return (
    <div className="file-card file-card--media">
      <div className="file-card__name">{att.name || (att.mime.startsWith('audio/') ? 'Audio' : 'Video')}</div>
      {att.mime.startsWith('audio/') ? (
        <audio controls src={url} className="file-card__audio" />
      ) : (
        <video controls src={url} className="file-card__video" />
      )}
    </div>
  );
}

function FileChip({ att }: { att: Attachment }) {
  const url = useObjectUrl(att.blobPath, att.localBlobKey);
  return (
    <div className="file-card">
      <div className="file-card__row">
        <span className="file-card__icon">
          <Icon name={iconForMime(att.mime, att.name)} size={20} />
        </span>
        <div className="file-card__meta">
          <div className="file-card__name">{att.name || 'File'}</div>
          <div className="file-card__sub">
            {att.mime || 'file'}
            {att.bytes ? ` · ${formatBytes(att.bytes)}` : ''}
          </div>
        </div>
        <div className="file-card__actions">
          <IconButton name="download" label="Download" size={16} onClick={() => url && download(url, att.name)} disabled={!url} />
        </div>
      </div>
    </div>
  );
}

function AttachmentItem({ att }: { att: Attachment }) {
  // SVG renders safely through <img> (no script execution) and zooms like an image.
  if (att.mime === 'application/pdf') return <PdfAttachment att={att} />;
  if (att.mime.startsWith('audio/') || att.mime.startsWith('video/')) return <MediaAttachment att={att} />;
  if (att.mime.startsWith('image/')) return <ImageAttachment att={att} />;
  return <FileChip att={att} />;
}

export function AttachmentList({ attachments }: { attachments?: Attachment[] }) {
  if (!attachments || attachments.length === 0) return null;
  const images = attachments.filter((a) => a.mime.startsWith('image/'));
  const rest = attachments.filter((a) => !a.mime.startsWith('image/'));
  return (
    <div className="attachments">
      {images.length > 0 && (
        <div className="attach-grid">
          {images.map((a) => (
            <AttachmentItem key={a.id} att={a} />
          ))}
        </div>
      )}
      {rest.map((a) => (
        <AttachmentItem key={a.id} att={a} />
      ))}
    </div>
  );
}

function GeneratedImage({ image }: { image: ImageRef }) {
  const url = useObjectUrl(image.blobPath, image.localBlobKey);
  const [open, setOpen] = useState(false);
  if (!url) return <div className="image-card image-card--loading skeleton" style={{ height: 220 }} />;
  return (
    <div className="image-card">
      <button className="image-card__hit" onClick={() => setOpen(true)} aria-label="Expand image">
        <img src={url} alt={image.prompt} loading="lazy" />
      </button>
      <div className="image-card__bar">
        <span className="image-card__prompt" title={image.prompt}>
          {image.prompt}
        </span>
        <IconButton name="download" label="Download" size={16} onClick={() => download(url, `${image.id}.${image.outputFormat}`)} />
        <IconButton name="expand" label="Expand" size={16} onClick={() => setOpen(true)} />
      </div>
      {open && (
        <Lightbox src={url} alt={image.prompt} onClose={() => setOpen(false)} onDownload={() => download(url, `${image.id}.${image.outputFormat}`)} />
      )}
    </div>
  );
}

export function GeneratedImages({ images }: { images?: ImageRef[] }) {
  if (!images || images.length === 0) return null;
  return (
    <div className={`gen-images ${images.length > 1 ? 'gen-images--grid' : ''}`}>
      {images.map((img) => (
        <GeneratedImage key={img.id} image={img} />
      ))}
    </div>
  );
}
