const MAX_EDGE = 4096;
const JPEG_QUALITY = 0.92;
const IMAGE_EXTENSION = /\.(?:png|webp|jpe?g|gif|heic|heif)$/i;

export function isImageUpload(file: File): boolean {
  return file.type.toLowerCase().startsWith('image/') || IMAGE_EXTENSION.test(file.name);
}

function reliablePassthroughType(file: File): 'image/png' | 'image/webp' | null {
  const type = file.type.toLowerCase();
  if (type === 'image/png' || (!type && /\.png$/i.test(file.name))) return 'image/png';
  if (type === 'image/webp' || (!type && /\.webp$/i.test(file.name))) return 'image/webp';
  return null;
}

function jpegName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '') || 'image';
  return `${base}.jpg`;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('The browser could not encode this image.')),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

async function decodeWithImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    if (typeof image.decode === 'function') await image.decode();
    else {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('The browser could not decode this image.'));
      });
    }
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('The image has no readable dimensions.');
    return image;
  } finally {
    // Decoded image data remains available after the source object URL is revoked.
    URL.revokeObjectURL(url);
  }
}

/**
 * Normalize mobile/photo formats before persistence. Safari can display Apple HDR JPEG/HEIC files
 * that GPT Image's edit endpoint rejects (notably JPEGs containing MPF gain-map streams). Decoding
 * and re-encoding through canvas removes auxiliary streams, applies EXIF orientation, converts the
 * canvas output to a standard browser JPEG, and bounds very large photos for memory safety.
 * PNG/WebP already have reliable cross-platform payloads and pass through unchanged.
 */
export async function normalizeImageUpload(file: File): Promise<File> {
  if (!isImageUpload(file)) return file;
  const passthroughType = reliablePassthroughType(file);
  if (passthroughType) {
    if (file.type === passthroughType) return file;
    return new File([file], file.name, { type: passthroughType, lastModified: file.lastModified });
  }

  const image = await decodeWithImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser could not prepare this image.');
  // JPEG has no alpha; white avoids black backgrounds for HEIC assets with auxiliary alpha.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const blob = await canvasBlob(canvas);
  return new File([blob], jpegName(file.name), {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });
}
