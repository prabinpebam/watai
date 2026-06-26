import type { Message } from '../../lib/types';

/**
 * Stable total order for chat messages. The key is the message's *logical* creation time
 * (`createdAt`, preserved end-to-end as the wire `orderAt`), with the ULID `id` as a
 * deterministic tiebreaker. Because both keys are preserved verbatim across the sync boundary,
 * every device computes the SAME order — so chat chronology is consistent and never shifts when
 * a message finalizes or syncs late.
 */
export function compareChrono(a: Message, b: Message): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Merge the persisted messages with the in-flight run message (if it isn't persisted yet) and
 * return them in stable chronological order. The streaming response therefore stays in its
 * correct slot — anchored to when it started — even when a concurrent prompt arrives from
 * another device mid-stream, instead of being pinned to the end of the list.
 */
export function orderMessages(persisted: Message[], run?: Message | null): Message[] {
  const merged = run && !persisted.some((m) => m.id === run.id) ? [...persisted, run] : persisted;
  return [...merged].sort(compareChrono);
}
