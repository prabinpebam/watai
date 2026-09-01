import { afterEach, describe, expect, it } from 'vitest';
import { resetViewportBaseline, syncViewport } from './viewport';

const originalVisualViewport = window.visualViewport;
const originalInnerHeight = window.innerHeight;

afterEach(() => {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: originalVisualViewport,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: originalInnerHeight,
  });
  resetViewportBaseline();
  document.documentElement.style.removeProperty('--app-height');
  document.documentElement.removeAttribute('data-keyboard-open');
  document.body.replaceChildren();
});

describe('syncViewport', () => {
  it('maps the app shell to a focused editor visual viewport', () => {
    syncViewport();
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

  it('detects a keyboard when both layout and visual viewports shrink', () => {
    syncViewport();
    const keyboardHeight = 260;
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight - keyboardHeight,
    });
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: originalInnerHeight - keyboardHeight, offsetTop: 0, scale: 1 },
    });
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.focus();

    syncViewport();

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe(`${originalInnerHeight - keyboardHeight}px`);
    expect(document.documentElement.hasAttribute('data-keyboard-open')).toBe(true);
  });

  it('ignores Safari focus panning so the editor does not chase the viewport', () => {
    syncViewport();
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
    syncViewport();
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: window.innerHeight - 120, offsetTop: 0, scale: 1 },
    });

    syncViewport();

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe(`${window.innerHeight}px`);
    expect(document.documentElement.hasAttribute('data-keyboard-open')).toBe(false);
  });
});