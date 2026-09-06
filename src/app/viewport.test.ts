import { afterEach, describe, expect, it, vi } from 'vitest';
import { installViewportSync, syncViewport } from './viewport';

const originalVisualViewport = window.visualViewport;
const originalInnerHeight = window.innerHeight;
let uninstall: (() => void) | undefined;

afterEach(() => {
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: originalVisualViewport,
  });
  uninstall?.();
  uninstall = undefined;
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: originalInnerHeight,
  });
  document.documentElement.style.removeProperty('--app-height');
  document.body.replaceChildren();
});

function touch(target: Element, type: string, clientY: number, count = 1, clientX = 100): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', {
    value: Array.from({ length: count }, (_, identifier) => ({ identifier, clientX, clientY })),
  });
  target.dispatchEvent(event);
  return event;
}

describe('viewport touch containment', () => {
  it('prevents dragging non-scrollable chrome from panning the document', () => {
    uninstall = installViewportSync();
    const header = document.createElement('header');
    document.body.append(header);
    touch(header, 'touchstart', 100);

    expect(touch(header, 'touchmove', 50).defaultPrevented).toBe(true);
  });

  it('allows history scrolling but stops outward drags at either edge', () => {
    uninstall = installViewportSync();
    const scroller = document.createElement('div');
    scroller.style.overflowY = 'auto';
    Object.defineProperties(scroller, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 300 },
    });
    document.body.append(scroller);

    touch(scroller, 'touchstart', 100);
    expect(touch(scroller, 'touchmove', 150).defaultPrevented).toBe(true);
    expect(touch(scroller, 'touchmove', 100).defaultPrevented).toBe(false);

    scroller.scrollTop = 700;
    touch(scroller, 'touchstart', 100);
    expect(touch(scroller, 'touchmove', 50).defaultPrevented).toBe(true);
    expect(touch(scroller, 'touchmove', 100).defaultPrevented).toBe(false);
  });

  it('does not block pinch zoom or panning a zoomed viewport', () => {
    uninstall = installViewportSync();
    touch(document.body, 'touchstart', 100, 2);
    expect(touch(document.body, 'touchmove', 50, 2).defaultPrevented).toBe(false);
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { height: 400, offsetTop: 0, scale: 2 },
    });
    touch(document.body, 'touchstart', 100);
    expect(touch(document.body, 'touchmove', 50).defaultPrevented).toBe(false);
  });

  it('removes touch handlers on cleanup', () => {
    installViewportSync()();
    touch(document.body, 'touchstart', 100);
    expect(touch(document.body, 'touchmove', 50).defaultPrevented).toBe(false);
  });

  it('keeps textarea selection handles and range sliders usable', () => {
    uninstall = installViewportSync();
    const textarea = document.createElement('textarea');
    textarea.value = 'Select this text';
    const slider = document.createElement('input');
    slider.type = 'range';
    document.body.append(textarea, slider);
    textarea.focus();
    textarea.setSelectionRange(0, 6);
    touch(textarea, 'touchstart', 100);
    expect(touch(textarea, 'touchmove', 50).defaultPrevented).toBe(false);
    touch(slider, 'touchstart', 100);
    expect(touch(slider, 'touchmove', 50).defaultPrevented).toBe(false);
  });

  it('contains an overflowing textarea before its outer scroller', () => {
    uninstall = installViewportSync();
    const outer = document.createElement('div');
    const textarea = document.createElement('textarea');
    for (const element of [outer, textarea]) {
      element.style.overflowY = 'auto';
      Object.defineProperties(element, {
        scrollHeight: { value: 1000 }, clientHeight: { value: 300 },
      });
    }
    outer.append(textarea);
    document.body.append(outer);
    outer.scrollTop = 300;
    touch(textarea, 'touchstart', 100);
    expect(touch(textarea, 'touchmove', 150).defaultPrevented).toBe(true);
    textarea.scrollTop = 200;
    touch(textarea, 'touchstart', 100);
    expect(touch(textarea, 'touchmove', 50).defaultPrevented).toBe(false);
  });

  it('allows horizontal code scrolling without letting vertical drags escape', () => {
    uninstall = installViewportSync();
    const code = document.createElement('pre');
    code.style.overflowX = 'auto';
    Object.defineProperties(code, {
      scrollWidth: { value: 1000 }, clientWidth: { value: 300 },
    });
    document.body.append(code);
    touch(code, 'touchstart', 100);
    expect(touch(code, 'touchmove', 100, 1, 50).defaultPrevented).toBe(false);
    touch(code, 'touchstart', 100);
    expect(touch(code, 'touchmove', 50).defaultPrevented).toBe(true);
  });
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