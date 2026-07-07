import type { StudioImage as ImageRecord } from '../../../data/cloud/types';
import { saveFile } from '../../../lib/saveFile';

/** Save an image's bytes to the device. On iOS this opens the native share sheet
 *  (Save Image → Photos) instead of the Quick Look preview a plain download would trigger;
 *  elsewhere it downloads directly. The cross-origin SAS URL is fetched to a blob so it saves
 *  rather than navigates. */
export async function downloadImage(img: ImageRecord): Promise<void> {
  if (!img.url) return;
  const ext = img.outputFormat === 'jpeg' ? 'jpg' : img.outputFormat;
  const filename = `watai-${img.id}.${ext}`;
  await saveFile(img.url, filename);
}

/** CSS aspect-ratio value (e.g. "1024 / 1536") from a size string. */
export function aspectRatio(size: string): string {
  const [w, h] = size.split('x');
  return w && h ? `${w} / ${h}` : '1 / 1';
}