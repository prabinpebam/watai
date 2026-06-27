import type { StudioImage as ImageRecord } from '../../../data/cloud/types';

/** Force-download an image's bytes (fetch -> object URL) so a cross-origin SAS URL saves rather
 *  than navigates. Falls back to opening the URL if the fetch is blocked. */
export async function downloadImage(img: ImageRecord): Promise<void> {
  if (!img.url) return;
  const ext = img.outputFormat === 'jpeg' ? 'jpg' : img.outputFormat;
  const filename = `watai-${img.id}.${ext}`;
  try {
    const res = await fetch(img.url);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    window.open(img.url, '_blank', 'noopener');
  }
}

/** CSS aspect-ratio value (e.g. "1024 / 1536") from a size string. */
export function aspectRatio(size: string): string {
  const [w, h] = size.split('x');
  return w && h ? `${w} / ${h}` : '1 / 1';
}