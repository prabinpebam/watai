import { z } from 'zod';
import { parseOrThrow } from './validate';

/** Image-generation lifecycle. `queued`/`generating` are active; `ready`/`error` are terminal. */
export type ImageStatus = 'queued' | 'generating' | 'ready' | 'error';

export interface ImageError {
  code: string;
  message: string;
}

/** Supported output sizes (gpt-image). The aspect ratio drives the gallery card box. */
export const IMAGE_SIZES = ['1024x1024', '1024x1536', '1536x1024'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export const IMAGE_QUALITIES = ['low', 'medium', 'high'] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

const TERMINAL: readonly ImageStatus[] = ['ready', 'error'];

export function isTerminalImage(s: ImageStatus): boolean {
  return TERMINAL.includes(s);
}

/** Active = the worker may still pick it up / is processing it. */
export function isActiveImage(s: ImageStatus): boolean {
  return s === 'queued' || s === 'generating';
}

const ALLOWED: Record<ImageStatus, readonly ImageStatus[]> = {
  queued: ['generating', 'error'],
  generating: ['ready', 'error'],
  ready: [],
  error: [],
};

export function canTransitionImage(from: ImageStatus, to: ImageStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** Input to create images: a prompt plus optional size / count / quality and remix lineage. */
const imageCreateSchema = z
  .object({
    prompt: z.string().trim().min(1, 'A prompt is required.').max(32_000),
    size: z.enum(IMAGE_SIZES).optional(),
    count: z.number().int().min(1).max(4).optional(),
    quality: z.enum(IMAGE_QUALITIES).optional(),
    /** Remix lineage: generate from an existing image of the caller's. */
    sourceImageId: z.string().min(1).max(64).optional(),
    /** When remixing, use the source image as an edit reference (image-to-image). */
    useReference: z.boolean().optional(),
  })
  .strict();

export type ImageCreateInput = z.infer<typeof imageCreateSchema>;

export function parseImageCreateInput(input: unknown): ImageCreateInput {
  return parseOrThrow(imageCreateSchema, input, 'Invalid image request.');
}

/** Pixel dimensions for a size string (defaults to square on anything unexpected). */
export function dimsForSize(size: string): { width: number; height: number } {
  const [w, h] = size.split('x').map((n) => Number.parseInt(n, 10));
  return Number.isFinite(w) && Number.isFinite(h) ? { width: w, height: h } : { width: 1024, height: 1024 };
}
