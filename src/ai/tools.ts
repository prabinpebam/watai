// Client-side tool registry (Path C). The model decides to call a tool by reading the
// conversation; the browser executes it and returns a short result to the model, while any
// produced image is surfaced to the UI. generate_image works on a plain Azure OpenAI
// endpoint (it wraps the existing /images/generations client), so the intent-aware image
// flow needs no Foundry project. See documentation/agentic/03-agentic-chat-and-tools.md §5.
import { generateImage } from './image';
import type { ResponsesTool } from './responses';
import type { ToolResult } from './orchestrator';

const IMAGE_SIZES = ['1024x1024', '1024x1536', '1536x1024'] as const;

export const generateImageTool: ResponsesTool = {
  type: 'function',
  name: 'generate_image',
  description:
    'Generate an image. Call this when the user asks to create, draw, make, or generate an ' +
    'image or picture — including when they refer to earlier conversation (e.g. "based on what ' +
    'we discussed, generate an image of a cat"). Read the conversation and write a detailed, ' +
    'self-contained prompt that captures their intent.',
  parameters: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description:
          'A detailed, self-contained image description that folds in the relevant conversation context.',
      },
      size: {
        type: 'string',
        enum: [...IMAGE_SIZES],
        description: 'Aspect ratio. 1024x1024 square, 1024x1536 portrait, 1536x1024 landscape.',
      },
    },
    required: ['prompt'],
  },
};

/** The default tool set offered in agentic chat. */
export const CHAT_TOOLS: ResponsesTool[] = [generateImageTool];

/** Execute a client-side tool call the model emitted. */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case 'generate_image': {
      const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
      if (!prompt) return { output: 'No prompt was provided, so no image was generated.' };
      const size = (IMAGE_SIZES as readonly string[]).includes(args.size as string)
        ? (args.size as string)
        : '1024x1024';
      const images = await generateImage({ prompt, size });
      const b64 = images[0]?.b64;
      if (!b64) return { output: 'Image generation returned no image.' };
      return { output: 'Image generated and shown to the user.', image: { b64, prompt, size } };
    }
    default:
      return { output: `Unknown tool: ${name}` };
  }
}
