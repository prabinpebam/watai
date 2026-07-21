import { useEffect, useRef } from 'react';

interface WaveformVisualizerProps {
  /** Live mic analyser (from the recorder). When null, renders a calm idle baseline. */
  analyser: AnalyserNode | null;
  className?: string;
  /** Number of bars. */
  bars?: number;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Amplitude-reactive bar visualizer driven by the recorder's `AnalyserNode`. Used by composer
 * dictation (V-14) and voice mode (V-15). Honors `prefers-reduced-motion` by drawing a single static
 * frame instead of animating. Bar colour inherits the element's CSS `color`, so it themes correctly.
 */
export function WaveformVisualizer({ analyser, className = '', bars = 28 }: WaveformVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduce =
      typeof window !== 'undefined' &&
      (!!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
        getComputedStyle(document.documentElement).getPropertyValue('--motion-scale').trim() === '0');
    const freq = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;
    const color = getComputedStyle(canvas).color || '#888';
    let raf = 0;
    let lastFrame = -Infinity;

    const render = (now = 0) => {
      if (!reduce && now - lastFrame < 1000 / 30) {
        raf = requestAnimationFrame(render);
        return;
      }
      lastFrame = now;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) {
        raf = requestAnimationFrame(render);
        return;
      }
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;

      if (analyser && freq) analyser.getByteFrequencyData(freq);

      const gap = Math.max(1, w / bars / 4);
      const barW = Math.max(1, (w - gap * (bars - 1)) / bars);
      for (let i = 0; i < bars; i++) {
        let amp: number;
        if (analyser && freq) {
          const idx = Math.min(freq.length - 1, Math.floor((i / bars) * freq.length * 0.7));
          amp = freq[idx] / 255;
        } else {
          amp = 0.12 + 0.06 * Math.sin((i / bars) * Math.PI); // idle baseline
        }
        const barH = Math.max(2, amp * (h - 2));
        const x = i * (barW + gap);
        const y = (h - barH) / 2;
        roundRectPath(ctx, x, y, barW, barH, barW / 2);
        ctx.fill();
      }
      if (!reduce) raf = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(raf);
  }, [analyser, bars]);

  return <canvas ref={canvasRef} className={`waveform ${className}`} aria-hidden="true" />;
}
