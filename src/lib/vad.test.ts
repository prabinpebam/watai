import { describe, it, expect } from 'vitest';
import { createVad } from './vad';

describe('createVad (energy endpointing)', () => {
  it('emits speechstart only after sustained energy ≥ minSpeechMs', () => {
    const vad = createVad({ sensitivity: 0.5, minSpeechMs: 150, silenceMs: 700 });
    expect(vad.push(0.3, 0)).toBeNull(); // above threshold, but not sustained yet
    expect(vad.push(0.3, 100)).toBeNull(); // 100ms < 150ms
    expect(vad.push(0.3, 160)).toBe('speechstart'); // sustained ≥ 150ms
    expect(vad.speaking).toBe(true);
  });

  it('ignores a short blip below minSpeechMs', () => {
    const vad = createVad({ minSpeechMs: 150 });
    expect(vad.push(0.3, 0)).toBeNull();
    expect(vad.push(0.0, 50)).toBeNull(); // drops below → resets the start candidate
    expect(vad.push(0.3, 100)).toBeNull();
    expect(vad.push(0.0, 130)).toBeNull();
    expect(vad.speaking).toBe(false);
  });

  it('emits speechend after silenceMs of trailing silence', () => {
    const vad = createVad({ sensitivity: 0.5, minSpeechMs: 150, silenceMs: 700 });
    vad.push(0.3, 0);
    vad.push(0.3, 200); // speechstart by now
    expect(vad.speaking).toBe(true);
    expect(vad.push(0.0, 300)).toBeNull(); // silence begins
    expect(vad.push(0.0, 900)).toBeNull(); // 600ms < 700ms
    expect(vad.push(0.0, 1001)).toBe('speechend'); // 701ms ≥ 700ms
    expect(vad.speaking).toBe(false);
  });

  it('a loud frame resets the trailing-silence timer (does not endpoint mid-utterance)', () => {
    const vad = createVad({ minSpeechMs: 0, silenceMs: 700 });
    vad.push(0.3, 0); // speechstart (minSpeech 0)
    expect(vad.speaking).toBe(true);
    vad.push(0.0, 100); // silence start = 100
    vad.push(0.3, 300); // loud again → reset
    vad.push(0.0, 400); // silence start = 400
    expect(vad.push(0.0, 950)).toBeNull(); // 550ms < 700ms
    expect(vad.push(0.0, 1101)).toBe('speechend'); // 701ms from 400
  });

  it('sensitivity changes the energy threshold', () => {
    const high = createVad({ sensitivity: 1, minSpeechMs: 0 }); // low threshold → easy to trigger
    expect(high.push(0.05, 0)).toBe('speechstart');
    const low = createVad({ sensitivity: 0, minSpeechMs: 0 }); // high threshold → quiet ignored
    expect(low.push(0.05, 0)).toBeNull();
  });

  it('never emits speechend without a prior speechstart', () => {
    const vad = createVad();
    expect(vad.push(0.0, 0)).toBeNull();
    expect(vad.push(0.0, 5000)).toBeNull();
    expect(vad.speaking).toBe(false);
  });
});
