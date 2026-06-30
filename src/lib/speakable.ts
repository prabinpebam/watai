// Markdown → spoken text. The streamed agentic reply is markdown; feeding it raw to TTS would read
// "asterisk asterisk" and spell out code. This normalizer produces clean prose for `/ai/speech`:
// emphasis/links → their text, code/tables/images dropped (they live in the thread), lists linearized.
// Pure + deterministic — unit-tested. Apply to each completed sentence (see sentences.ts) before TTS.

export function speakableText(markdown: string): string {
  let t = markdown ?? '';
  if (!t) return '';

  // Block constructs first (drop entirely — never read aloud).
  t = t.replace(/```[\s\S]*?```/g, ' '); // fenced code
  t = t.replace(/~~~[\s\S]*?~~~/g, ' ');
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' '); // images
  t = t.replace(/^\s*\|.*\|\s*$/gm, ' '); // table rows

  // Inline constructs → their text.
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // links → label
  t = t.replace(/`([^`]+)`/g, '$1'); // inline code → contents
  t = t.replace(/~~([^~]+)~~/g, ''); // strikethrough → drop (it's deleted text)
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1'); // bold
  t = t.replace(/\*([^*]+)\*/g, '$1'); // italic

  // Line-leading markers.
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, ''); // headings
  t = t.replace(/^\s{0,3}>\s?/gm, ''); // blockquotes
  t = t.replace(/^\s{0,3}([-*+]|\d{1,3}[.)])\s+/gm, ''); // list markers
  t = t.replace(/^\s{0,3}([-*_])\1{2,}\s*$/gm, ' '); // horizontal rules

  return t.replace(/\s+/g, ' ').trim();
}
