import type { ChatParams, ChatStreamEvent } from './chat';

const SAMPLE = `Sure — here's a quick overview.

## Key points

1. **Direct integration.** Watai calls your Azure OpenAI endpoint straight from the browser using your own key.
2. **Local-first storage.** Threads and images live in your browser via IndexedDB until a backend is wired up.
3. **Streaming.** Responses render token-by-token, and you can stop at any time.

\`\`\`ts
function greet(name: string) {
  return \`Hello, \${name}!\`;
}
\`\`\`

> This is mock output — no tokens were spent. Toggle off mock mode in the dev menu to use your real endpoint.`;

function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

/** Fake stream that emits a canned markdown response token-by-token. */
export async function* mockStreamChat(p: ChatParams): AsyncGenerator<ChatStreamEvent> {
  const last = p.messages[p.messages.length - 1]?.content ?? '';
  const intro = last ? `You asked: "${last.slice(0, 80)}"\n\n` : '';
  const tokens = tokenize(intro + SAMPLE);
  for (const tok of tokens) {
    if (p.signal?.aborted) {
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
    await new Promise((r) => setTimeout(r, 18));
    yield { type: 'delta', textDelta: tok };
  }
  yield {
    type: 'done',
    finishReason: 'stop',
    usage: { promptTokens: 42, completionTokens: tokens.length },
  };
}

export async function mockTranscribe(): Promise<{ text: string }> {
  await new Promise((r) => setTimeout(r, 600));
  return { text: 'This is a mock transcription of your spoken input.' };
}

// 1x1 gradient PNG placeholder (base64)
const PLACEHOLDER_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export async function mockGenerateImage(): Promise<Array<{ b64: string }>> {
  await new Promise((r) => setTimeout(r, 900));
  return [{ b64: PLACEHOLDER_PNG }];
}
