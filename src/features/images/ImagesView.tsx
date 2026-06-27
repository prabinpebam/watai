import { useEffect, useState } from 'react';
import { kvGet, kvSet } from '../../data/db';
import { repo, cloudApi } from '../../data';
import { base64ToBlob } from '../../lib/files';
import { newId } from '../../lib/ids';
import { Button, IconButton, Segmented } from '../../design/ui';
import { Icon } from '../../design/icons';
import { useUi } from '../../state/store';
import type { ImageRef } from '../../lib/types';

const IMAGES_KEY = 'images';

async function listImages(): Promise<ImageRef[]> {
  return (await kvGet<ImageRef[]>(IMAGES_KEY)) ?? [];
}
async function addImage(ref: ImageRef): Promise<void> {
  const list = await listImages();
  await kvSet(IMAGES_KEY, [ref, ...list]);
}
async function removeImage(id: string): Promise<void> {
  const list = await listImages();
  await kvSet(IMAGES_KEY, list.filter((i) => i.id !== id));
}

export function ImagesView() {
  const pushToast = useUi((s) => s.pushToast);
  const [prompt, setPrompt] = useState('');
  const [size, setSize] = useState('1024x1024');
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState<ImageRef[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [viewer, setViewer] = useState<ImageRef | null>(null);

  const refresh = async () => {
    const list = await listImages();
    setImages(list);
    const map: Record<string, string> = {};
    for (const img of list) {
      if (img.localBlobKey) map[img.id] = await repo.getBlobUrl(img.localBlobKey);
    }
    setUrls(map);
  };

  useEffect(() => {
    refresh();
  }, []);

  const generate = async () => {
    const p = prompt.trim();
    if (!p) return;
    setBusy(true);
    try {
      const { images: results } = await cloudApi.generateImage({ prompt: p, size });
      for (const r of results) {
        const id = newId();
        const blobKey = `img-${id}`;
        await repo.putBlob(blobKey, base64ToBlob(r.b64, 'image/png'));
        await addImage({
          id,
          localBlobKey: blobKey,
          prompt: p,
          size,
          outputFormat: 'png',
          createdAt: new Date().toISOString(),
        });
      }
      setPrompt('');
      await refresh();
    } catch (e) {
      pushToast(e instanceof Error ? e.message : 'Image generation failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const download = (img: ImageRef) => {
    const url = urls[img.id];
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `watai-${img.id}.png`;
    a.click();
  };

  return (
    <div className="page">
      <div className="page__inner">
        <h1 className="onboard__title" style={{ marginBottom: 'var(--space-5)' }}>
          Images
        </h1>

        <div className="settings-card" style={{ padding: 'var(--space-5)' }}>
          <div className="field">
            <span className="field__label">Prompt</span>
            <textarea
              className="textarea"
              value={prompt}
              placeholder="A photograph of a red fox in an autumn forest"
              onChange={(e) => setPrompt(e.target.value)}
              style={{ minHeight: 72 }}
            />
          </div>
          <div className="row" style={{ marginTop: 'var(--space-4)', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
            <Segmented
              value={size}
              onChange={setSize}
              options={[
                { value: '1024x1024', label: 'Square' },
                { value: '1024x1536', label: 'Portrait' },
                { value: '1536x1024', label: 'Landscape' },
              ]}
            />
            <Button variant="primary" icon="sparkle" loading={busy} onClick={generate} disabled={!prompt.trim()}>
              {busy ? 'Generating…' : 'Generate'}
            </Button>
          </div>
        </div>

        <div className="settings-group">
          <div className="settings-group__label">Your images</div>
          {images.length === 0 ? (
            <p className="muted">No images yet. Generate one above.</p>
          ) : (
            <div className="gallery">
              {images.map((img) => (
                <button key={img.id} className="gallery__item" onClick={() => setViewer(img)} title={img.prompt}>
                  {urls[img.id] ? <img src={urls[img.id]} alt={img.prompt} /> : <span className="skeleton" style={{ width: '100%', height: '100%' }} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {viewer && (
        <div className="viewer" role="dialog" aria-label="Image viewer">
          <div className="viewer__bar">
            <IconButton name="close" label="Close" onClick={() => setViewer(null)} />
            <span className="grow image-card__prompt">
              {viewer.prompt}
            </span>
            <IconButton name="download" label="Download" onClick={() => download(viewer)} />
            <IconButton
              name="trash"
              label="Delete"
              onClick={async () => {
                await removeImage(viewer.id);
                setViewer(null);
                await refresh();
              }}
            />
          </div>
          <div className="viewer__stage">
            {urls[viewer.id] && <img src={urls[viewer.id]} alt={viewer.prompt} />}
          </div>
          <div className="viewer__meta">
            <div className="viewer__meta-row">
              <span className="muted">
                <Icon name="image" size={14} style={{ verticalAlign: '-2px' }} /> {viewer.size}
              </span>
              {viewer.model && (
                <span className="muted">
                  <Icon name="sparkle" size={14} style={{ verticalAlign: '-2px' }} /> {viewer.model}
                </span>
              )}
            </div>
            {viewer.expandedPrompt && viewer.expandedPrompt !== viewer.prompt && (
              <details className="viewer__prompt">
                <summary>Prompt the model used</summary>
                <p>{viewer.expandedPrompt}</p>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
