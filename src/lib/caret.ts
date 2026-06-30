// Caret-safe text insertion for dictation. Splices a transcript into a field at the caret/selection
// without clobbering text on either side, adding a separating space only where one is needed (and
// never before punctuation). Returns the new value and where the caret should land (right after the
// inserted text). Pure + deterministic — unit-tested. Used by the composer's dictation (V-14).

export interface CaretInsert {
  value: string;
  caret: number;
}

export function insertAtCaret(value: string, start: number, end: number, insert: string): CaretInsert {
  const s = Math.max(0, Math.min(start, value.length));
  const e = Math.max(s, Math.min(end, value.length));
  const before = value.slice(0, s);
  const after = value.slice(e);

  const lead = before && !/\s$/.test(before) && !/^\s/.test(insert) ? ' ' : '';
  const trail = after && /^[A-Za-z0-9]/.test(after) && !/\s$/.test(insert) ? ' ' : '';

  const value2 = before + lead + insert + trail + after;
  const caret = before.length + lead.length + insert.length;
  return { value: value2, caret };
}
