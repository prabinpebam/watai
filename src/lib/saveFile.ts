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

async function resolveBlob(source: Blob | string): Promise<Blob> {
  if (typeof source !== 'string') return source;
  const res = await fetch(source);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  return res.blob();
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
  anchorDownload(url, filename);
  // Revoke well after the click so the browser has grabbed the bytes.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Save `source` (a Blob, or a blob:/data:/http(s) URL) to the device under `filename`.
 * On iOS this opens the native share sheet (Save Image → Photos / Save to Files); elsewhere it
 * performs a normal download. Silently returns if the user dismisses the iOS share sheet.
 */
export async function saveFile(source: Blob | string, filename: string): Promise<void> {
  let blob: Blob | null = null;

  // iOS: prefer the native share sheet. `canShare({ files })` gates for Web Share Level 2 support.
  if (isIOS() && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function') {
    try {
      blob = await resolveBlob(source);
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (err) {
      // User dismissed the sheet → done. Any other error → fall through to a plain download.
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }

  // Default path (desktop + Android + iOS fallback): direct download.
  try {
    if (!blob) {
      if (typeof source === 'string') {
        if (/^(blob:|data:)/.test(source)) {
          anchorDownload(source, filename);
          return;
        }
        blob = await resolveBlob(source);
      } else {
        blob = source;
      }
    }
    blobDownload(blob, filename);
  } catch {
    // Last resort: open the URL so the user can save it manually.
    if (typeof source === 'string') window.open(source, '_blank', 'noopener');
  }
}
