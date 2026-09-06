import { afterEach, describe, expect, it } from 'vitest';
import { syncViewport } from './viewport';

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
  document.documentElement.style.removeProperty('--app-height');
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
  });

  it('sizes the shell when both layout and visual viewports shrink', () => {
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

  it('uses the visible viewport even without a focused editor', () => {
    syncViewport();
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: window.innerHeight - 120, offsetTop: 0, scale: 1 },
    });

    syncViewport();

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe(`${window.innerHeight - 120}px`);
  });

  it('does not expand the shell on blur before the keyboard has closed', () => {
    syncViewport();
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    textarea.focus();
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: window.innerHeight - 260, offsetTop: 0, scale: 1 },
    });
    syncViewport();

    textarea.blur();
    syncViewport();

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe(`${window.innerHeight - 260}px`);
  });

  it('does not reflow the shell during pinch zoom', () => {
    syncViewport();
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: window.innerHeight / 2, offsetTop: 96, scale: 2 },
    });

    syncViewport();

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe(`${window.innerHeight}px`);
  });

  it('falls back to the window height without VisualViewport', () => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });

    syncViewport();

    expect(document.documentElement.style.getPropertyValue('--app-height')).toBe(`${window.innerHeight}px`);
  });
});