// Serial text-to-speech player. `enqueue(text)` synthesizes a clip and plays queued clips back-to-back
// so a voice loop speaks sentence-by-sentence; `stop()` halts the current clip and clears the queue
// synchronously (< a frame) for snappy barge-in. The synth + clip are injected so the queue is pure
// and unit-testable; the real adapter wraps `cloudApi.synthesizeSpeech` → an <audio> element.
// (Gapless prefetch is a Phase-3 latency refinement layered on top of this contract.)

export interface TtsClip {
  /** Begin playback; resolves when the clip ends OR when `stop()` is called. */
  play(): Promise<void>;
  /** Halt immediately and release resources. */
  stop(): void;
}

export interface TtsQueueDeps {
  synthesize: (text: string) => Promise<TtsClip>;
  onPlayingChange?: (playing: boolean) => void;
}

export interface TtsQueue {
  enqueue(text: string): void;
  stop(): void;
  readonly playing: boolean;
}

export function createTtsQueue(deps: TtsQueueDeps): TtsQueue {
  const texts: string[] = [];
  let pumping = false;
  let stopped = false;
  let current: TtsClip | null = null;

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    stopped = false;
    deps.onPlayingChange?.(true);
    try {
      while (!stopped) {
        const text = texts.shift();
        if (text === undefined) break;
        const clip = await deps.synthesize(text);
        if (stopped) {
          clip.stop();
          break;
        }
        current = clip;
        await clip.play();
        current = null;
      }
    } finally {
      pumping = false;
      current = null;
      deps.onPlayingChange?.(false);
    }
  }

  return {
    get playing() {
      return pumping;
    },
    enqueue(text) {
      if (!text) return;
      texts.push(text);
      if (!pumping) void pump();
    },
    stop() {
      stopped = true;
      texts.length = 0;
      current?.stop();
      current = null;
      deps.onPlayingChange?.(false);
    },
  };
}
