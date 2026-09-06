import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installViewportFrame } from './viewportFrame';

const originalViewport = window.visualViewport;
let viewport: EventTarget & { height: number; offsetTop: number; scale: number };
let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: originalViewport });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function geometry() {
  return {
    height: document.documentElement.style.getPropertyValue('--app-height'),
    top: document.documentElement.style.getPropertyValue('--viewport-top'),
  };
}

describe('visual viewport frame', () => {
  it('uses the visible rectangle on mount, even with the keyboard already open', () => {
    viewport.height = 440;
    viewport.offsetTop = 180;
    dispose = installViewportFrame();
    expect(geometry()).toEqual({ height: '440px', top: '180px' });
  });

  it('handles keyboard resize and focus panning in either event order', () => {
    dispose = installViewportFrame();
    viewport.offsetTop = 180;
    viewport.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
    expect(geometry()).toEqual({ height: '800px', top: '180px' });
    viewport.height = 440;
    viewport.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(20);
    expect(geometry()).toEqual({ height: '440px', top: '180px' });
    viewport.height = 800;
    viewport.dispatchEvent(new Event('resize'));
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
    expect(geometry()).toEqual({ height: '800px', top: '0px' });
  });

  it('coalesces events without postponing a pending frame', () => {
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame');
    dispose = installViewportFrame();
    for (let offset = 0; offset < 100; offset += 1) {
      viewport.offsetTop = offset;
      viewport.dispatchEvent(new Event('scroll'));
    }
    expect(requestFrame).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(20);
    expect(geometry().top).toBe('99px');
  });

  it('leaves pinch zoom and zoomed panning to the browser', () => {
    dispose = installViewportFrame();
    viewport.scale = 2;
    viewport.height = 400;
    viewport.offsetTop = 200;
    viewport.dispatchEvent(new Event('resize'));
    viewport.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
    expect(geometry()).toEqual({ height: '800px', top: '0px' });
    viewport.scale = 1;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(20);
    expect(geometry()).toEqual({ height: '400px', top: '0px' });
  });

  it('does not intercept touch gestures or programmatically scroll the page', () => {
    const listen = vi.spyOn(document, 'addEventListener');
    const scroll = vi.spyOn(window, 'scrollTo');
    dispose = installViewportFrame();
    expect(listen).not.toHaveBeenCalled();
    expect(scroll).not.toHaveBeenCalled();
  });

  it('falls back to the layout viewport without VisualViewport', () => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
    dispose = installViewportFrame();
    expect(geometry()).toEqual({ height: `${window.innerHeight}px`, top: '0px' });
  });

  it('removes listeners and cancels pending updates on disposal', () => {
    const remove = installViewportFrame();
    viewport.dispatchEvent(new Event('resize'));
    remove();
    viewport.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(20);
    expect(geometry()).toEqual({ height: '', top: '' });
  });
});