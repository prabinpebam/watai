import { describe, expect, it, vi } from 'vitest';
import { playAudioSource, primeAudioElement } from './audioPlayback';

function fakeAudio() {
  return {
    muted: false,
    preload: '',
    src: '',
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    load: vi.fn(),
  } as unknown as HTMLAudioElement;
}

describe('audio playback', () => {
  it('primes during the gesture and later reuses the same element for real audio', async () => {
    const audio = fakeAudio();

    primeAudioElement(audio);

    expect(audio.muted).toBe(true);
    expect(audio.play).toHaveBeenCalledTimes(1);

    await playAudioSource(audio, 'blob:reply');

    expect(audio.pause).toHaveBeenCalled();
    expect(audio.muted).toBe(false);
    expect(audio.src).toBe('blob:reply');
    expect(audio.load).toHaveBeenCalled();
    expect(audio.play).toHaveBeenCalledTimes(2);
  });
});