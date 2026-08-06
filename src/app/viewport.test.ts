import { afterEach, describe, expect, it } from 'vitest';
import { syncViewport } from './viewport';

const originalVisualViewport = window.visualViewport;

afterEach(() => {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: originalVisualViewport,
  });
  document.documentElement.style.removeProperty('--app-height');
  document.documentElement.style.removeProperty('--keyboard-inset');
  document.body.replaceChildren();
});

describe('syncViewport', () => {
  it('keeps layout height and lifts focused editors above an overlay keyboard', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: window.innerHeight - 260, offsetTop: 0 },
    });
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.focus();

    syncViewport();

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe(`${window.innerHeight}px`);
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('260px');
  });

  it('does not treat browser chrome as a keyboard without a focused editor', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: window.innerHeight - 120, offsetTop: 0 },
    });

    syncViewport();

    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('0px');
  });
});