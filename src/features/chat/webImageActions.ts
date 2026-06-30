import { cloudApi } from '../../data';
import { base64ToBlob } from '../../lib/files';
import { useUi } from '../../state/store';

function filenameFor(url: string, mime: string): string {
  const ext = (mime.split('/')[1] || 'jpg').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
  let base = 'web-image';
  try {
    const name = new URL(url).pathname.split('/').pop() ?? '';
    base = (name.split('?')[0] || 'web-image').replace(/\.[a-z0-9]+$/i, '').slice(0, 50) || 'web-image';
  } catch {
    /* keep default */
  }
  return `${base}.${ext}`;
}

/**
 * Fetch a web image's bytes server-side (CORS-safe, SSRF-guarded) and stage it as a composer
 * attachment so the user can immediately use/edit it — no manual upload. The staged file flows
 * through the normal attachment pipeline (local blob → sync → vision + image edit_reference).
 */
export async function attachWebImage(url: string): Promise<void> {
  const ui = useUi.getState();
  try {
    const { dataBase64, mime } = await cloudApi.fetchWebImage({ url });
    const file = new File([base64ToBlob(dataBase64, mime)], filenameFor(url, mime), { type: mime });
    ui.stageFiles([file]);
    ui.pushToast('Image added to your message', 'success');
  } catch (e) {
    ui.pushToast(e instanceof Error ? e.message : 'Could not add that image', 'error');
  }
}
