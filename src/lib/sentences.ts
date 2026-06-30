// Incremental sentence splitter for streaming text. Feed the growing reply (prefix-stable: each
// push is the previous text plus more) and get back sentences as they *complete*, each exactly once,
// so a voice loop can synthesize speech sentence-by-sentence instead of waiting for the whole reply.
// Pure + deterministic — unit-tested. Markdown normalization is a separate concern (see speakable.ts).

const ABBREV = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'eg', 'ie', 'al', 'fig', 'vol', 'dept',
  'approx', 'inc', 'ltd', 'co',
]);

const TERMINATORS = new Set(['.', '!', '?']);

export interface SentenceStream {
  /** Feed the latest full (prefix-stable) text; returns sentences newly completed since the last call. */
  push(fullText: string): string[];
  /** Emit any unterminated trailing buffer as a final sentence (call once when the stream ends). */
  flush(): string[];
}

function isBoundary(text: string, i: number): boolean {
  const ch = text[i];
  const next = text[i + 1];
  const prev = text[i - 1];
  // A terminator only ends a sentence when followed by whitespace or the end of the text. "word.word"
  // and "3.14" (digit after the dot) are therefore never boundaries.
  if (next !== undefined && !/\s/.test(next)) return false;
  if (ch === '.') {
    // End of the current (still-streaming) text: a trailing "." after a digit or another dot could be
    // a decimal ("3." → "3.14") or an ellipsis ("..."), so wait for more rather than mis-split.
    if (next === undefined && (prev === '.' || /\d/.test(prev ?? ''))) return false;
    const before = text.slice(0, i);
    const token = before.match(/([A-Za-z.]{1,8})$/)?.[1];
    if (token && ABBREV.has(token.replace(/\./g, '').toLowerCase())) return false; // "e.g.", "Dr."
    if (/(?:^|\s)[A-Za-z]$/.test(before)) return false; // single-letter initial: "J. Smith"
    if (/(?:^|\n)\s*\d{1,3}$/.test(before)) return false; // numbered list marker: "1."
  }
  return true;
}

export function createSentenceStream(): SentenceStream {
  let consumed = 0; // index up to which sentences have already been emitted
  let lastText = '';

  function extract(text: string): string[] {
    const out: string[] = [];
    let start = consumed;
    let i = consumed;
    while (i < text.length) {
      if (TERMINATORS.has(text[i]) && isBoundary(text, i)) {
        const sentence = text.slice(start, i + 1).trim();
        if (sentence) out.push(sentence);
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        consumed = j;
        start = j;
        i = j;
        continue;
      }
      i++;
    }
    return out;
  }

  return {
    push(fullText) {
      lastText = fullText;
      return extract(fullText);
    },
    flush() {
      const tail = lastText.slice(consumed).trim();
      consumed = lastText.length;
      return tail ? [tail] : [];
    },
  };
}
