const SILENT_WAV = 'data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQEAAACA';

export function createAudioElement(): HTMLAudioElement {
  const audio = new Audio();
  audio.setAttribute('playsinline', '');
  audio.preload = 'auto';
  return audio;
}

/** Prime one media element synchronously inside a tap so iOS permits delayed playback on it. */
export function primeAudioElement(audio: HTMLAudioElement): void {
  audio.muted = true;
  audio.src = SILENT_WAV;
  const priming = audio.play();
  void priming.then(() => {
    if (audio.src === SILENT_WAV) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
  }).catch(() => undefined);
}

export function playAudioSource(audio: HTMLAudioElement, source: string): Promise<void> {
  audio.pause();
  audio.muted = false;
  audio.src = source;
  audio.load();
  return audio.play();
}