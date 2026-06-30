// Energy-based voice-activity detector — the dependency-free fallback engine (decision D1; the Silero
// model loads lazily on voice-mode entry and emits the same events). Frame-driven and pure: feed
// amplitude levels (0..1, from `readLevel(analyser)`) with timestamps and get `speechstart` /
// `speechend`. No timers, so it is deterministically unit-testable. `sensitivity` maps to the energy
// threshold (Settings → Voice → Mic sensitivity).

export type VadEvent = 'speechstart' | 'speechend';

export interface VadOptions {
  /** 0..1 — higher = more sensitive (lower energy threshold). Default 0.5. */
  sensitivity?: number;
  /** Trailing silence (ms) that ends a turn. Default 700. */
  silenceMs?: number;
  /** Minimum sustained energy (ms) before a turn starts — rejects blips. Default 150. */
  minSpeechMs?: number;
}

export interface Vad {
  /** Feed one amplitude frame (0..1) at time `nowMs`; returns the event it triggered, if any. */
  push(level: number, nowMs: number): VadEvent | null;
  reset(): void;
  readonly speaking: boolean;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export function createVad(opts: VadOptions = {}): Vad {
  const sensitivity = clamp01(opts.sensitivity ?? 0.5);
  // sensitivity 0 → 0.15 (hard to trigger); 1 → 0.02 (easy). readLevel() returns a 0..1 mean energy.
  const threshold = 0.02 + (1 - sensitivity) * 0.13;
  const silenceMs = opts.silenceMs ?? 700;
  const minSpeechMs = opts.minSpeechMs ?? 150;

  let speaking = false;
  let aboveSince: number | null = null;
  let belowSince: number | null = null;

  return {
    get speaking() {
      return speaking;
    },
    reset() {
      speaking = false;
      aboveSince = null;
      belowSince = null;
    },
    push(level, now) {
      const loud = level >= threshold;
      if (!speaking) {
        if (!loud) {
          aboveSince = null;
          return null;
        }
        if (aboveSince === null) aboveSince = now;
        if (now - aboveSince >= minSpeechMs) {
          speaking = true;
          aboveSince = null;
          belowSince = null;
          return 'speechstart';
        }
        return null;
      }
      // speaking
      if (loud) {
        belowSince = null;
        return null;
      }
      if (belowSince === null) belowSince = now;
      if (now - belowSince >= silenceMs) {
        speaking = false;
        aboveSince = null;
        belowSince = null;
        return 'speechend';
      }
      return null;
    },
  };
}
