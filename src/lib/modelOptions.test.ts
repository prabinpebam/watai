import { describe, expect, it } from 'vitest';
import { AUTO_CHAT_MODEL, chatModelLabel, chatModelOverride, normalizeChatModelOptions } from './modelOptions';

describe('modelOptions', () => {
  it('labels model-router as Auto', () => {
    expect(chatModelLabel(AUTO_CHAT_MODEL)).toBe('Auto');
    expect(chatModelLabel('gpt-5.4')).toBe('gpt-5.4');
  });

  it('dedupes starter, default, and custom options', () => {
    expect(normalizeChatModelOptions('gpt-5.4', ['gpt-5.4', 'gpt-6'])).toEqual([
      'model-router',
      'gpt-5.4',
      'gpt-6',
    ]);
  });

  it('omits the per-run override for Auto but preserves explicit model choices', () => {
    expect(chatModelOverride(AUTO_CHAT_MODEL)).toBeUndefined();
    expect(chatModelOverride('')).toBeUndefined();
    expect(chatModelOverride('gpt-5.4')).toBe('gpt-5.4');
  });
});