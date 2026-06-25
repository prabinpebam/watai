import type { ChatParams, ChatStreamEvent } from './chat';
import type { AgentEvent } from './orchestrator';
import type { Message } from '../lib/types';

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A scripted agentic stream for mock/offline dev: demonstrates image generation, web-search
 * grounding with citations, or a plain answer, so the full agentic UI (tool cards, sources)
 * is exercisable without a real endpoint.
 */
export async function* mockAgentStream(history: Message[]): AsyncGenerator<AgentEvent> {
  const last = history[history.length - 1]?.content ?? '';
  const wantsImage = /\b(image|images|draw|drawing|picture|logo|illustrat|render|art)\b/i.test(last);
  const wantsSearch = /\b(search|web|news|latest|today|current|recent|happening|trend)\b/i.test(last);

  async function* emit(text: string): AsyncGenerator<AgentEvent> {
    for (const tok of tokenize(text)) {
      await sleep(14);
      yield { type: 'text', delta: tok };
    }
  }

  if (wantsImage) {
    yield { type: 'tool', name: 'generate_image', status: 'running', callId: 'mock-img', args: { size: '1024x1024' } };
    yield* emit('Here is a mock image based on your request.\n\n');
    await sleep(600);
    const [{ b64 }] = await mockGenerateImage();
    yield {
      type: 'image',
      b64,
      partial: false,
      callId: 'mock-img',
      prompt: last,
      size: '1024x1024',
      expandedPrompt: last,
      model: 'gpt-image (mock)',
    };
    yield { type: 'tool', name: 'generate_image', status: 'done', callId: 'mock-img' };
    yield { type: 'done' };
    return;
  }

  if (wantsSearch) {
    const query = last.slice(0, 48);
    yield { type: 'tool', name: 'web_search', status: 'running', callId: 'mock-ws', detail: query };
    await sleep(450);
    yield {
      type: 'citation',
      citation: { source: 'web', url: 'https://learn.microsoft.com/azure/ai-foundry/', title: 'Azure AI Foundry documentation' },
    };
    yield {
      type: 'citation',
      citation: { source: 'web', url: 'https://react.dev/blog', title: 'React Blog' },
    };
    yield { type: 'tool', name: 'web_search', status: 'done', callId: 'mock-ws', detail: query };
    yield* emit(
      'Based on a quick web search, here is a grounded, **mock** answer with clickable sources below. Toggle off mock mode to use your real endpoint.',
    );
    yield { type: 'done' };
    return;
  }

  const intro = last ? `You asked: "${last.slice(0, 80)}"\n\n` : '';
  yield* emit(intro + SAMPLE);
  yield { type: 'done' };
}
