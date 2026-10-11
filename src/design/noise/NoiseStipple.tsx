import { useEffect, useRef } from 'react';
import { drawStippleFrame, layoutStipple, stippleTime, type StipplePoint } from './stipple';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const MAX_PIXEL_RATIO = 2;

/**
 * Animated Perlin stipple field (the noise-animation demo at its default settings, without
 * displacement or ripples). Fills its positioned parent; decorative, so it is hidden from assistive
 * technology — the parent carries the accessible label. Animation pauses while off-screen and
 * renders a single still frame when the user prefers reduced motion.
 */
export function NoiseStipple({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let width = 0;
    let height = 0;
    let points: StipplePoint[] = [];
    let colors = { background: '', dot: '' };
    let frame = 0;
    let startedAt = 0;
    let visible = true;
    const motion = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_MOTION) : null;
    const reduced = () => motion?.matches === true;

    const readColors = () => {
      const style = getComputedStyle(canvas);
      colors = {
        background: style.getPropertyValue('--color-noise-bg').trim() || 'black',
        dot: style.getPropertyValue('--color-noise-dot').trim() || 'white',
      };
    };

    const paint = (now: number) => {
      if (!width || !height) return;
      drawStippleFrame(ctx, points, width, height, reduced() ? stippleTime(0) : stippleTime(now - startedAt), colors);
    };

    const tick = (now: number) => {
      frame = 0;
      paint(now);
      schedule();
    };

    const schedule = () => {
      if (frame || !visible || reduced() || !width || !height) return;
      frame = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };

    const resize = (nextWidth: number, nextHeight: number) => {
      if (nextWidth === width && nextHeight === height) return;
      width = nextWidth;
      height = nextHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      points = layoutStipple(width, height);
      readColors();
      paint(performance.now());
      schedule();
    };

    startedAt = performance.now();
    const rect = canvas.getBoundingClientRect();
    resize(rect.width, rect.height);

    const sizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(([entry]) => resize(entry.contentRect.width, entry.contentRect.height))
      : null;
    sizeObserver?.observe(canvas);

    const viewObserver = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
          if (visible) schedule();
          else stop();
        })
      : null;
    viewObserver?.observe(canvas);

    const onMotionChange = () => {
      stop();
      paint(performance.now());
      schedule();
    };
    motion?.addEventListener?.('change', onMotionChange);

    // Colors are theme tokens; repaint as soon as the theme attribute flips (even when still).
    const themeObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          readColors();
          paint(performance.now());
        })
      : null;
    themeObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });

    return () => {
      stop();
      sizeObserver?.disconnect();
      viewObserver?.disconnect();
      themeObserver?.disconnect();
      motion?.removeEventListener?.('change', onMotionChange);
    };
  }, []);

  return <canvas ref={canvasRef} className={`noise-stipple ${className}`.trim()} aria-hidden="true" />;
}
