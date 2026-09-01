import { afterEach, describe, expect, it } from 'vitest';
import { syncViewport } from './viewport';

const originalVisualViewport = window.visualViewport;

afterEach(() => {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: originalVisualViewport,
  });
  document.documentElement.style.removeProperty('--app-height');
  document.documentElement.removeAttribute('data-keyboard-open');
  document.body.replaceChildren();
});

describe('syncViewport', () => {
  it('maps the app shell to a focused editor visual viewport', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: window.innerHeight - 260, offsetTop: 0, scale: 1 },
    });
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.focus();

    syncViewport();

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe(`${window.innerHeight - 260}px`);
    expect(document.documentElement.hasAttribute('data-keyboard-open')).toBe(true);
  });

  it('ignores Safari focus panning so the editor does not chase the viewport', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: window.innerHeight - 260, offsetTop: 96, scale: 1 },
    });
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.focus();

    syncViewport();

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe(`${window.innerHeight - 260}px`);
    expect(document.documentElement.style.getPropertyValue('--app-top')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--keyboard-inset')).toBe('');
  });

  it('does not treat browser chrome as a keyboard without a focused editor', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: window.innerHeight - 120, offsetTop: 0, scale: 1 },
    });

    syncViewport();

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe(`${window.innerHeight}px`);
    expect(document.documentElement.hasAttribute('data-keyboard-open')).toBe(false);
  });
});