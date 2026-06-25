// Client-side image tool (Path C). Wraps the plain Image API (/images/generations) so the
// intent-aware image flow works on ANY endpoint — no Foundry project required (08 §0 D1).
// The chat model writes the detailed prompt in-loop; we record it as provenance.
import { generateImage as defaultGenerate, editImage as defaultEdit } from '../image';
import { getApiConfig as defaultGetConfig } from '../../data/secureStore';
import type { ResponsesTool } from '../responses';
import type { ToolResult } from '../orchestrator';

const IMAGE_SIZES = ['1024x1024', '1024x1536', '1536x1024'] as const;
const IMAGE_QUALITIES = ['low', 'medium', 'high'] as const;
type Quality = (typeof IMAGE_QUALITIES)[number];

export const generateImageTool: ResponsesTool = {
  type: 'function',
  name: 'generate_image',
  description:
    'Generate an image. Call this when the user asks to create, draw, make, or generate an ' +
    'image or picture — including when they refer to earlier conversation (e.g. "based on what ' +
    'we discussed, generate an image of a cat"). Read the conversation and write a detailed, ' +
    'self-contained prompt that captures their intent. If the user uploaded an image and wants ' +
    'it transformed, edited, restyled, or used as the visual reference, set edit_reference to true.',
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
      quality: {
        type: 'string',
        enum: [...IMAGE_QUALITIES],
        description: 'Rendering quality. Higher is slower; defaults to medium.',
      },
      edit_reference: {
        type: 'boolean',
        description:
          'Set true to transform/restyle the image the user just uploaded (use it as the visual ' +
          'reference) instead of generating from scratch. Only honored when an uploaded image exists.',
      },
    },
    required: ['prompt'],
  },
};

interface Deps {
  generate?: typeof defaultGenerate;
  edit?: typeof defaultEdit;
  getConfig?: typeof defaultGetConfig;
}

/** Per-run context the registry injects (e.g. the user's latest uploaded image). */
export interface ImageToolContext {
  referenceImage?: Blob | null;
}

/** Execute generate_image. `deps` is injectable for tests; the registry binds the real ones. */
export async function runGenerateImage(
  args: Record<string, unknown>,
  deps: Deps = {},
  ctx: ImageToolContext = {},
): Promise<ToolResult> {
  const generate = deps.generate ?? defaultGenerate;
  const edit = deps.edit ?? defaultEdit;
  const getConfig = deps.getConfig ?? defaultGetConfig;

  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  if (!prompt) return { output: 'No prompt was provided, so no image was generated.' };

  const size = (IMAGE_SIZES as readonly string[]).includes(args.size as string)
    ? (args.size as string)
    : '1024x1024';
  const quality: Quality = (IMAGE_QUALITIES as readonly string[]).includes(args.quality as string)
    ? (args.quality as Quality)
    : 'medium';

  const useReference = args.edit_reference === true && !!ctx.referenceImage;
  const config = await getConfig();
  const images = useReference
    ? await edit({ prompt, image: ctx.referenceImage!, size, quality })
    : await generate({ prompt, size, quality });
  const b64 = images[0]?.b64;
  if (!b64) return { output: 'Image generation returned no image.' };

  return {
    output: useReference
      ? 'Image edited from the reference and shown to the user.'
      : 'Image generated and shown to the user.',
    image: { b64, prompt, size, expandedPrompt: prompt, model: config?.models.image },
  };
}
