/** Read a File/Blob as bare base64 (no `data:` prefix) — the shape the thread-files API expects. */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result);
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    r.onerror = () => reject(r.error ?? new Error('file read failed'));
    r.readAsDataURL(file);
  });
}

/** Human-readable byte size (B / KB / MB). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Decode bare base64 into a Blob of the given mime type (e.g. proxied TTS audio). */
export function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** File types accepted for thread knowledge-base documents (Azure OpenAI file_search set). */
export const DOC_ACCEPT =
  'application/pdf,text/plain,text/markdown,text/csv,application/json,.md,.markdown,.docx,.pptx,.xlsx';
