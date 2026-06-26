import { describe, it, expect } from 'vitest';
import { compareChrono, orderMessages } from './ordering';
import type { Message } from '../../lib/types';

function msg(id: string, role: 'user' | 'assistant', createdAt: string): Message {
  return { id, threadId: 't', role, content: '', status: 'complete', createdAt };
}

describe('chat ordering', () => {
  it('places a streaming response by its start time, not last, when a concurrent prompt arrives', () => {
    const u1 = msg('a-u1', 'user', '2026-01-01T00:00:00.000Z');
    const u2 = msg('z-u2', 'user', '2026-01-01T00:00:05.000Z'); // pulled from another device mid-stream
    const a1 = msg('b-a1', 'assistant', '2026-01-01T00:00:00.100Z'); // in-flight, started right after u1
    expect(orderMessages([u1, u2], a1).map((m) => m.id)).toEqual(['a-u1', 'b-a1', 'z-u2']);
  });

  it('is a stable total order by (createdAt, id)', () => {
    const a = msg('id-b', 'user', '2026-01-01T00:00:00.000Z');
    const b = msg('id-a', 'assistant', '2026-01-01T00:00:00.000Z'); // same time -> id tiebreak
    expect([a, b].sort(compareChrono).map((m) => m.id)).toEqual(['id-a', 'id-b']);
  });

  it('does not duplicate the run message once it is persisted', () => {
    const u1 = msg('u1', 'user', '2026-01-01T00:00:00.000Z');
    const a1 = msg('a1', 'assistant', '2026-01-01T00:00:00.100Z');
    expect(orderMessages([u1, a1], a1).filter((m) => m.id === 'a1').length).toBe(1);
  });

  it('returns persisted as-is (sorted) when there is no run', () => {
    const u1 = msg('u1', 'user', '2026-01-01T00:00:00.000Z');
    const a1 = msg('a1', 'assistant', '2026-01-01T00:00:00.100Z');
    expect(orderMessages([a1, u1], null).map((m) => m.id)).toEqual(['u1', 'a1']);
  });
});
