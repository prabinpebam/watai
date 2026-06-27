import { useRef } from 'react';
import { Button, Segmented, Switch } from '../../../design/ui';
import { Icon } from '../../../design/icons';
import { useUi } from '../../../state/store';
import { useImageStudio, type Quality } from '../imageStudioStore';

const SIZE_OPTIONS = [
  { value: '1024x1024', label: 'Square' },
  { value: '1024x1536', label: 'Portrait' },
  { value: '1536x1024', label: 'Landscape' },
];
const COUNT_OPTIONS = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
];
const QUALITY_OPTIONS: { value: Quality; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

export function Composer() {
  const pushToast = useUi((s) => s.pushToast);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const prompt = useImageStudio((s) => s.prompt);
  const size = useImageStudio((s) => s.size);
  const count = useImageStudio((s) => s.count);
  const quality = useImageStudio((s) => s.quality);
  const remix = useImageStudio((s) => s.remix);
  const useReference = useImageStudio((s) => s.useReference);
  const generating = useImageStudio((s) => s.generating);
  const imageCapable = useImageStudio((s) => s.imageCapable);

  const setPrompt = useImageStudio((s) => s.setPrompt);
  const setSize = useImageStudio((s) => s.setSize);
  const setCount = useImageStudio((s) => s.setCount);
  const setQuality = useImageStudio((s) => s.setQuality);
  const setUseReference = useImageStudio((s) => s.setUseReference);
  const clearRemix = useImageStudio((s) => s.clearRemix);
  const generate = useImageStudio((s) => s.generate);

  const disabled = imageCapable === false;

  const run = async () => {
    if (!prompt.trim() || generating || disabled) return;
    const res = await generate();
    if (!res.ok && res.error) pushToast(res.error, 'error');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void run();
    }
  };

  return (
    <div className="studio-composer">
      {remix && (
        <div className="studio-remix-banner">
          {remix.url ? (
            <img src={remix.url} alt="" className="studio-remix-banner__thumb" />
          ) : (
            <span className="studio-remix-banner__thumb studio-remix-banner__thumb--empty" />
          )}
          <div className="studio-remix-banner__body">
            <span className="studio-remix-banner__title">Remixing this image</span>
            <label className="studio-remix-banner__toggle">
              <Switch
                checked={useReference}
                onChange={setUseReference}
                label="Use the source image as a reference"
              />
              <span>Use as reference</span>
            </label>
          </div>
          <button className="studio-remix-banner__clear" onClick={clearRemix} aria-label="Cancel remix" title="Cancel remix">
            <Icon name="close" size={18} />
          </button>
        </div>
      )}

      <div className="studio-composer__input">
        <textarea
          ref={taRef}
          className="studio-composer__textarea"
          value={prompt}
          placeholder="Describe the image you want to create…"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={2}
        />
      </div>

      {disabled ? (
        <p className="studio-composer__notice">
          <Icon name="info" size={15} style={{ verticalAlign: '-3px' }} /> No image model is configured. Add one in
          Settings to generate images.
        </p>
      ) : (
        <div className="studio-composer__controls">
          <div className="studio-control">
            <span className="studio-control__label">Aspect</span>
            <Segmented value={size} onChange={setSize} options={SIZE_OPTIONS} />
          </div>
          <div className="studio-control">
            <span className="studio-control__label">Count</span>
            <Segmented value={String(count)} onChange={(v) => setCount(Number(v))} options={COUNT_OPTIONS} />
          </div>
          <div className="studio-control">
            <span className="studio-control__label">Quality</span>
            <Segmented value={quality} onChange={setQuality} options={QUALITY_OPTIONS} />
          </div>
          <Button
            variant="primary"
            icon={remix ? 'remix' : 'sparkle'}
            loading={generating}
            onClick={run}
            disabled={!prompt.trim()}
            className="studio-composer__generate"
          >
            {generating ? 'Generating…' : remix ? 'Remix' : 'Generate'}
          </Button>
        </div>
      )}
    </div>
  );
}
