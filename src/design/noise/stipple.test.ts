import { describe, expect, it, vi } from 'vitest';
import { perlin2 } from './perlin';
import {
  NOISE_STIPPLE_DEFAULTS as D,
  drawStippleFrame,
  layoutStipple,
  poissonPoints,
  stippleBrightness,
  stippleRadius,
  stippleTime,
  type StipplePoint,
} from './stipple';

function seeded(seed = 7): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** A stipple point sampling noise pixel (px, py) on the demo's default 540x540 noise grid. */
function pointAt(px: number, py: number, noiseWidth = 540, baseHeight = 540): StipplePoint {
  const cx = noiseWidth / 2;
  const cy = baseHeight / 2;
  return {
    drawX: 0,
    drawY: 0,
    n1x: (px - cx) * D.perlin1.scale,
    n1y: (py - cy) * D.perlin1.scale,
    n2x: (px - cx) * D.perlin2.scale,
    n2y: (py - cy) * D.perlin2.scale,
  };
}

describe('perlin2', () => {
  it('matches noisejs perlin@1.0.0 (seed 0) exactly', () => {
    // Reference values produced by the original package's noise.perlin2.
    const reference: [number, number, number][] = [
      [0, 0, 0],
      [0.5, 0.5, -0.375],
      [1.3, -2.7, 0.3602639308799999],
      [-0.123, 4.567, 0.30649520056206164],
      [12.34, 56.78, -0.39008152563000714],
      [-255.5, 300.25, 0.17236328125],
      [0.005, 0.005, -0.004999993798312751],
      [-0.75, -1.08, -0.21585016615199976],
      [513.2, -777.9, 0.23069095424002553],
      [3.999, 0.001, -0.0009999999800291905],
    ];
    for (const [x, y, value] of reference) expect(perlin2(x, y)).toBeCloseTo(value, 12);
  });
});

describe('noise stipple model', () => {
  it('reproduces the demo noise image brightness at its default settings', () => {
    // Golden values from the demo's generateNoiseImage() formula run against the original library.
    const golden: [number, number, number, number][] = [
      [0, 0, 0.005, 208],
      [270, 270, 0.005, 128],
      [100, 400, 0.005, 4],
      [539, 539, 0.005, 0],
      [37, 211, 1.23, 171],
      [400, 12, 7.5, 97],
      [250, 300, 30.005, 148],
    ];
    for (const [x, y, time, brightness] of golden) expect(stippleBrightness(pointAt(x, y), time)).toBe(brightness);
  });

  it('advances time like the demo at 60 frames per second', () => {
    expect(stippleTime(0)).toBeCloseTo(0.005, 12);
    expect(stippleTime(1000)).toBeCloseTo(0.005 * 61, 12);
  });

  it('maps brightness to the default dot sizes', () => {
    expect(stippleRadius(0)).toBeCloseTo(2, 12);
    expect(stippleRadius(255)).toBeCloseTo(0.1, 12);
  });

  it('keeps Poisson points inside the grid and at least the minimum distance apart', () => {
    const points = poissonPoints(120, 80, 5, seeded());
    expect(points.length).toBeGreaterThan(150);
    for (const [i, a] of points.entries()) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x).toBeLessThan(120);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeLessThan(80);
      for (const b of points.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(5 - 1e-9);
    }
  });

  it('lays out points on a 0.9-scale noise grid and maps them back to the visible canvas', () => {
    const points = layoutStipple(400, 200, seeded(3));
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) {
      expect(point.drawX).toBeGreaterThanOrEqual(0);
      expect(point.drawX).toBeLessThan(400);
      expect(point.drawY).toBeGreaterThanOrEqual(0);
      expect(point.drawY).toBeLessThan(200);
      // Noise inputs belong to an integer pixel of the 360x180 grid centred at (180, 90).
      const px = point.n1x / D.perlin1.scale + 180;
      const py = point.n1y / D.perlin1.scale + 90;
      expect(px).toBeCloseTo(Math.round(px), 6);
      expect(py).toBeCloseTo(Math.round(py), 6);
      expect(Math.round(px)).toBe(Math.floor((point.drawX * 360) / 400));
      expect(point.n2x).toBeCloseTo((Math.round(px) - 180) * D.perlin2.scale, 9);
    }
    expect(layoutStipple(0, 100)).toEqual([]);
  });

  it('paints the background and batches every dot into one fill', () => {
    const ctx = { fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), arc: vi.fn(), fill: vi.fn(), fillStyle: '' };
    const points = layoutStipple(60, 40, seeded(5));
    drawStippleFrame(ctx as unknown as CanvasRenderingContext2D, points, 60, 40, 0.005, { background: 'black', dot: 'white' });
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 60, 40);
    expect(ctx.beginPath).toHaveBeenCalledOnce();
    expect(ctx.arc).toHaveBeenCalledTimes(points.length);
    expect(ctx.fill).toHaveBeenCalledOnce();
    expect(ctx.fillStyle).toBe('white');
    for (const [, , radius] of ctx.arc.mock.calls) {
      expect(radius).toBeGreaterThanOrEqual(0.1);
      expect(radius).toBeLessThanOrEqual(2);
    }
  });
});
