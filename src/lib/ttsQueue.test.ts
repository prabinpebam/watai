import { describe, it, expect, vi } from 'vitest';
import { createTtsQueue, type TtsClip } from './ttsQueue';

/** A controllable fake: each clip's playback resolves only when the test says so (or on stop). */
function harness() {
  const events: string[] = [];
  const resolvers = new Map<string, () => void>();
  const synthesize = vi.fn(async (text: string): Promise<TtsClip> => {
    events.push(`synth:${text}`);
    let resolvePlay!: () => void;
    const done = new Promise<void>((r) => (resolvePlay = r));
    resolvers.set(text, resolvePlay);
    return {
      play: () => {
        events.push(`play:${text}`);
        return done;
      },
      stop: () => {
        events.push(`stop:${text}`);
        resolvePlay();
      },
    };
  });
  const finishPlay = async (text: string) => {
    resolvers.get(text)!();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { events, synthesize, finishPlay };
}

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('createTtsQueue', () => {
  it('synthesizes and plays clips in enqueue order', async () => {
    const h = harness();
    const q = createTtsQueue({ synthesize: h.synthesize });
    q.enqueue('a');
    q.enqueue('b');
    await tick();
    expect(h.events).toEqual(['synth:a', 'play:a']); // b waits until a finishes
    await h.finishPlay('a');
    await tick();
    await h.finishPlay('b');
    await tick();
    expect(h.events).toEqual(['synth:a', 'play:a', 'synth:b', 'play:b']);
  });

  it('stop() halts the current clip, clears the queue, and synthesizes nothing more', async () => {
    const h = harness();
    const q = createTtsQueue({ synthesize: h.synthesize });
    q.enqueue('a');
    q.enqueue('b');
    q.enqueue('c');
    await tick();
    expect(h.events).toEqual(['synth:a', 'play:a']);
    q.stop(); // synchronous — no await
    expect(h.events).toContain('stop:a');
    await tick();
    expect(h.synthesize).toHaveBeenCalledTimes(1); // b and c never synthesized
    expect(h.events).not.toContain('synth:b');
  });

  it('reports playing state on start and drain', async () => {
    const h = harness();
    const states: boolean[] = [];
    const q = createTtsQueue({ synthesize: h.synthesize, onPlayingChange: (p) => states.push(p) });
    expect(q.playing).toBe(false);
    q.enqueue('a');
    await tick();
    expect(q.playing).toBe(true);
    await h.finishPlay('a');
    await tick();
    expect(q.playing).toBe(false);
    expect(states).toEqual([true, false]);
  });

  it('ignores empty text', async () => {
    const h = harness();
    const q = createTtsQueue({ synthesize: h.synthesize });
    q.enqueue('');
    await tick();
    expect(h.synthesize).not.toHaveBeenCalled();
  });
});
