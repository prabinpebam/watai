/**
 * Save a file (image or otherwise) to the device as directly as the platform allows.
 *
 * The problem this solves: on iOS/iPadOS Safari a plain `<a download>` of a blob/object URL
 * does not save — it opens a Quick Look preview screen ("Open in Preview" / "More…"), forcing
 * extra taps. The native share sheet is the direct path there: for images it offers
 * "Save Image" (→ Photos) and for other files "Save to Files".
 *
 * So on iOS we route through the Web Share API (`navigator.share({ files })`); everywhere else
 * (desktop, Android) we keep the ordinary download, which lands straight in the Downloads folder
 * with no interstitial.
 */

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPadOS 13+ reports as "MacIntel" but is a touch device, so detect that separately.
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

const preparedFiles = new Map<string, { promise: Promise<Blob>; controller: AbortController }>();
const downloadUrls = new Map<string, ReturnType<typeof setTimeout>>();
let ownerEpoch = 0;

function releaseDownloadUrl(url: string): void {
  const timer = downloadUrls.get(url);
  if (timer === undefined) return;
  clearTimeout(timer);
  downloadUrls.delete(url);
  URL.revokeObjectURL(url);
}

export function clearPreparedFiles(): void {
  ownerEpoch += 1;
  for (const prepared of preparedFiles.values()) prepared.controller.abort();
  preparedFiles.clear();
  for (const url of downloadUrls.keys()) releaseDownloadUrl(url);
}

async function fetchBlob(source: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(source, signal ? { signal } : undefined);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const blob = await res.blob();
  if (signal?.aborted) throw new DOMException('Download was cancelled.', 'AbortError');
  return blob;
}

export function prepareFile(source: string): Promise<Blob> | undefined {
  if (!isIOS() || !/^https?:/.test(source)) return undefined;
  const existing = preparedFiles.get(source);
  if (existing) return existing.promise;
  if (preparedFiles.size >= 8) {
    const oldest = preparedFiles.keys().next().value;
    if (oldest) {
      preparedFiles.get(oldest)?.controller.abort();
      preparedFiles.delete(oldest);
    }
  }
  const controller = new AbortController();
  const prepared = fetchBlob(source, controller.signal).catch((error) => {
    if (preparedFiles.get(source)?.promise === prepared) preparedFiles.delete(source);
    throw error;
  });
  preparedFiles.set(source, { promise: prepared, controller });
  return prepared;
}

async function resolveBlob(source: Blob | string): Promise<Blob> {
  if (typeof source !== 'string') return source;
  return preparedFiles.get(source)?.promise ?? fetchBlob(source);
}

function anchorDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function blobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  downloadUrls.set(url, setTimeout(() => releaseDownloadUrl(url), 10_000));
  anchorDownload(url, filename);
}

/**
 * Save `source` (a Blob, or a blob:/data:/http(s) URL) to the device under `filename`.
 * On iOS this opens the native share sheet (Save Image → Photos / Save to Files); elsewhere it
 * performs a normal download. Silently returns if the user dismisses the iOS share sheet.
 */
export async function saveFile(source: Blob | string, filename: string): Promise<void> {
  const epoch = ownerEpoch;
  let blob: Blob | null = null;

  // iOS: prefer the native share sheet. `canShare({ files })` gates for Web Share Level 2 support.
  if (isIOS() && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function') {
    try {
      blob = await resolveBlob(source);
      if (epoch !== ownerEpoch) return;
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (err) {
      if (epoch !== ownerEpoch) return;
      // User dismissed the sheet → done. Any other error → fall through to a plain download.
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }

  // Default path (desktop + Android + iOS fallback): direct download.
  try {
    if (!blob) {
      if (typeof source === 'string') {
        if (/^(blob:|data:)/.test(source)) {
          if (epoch !== ownerEpoch) return;
          anchorDownload(source, filename);
          return;
        }
        blob = await resolveBlob(source);
      } else {
        blob = source;
      }
    }
    if (epoch !== ownerEpoch) return;
    blobDownload(blob, filename);
  } catch (error) {
    if (epoch !== ownerEpoch) return;
    if (error instanceof DOMException && error.name === 'AbortError') return;
    // Last resort: open the URL so the user can save it manually.
    if (typeof source === 'string') window.open(source, '_blank', 'noopener');
  }
}
