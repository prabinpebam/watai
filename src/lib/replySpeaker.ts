// The voice-reply pipeline: turns a growing (streaming) assistant reply into spoken sentences.
// It feeds the prefix-stable sentence splitter, cleans each *completed* sentence with speakableText
// (so code blocks / tables / markup never reach the synthesizer), and hands the result to `enqueue`
// (the TTS queue). Kept pure and injectable so the streaming→speech contract is unit-testable without
// a browser, an <audio> element, or the run store.
import { createSentenceStream } from './sentences';
import { speakableText } from './speakable';

export interface ReplySpeaker {
  /** Feed the latest full (prefix-stable) assistant text; enqueues any newly completed sentences. */
  push(fullText: string): void;
  /** Emit the trailing (unterminated) sentence as a final clip — call once when the reply ends. */
  flush(): void;
}

export function createReplySpeaker(enqueue: (text: string) => void): ReplySpeaker {
  const stream = createSentenceStream();
  const emit = (sentences: string[]) => {
    for (const sentence of sentences) {
      const spoken = speakableText(sentence).trim();
      if (spoken) enqueue(spoken);
    }
  };
  return {
    push: (fullText) => emit(stream.push(fullText)),
    flush: () => emit(stream.flush()),
  };
}
