import { describe, it, expect } from 'vitest';
import {
  parseImageCreateInput,
  isActiveImage,
  isTerminalImage,
  canTransitionImage,
  dimsForSize,
} from './imageGen';
import { AppError } from './errors';

describe('imageGen domain', () => {
  it('parses a minimal create input', () => {
    const out = parseImageCreateInput({ prompt: '  a red fox  ' });
    expect(out.prompt).toBe('a red fox');
    expect(out.size).toBeUndefined();
  });

  it('accepts size, count, quality and remix lineage', () => {
    const out = parseImageCreateInput({
      prompt: 'p',
      size: '1024x1536',
      count: 3,
      quality: 'high',
      sourceImageId: 'img1',
      useReference: true,
    });
    expect(out).toMatchObject({ size: '1024x1536', count: 3, quality: 'high', sourceImageId: 'img1', useReference: true });
  });

  it('rejects an empty prompt', () => {
    expect(() => parseImageCreateInput({ prompt: '   ' })).toThrow(AppError);
  });

  it('rejects an invalid size and out-of-range count', () => {
    expect(() => parseImageCreateInput({ prompt: 'p', size: '512x512' })).toThrow(AppError);
    expect(() => parseImageCreateInput({ prompt: 'p', count: 5 })).toThrow(AppError);
    expect(() => parseImageCreateInput({ prompt: 'p', count: 0 })).toThrow(AppError);
  });

  it('rejects unknown fields', () => {
    expect(() => parseImageCreateInput({ prompt: 'p', foo: 1 })).toThrow(AppError);
  });

  it('classifies lifecycle status', () => {
    expect(isActiveImage('queued')).toBe(true);
    expect(isActiveImage('generating')).toBe(true);
    expect(isActiveImage('ready')).toBe(false);
    expect(isTerminalImage('ready')).toBe(true);
    expect(isTerminalImage('error')).toBe(true);
    expect(isTerminalImage('queued')).toBe(false);
  });

  it('only allows forward transitions', () => {
    expect(canTransitionImage('queued', 'generating')).toBe(true);
    expect(canTransitionImage('generating', 'ready')).toBe(true);
    expect(canTransitionImage('queued', 'ready')).toBe(false);
    expect(canTransitionImage('ready', 'generating')).toBe(false);
  });

  it('derives pixel dims (defaulting to square)', () => {
    expect(dimsForSize('1536x1024')).toEqual({ width: 1536, height: 1024 });
    expect(dimsForSize('weird')).toEqual({ width: 1024, height: 1024 });
  });
});
