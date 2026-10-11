import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoiseStipple } from './NoiseStipple';

function fakeContext() {
  return { fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), arc: vi.fn(), fill: vi.fn(), setTransform: vi.fn(), fillStyle: '' };
}

describe('NoiseStipple', () => {
  let ctx: ReturnType<typeof fakeContext>;
  let reduced = false;
  const raf = vi.fn((_cb: FrameRequestCallback) => 42);
  const caf = vi.fn();

  beforeEach(() => {
    ctx = fakeContext();
    reduced = false;
    raf.mockClear();
    caf.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ctx as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 200, height: 100 } as DOMRect);
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is decorative, paints immediately and animates until unmounted', () => {
    const { container, unmount } = render(<NoiseStipple />);
    const canvas = container.querySelector('canvas.noise-stipple');
    expect(canvas).toHaveAttribute('aria-hidden', 'true');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 200, 100);
    expect(ctx.fill).toHaveBeenCalledOnce();
    expect(raf).toHaveBeenCalledOnce();
    unmount();
    expect(caf).toHaveBeenCalledWith(42);
  });

  it('renders one still frame without animating when reduced motion is preferred', () => {
    reduced = true;
    render(<NoiseStipple />);
    expect(ctx.fill).toHaveBeenCalledOnce();
    expect(raf).not.toHaveBeenCalled();
  });

  it('does nothing when a 2D canvas context is unavailable', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    render(<NoiseStipple />);
    expect(raf).not.toHaveBeenCalled();
  });
});
