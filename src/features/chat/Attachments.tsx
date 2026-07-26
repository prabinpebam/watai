import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { repo } from '../../data';
import { Icon } from '../../design/icons';
import { IconButton } from '../../design/ui';
import { ImagePrompt, Lightbox, type GalleryImage } from './Lightbox';
import { formatBytes } from '../../lib/format';
import { saveFile } from '../../lib/saveFile';
import type { Artifact, Attachment, ImageRef, PendingImage } from '../../lib/types';

function isDirectUrl(s?: string): s is string {
  return !!s && /^(data:|blob:|https?:)/.test(s);
}

/** Resolve an attachment to a usable object URL: local cache, direct URL, or cloud blob (SAS). */
function useAttachmentUrl(att: Attachment): string | null {
  const [url, setUrl] = useState<string | null>(isDirectUrl(att.blobPath) ? att.blobPath! : null);
  useEffect(() => {
    let live = true;
    repo
      .resolveAssetUrl(att)
      .then((u) => live && setUrl(u || null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [att.id, att.blobPath, att.localBlobKey]);
  return url;
}

function download(url: string, name?: string) {
  // saveFile prefers the native share sheet on iOS (Save Image → Photos), where a plain
  // <a download> would only open a Quick Look preview; elsewhere it downloads directly.
  void saveFile(url, name || 'download');
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
  const url = useAttachmentUrl(att);
  const [open, setOpen] = useState(false);
  if (!url)
    return (
      <div className="attach-thumb attach-thumb--loading" role="img" aria-label="Loading image">
        <span className="spinner spinner--on-media" />
      </div>
    );
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
  const url = useAttachmentUrl(att);
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
  const url = useAttachmentUrl(att);
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
  const url = useAttachmentUrl(att);
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

/** Map a generated artifact onto the attachment shape so it reuses the same file cards (including
 *  inline PDF preview + download via the read-SAS flow). */
function artifactToAttachment(a: Artifact): Attachment {
  return {
    id: a.id,
    kind: a.mime.startsWith('image/') ? 'image' : a.mime.startsWith('audio/') ? 'audio' : 'file',
    ...(a.blobPath ? { blobPath: a.blobPath } : {}),
    ...(a.localBlobKey ? { localBlobKey: a.localBlobKey } : {}),
    mime: a.mime,
    bytes: a.bytes,
    name: a.name,
  };
}

/** Files the agent generated this message (code interpreter outputs) — downloadable artifact cards. */
export function ArtifactList({ artifacts }: { artifacts?: Artifact[] }) {
  if (!artifacts || artifacts.length === 0) return null;
  return (
    <div className="attachments artifacts">
      {artifacts.map((a) => (
        <AttachmentItem key={a.id} att={artifactToAttachment(a)} />
      ))}
    </div>
  );
}

/** Stable identity for a generated image's bytes — changes only if the image is re-pointed. */
function imageCacheKey(image: ImageRef): string {
  return `${image.id}:${image.localBlobKey ?? image.blobPath ?? ''}`;
}

/**
 * Resolved URLs are cached for the session. Resolution can mean an IndexedDB read or a SAS
 * download, so without this every viewer mount and every filmstrip step re-resolves every image
 * in the thread — which is what made stepping through the gallery feel like a full reload.
 */
const resolvedImageUrls = new Map<string, string>();
const inflightImageUrls = new Map<string, Promise<string>>();

function loadImageUrl(image: ImageRef): Promise<string> {
  const key = imageCacheKey(image);
  const hit = resolvedImageUrls.get(key);
  if (hit) return Promise.resolve(hit);
  const existing = inflightImageUrls.get(key);
  if (existing) return existing;
  const pending = repo
    .resolveImageUrl(image)
    .catch(() => '')
    .then((url) => {
      inflightImageUrls.delete(key);
      if (url) resolvedImageUrls.set(key, url);
      return url;
    });
  inflightImageUrls.set(key, pending);
  return pending;
}

/** Resolve a generated image's URL via the repository (local cache, else cloud read SAS). */
function useResolvedImage(image: ImageRef): string | null {
  const key = imageCacheKey(image);
  const [url, setUrl] = useState<string | null>(() => resolvedImageUrls.get(key) ?? null);
  useEffect(() => {
    const hit = resolvedImageUrls.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    let live = true;
    void loadImageUrl(image).then((resolved) => {
      if (live) setUrl(resolved || null);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
}

function GeneratedImage({
  image,
  onOpenImage,
}: {
  image: ImageRef;
  onOpenImage?: (image: ImageRef) => void;
}) {
  const url = useResolvedImage(image);
  const [decoded, setDecoded] = useState<{ url: string; aspect: string } | null>(null);
  const revealed = !!url && decoded?.url === url;

  // Only drop the veil once the bytes are decoded, so the swap is a fade rather than a reflow. The
  // reserved box then adopts the image's true aspect, which is a no-op whenever the stored size is
  // accurate (the normal case) and avoids letterboxing when it is not.
  const reveal = async (el: HTMLImageElement, forUrl: string) => {
    try {
      await el.decode?.();
    } catch {
      // onLoad already proves the resource is available; decode can reject on older engines.
    }
    const aspect =
      el.naturalWidth && el.naturalHeight ? `${el.naturalWidth} / ${el.naturalHeight}` : '';
    setDecoded({ url: forUrl, aspect });
  };

  return (
    <ImageCardFrame
      size={image.size}
      aspect={revealed ? decoded?.aspect : undefined}
      imageId={image.id}
      className={revealed ? 'image-card--revealed' : ''}
      media={
        <>
          {url && (
            <button
              className="image-card__hit"
              onClick={() => onOpenImage?.(image)}
              aria-label="Expand image"
              disabled={!revealed}
            >
              <img
                src={url}
                alt={image.prompt}
                loading="lazy"
                // A cached image can finish before React attaches onLoad, which would strand the veil.
                ref={(el) => {
                  if (el?.complete) void reveal(el, url);
                }}
                onLoad={(e) => void reveal(e.currentTarget, url)}
              />
            </button>
          )}
          <span
            className="image-placeholder image-placeholder--loading image-card__veil"
            role="img"
            aria-label="Loading image"
            aria-hidden={revealed || undefined}
          >
            <span className="spinner spinner--on-media" />
          </span>
        </>
      }
      bar={
        <>
          <ImagePrompt text={image.prompt} compact />
          <IconButton
            name="download"
            label="Download"
            size={16}
            disabled={!url}
            onClick={() => url && download(url, `${image.id}.${image.outputFormat}`)}
          />
          <IconButton name="expand" label="Expand" size={16} disabled={!url} onClick={() => onOpenImage?.(image)} />
        </>
      }
    />
  );
}

/**
 * The one full-screen viewer for a thread. It lives above the message list so stepping through the
 * filmstrip only changes props — the overlay never unmounts, so the strip, the counter and the
 * already-resolved images all stay put instead of being rebuilt on every selection.
 */
export function GeneratedImageViewer({
  images,
  currentId,
  onSelect,
  onClose,
}: {
  images: ImageRef[];
  currentId: string | null;
  onSelect: (image: ImageRef) => void;
  onClose: () => void;
}) {
  const gallery = useResolvedGallery(currentId ? images : []);
  const current = gallery.find((item) => item.image.id === currentId);
  if (!currentId || !current) return null;
  return (
    <Lightbox
      src={current.url}
      alt={current.image.prompt}
      prompt={current.image.prompt}
      onClose={onClose}
      onDownload={() => download(current.url, `${current.image.id}.${current.image.outputFormat}`)}
      images={gallery}
      currentIndex={Math.max(0, gallery.findIndex((item) => item.image.id === currentId))}
      onSelect={(item) => onSelect(item.image)}
    />
  );
}

/** Resolve every image in the strip, reusing the session cache and revealing each as it lands. */
function useResolvedGallery(images: ImageRef[]): GalleryImage[] {
  const [tick, bump] = useState(0);
  const imageKey = images.map(imageCacheKey).join('|');
  useEffect(() => {
    let live = true;
    const missing = images.filter((image) => !resolvedImageUrls.has(imageCacheKey(image)));
    if (missing.length === 0) return;
    for (const image of missing) {
      void loadImageUrl(image).then((url) => {
        if (live && url) bump((n) => n + 1);
      });
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey]);
  return useMemo(
    () =>
      images.flatMap((image) => {
        const url = resolvedImageUrls.get(imageCacheKey(image));
        return url ? [{ image, url }] : [];
      }),
    // `tick` is what re-reads the cache after late arrivals land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [imageKey, images, tick],
  );
}

export function GeneratedImages({
  images,
  pending,
  onOpenImage,
}: {
  images?: ImageRef[];
  pending?: PendingImage[];
  onOpenImage?: (image: ImageRef) => void;
}) {
  const imageCount = images?.length ?? 0;
  const pendingCount = pending?.length ?? 0;
  if (imageCount + pendingCount === 0) return null;
  return (
    <div className={`gen-images ${imageCount + pendingCount > 1 ? 'gen-images--grid' : ''}`}>
      {images?.map((img) => (
        <GeneratedImage key={img.id} image={img} onOpenImage={onOpenImage} />
      ))}
      {pending?.map((p) => (
        <ImagePlaceholder key={p.id} size={p.size} />
      ))}
    </div>
  );
}

/** Parse a `WxH` size string into [w, h], defaulting to a square. */
function parseAspect(size: string): [number, number] {
  const m = /^(\d+)\s*[x\u00d7]\s*(\d+)$/.exec(size.trim());
  return m ? [Number(m[1]), Number(m[2])] : [1, 1];
}

/**
 * One card geometry for every stage of a generated image: the media box is pinned to the requested
 * aspect ratio and the action bar has a reserved height, so going from "generating" to the decoded
 * image is a cross-fade in place — the card never collapses and the transcript never jumps.
 */
function ImageCardFrame({
  size,
  aspect,
  imageId,
  className = '',
  media,
  bar,
}: {
  size: string;
  aspect?: string;
  imageId?: string;
  className?: string;
  media: ReactNode;
  bar: ReactNode;
}) {
  const [w, h] = parseAspect(size);
  return (
    <div className={`image-card ${className}`.trim()} {...(imageId ? { 'data-image-id': imageId } : {})}>
      <div className="image-card__media" style={{ aspectRatio: aspect || `${w} / ${h}` }}>
        {media}
      </div>
      <div className="image-card__bar">{bar}</div>
    </div>
  );
}

/** Animated gradient placeholder shown while an image generates; matches the target aspect ratio. */
function ImagePlaceholder({ size }: { size: string }) {
  return (
    <ImageCardFrame
      size={size}
      className="image-card--generating"
      media={<span className="image-placeholder" role="img" aria-label="Generating image" />}
      bar={<span className="image-card__prompt">Generating image…</span>}
    />
  );
}
