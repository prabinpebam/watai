import { describe, expect, it } from 'vitest';
import { renderMemoryProfile } from './memoryProfile';
import { parseMemoryRecord, type MemoryRecord } from './memory';

function rec(over: Partial<MemoryRecord> & { id: string; text: string }): MemoryRecord {
  return parseMemoryRecord({
    userId: 'userA',
    kind: 'fact',
    status: 'active',
    confidence: 0.9,
    salience: 0.7,
    pinned: false,
    sensitive: false,
    visibility: 'normal',
    useCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }],
    ...over,
  });
}

const NOW = '2026-01-02T00:00:00Z';

describe('renderMemoryProfile', () => {
  it('groups by kind and orders facts by salience', () => {
    const out = renderMemoryProfile(
      [
        rec({ id: 'f1', kind: 'fact', text: 'User name is Prabin.', salience: 0.95 }),
        rec({ id: 'f2', kind: 'fact', text: 'User lives in Bengaluru.', salience: 0.6 }),
        rec({ id: 'i1', kind: 'instruction', text: 'Always reply in British English.' }),
        rec({ id: 'av1', kind: 'avoidance', text: 'Never use emojis.' }),
      ],
      NOW,
    );
    expect(out).toContain('About the user:');
    expect(out).toContain('- User name is Prabin.');
    expect(out).toContain('Standing instructions:');
    expect(out).toContain('Avoid:');
    expect(out.indexOf('Prabin')).toBeLessThan(out.indexOf('Bengaluru'));
  });

  it('excludes sensitive, suppressed, and invalidated memories', () => {
    const out = renderMemoryProfile(
      [
        rec({ id: 'ok', kind: 'fact', text: 'User name is Prabin.' }),
        rec({ id: 's', kind: 'fact', text: 'User SSN reference.', sensitive: true }),
        rec({ id: 'sup', kind: 'fact', text: 'Suppressed detail.', status: 'suppressed' }),
        rec({ id: 'inv', kind: 'fact', text: 'Invalidated detail.', status: 'invalidated' }),
      ],
      NOW,
    );
    expect(out).toContain('Prabin');
    expect(out).not.toContain('SSN');
    expect(out).not.toContain('Suppressed');
    expect(out).not.toContain('Invalidated');
  });

  it('respects the character cap', () => {
    const memories = Array.from({ length: 50 }, (_, i) => rec({ id: `f${i}`, kind: 'fact', text: `Fact number ${i} about the user that is reasonably long.` }));
    const out = renderMemoryProfile(memories, NOW, { maxChars: 200 });
    expect(out.length).toBeLessThanOrEqual(200);
  });

  it('returns an empty string when there is nothing to show', () => {
    expect(renderMemoryProfile([], NOW)).toBe('');
    expect(renderMemoryProfile([rec({ id: 's', kind: 'fact', text: 'secret', sensitive: true })], NOW)).toBe('');
  });
});
