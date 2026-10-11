import { perlin2 } from './perlin';

/**
 * Default settings of the noise-animation demo (github.com/prabinpebam/noise-animation), with its
 * displacement and mouse-ripple effects disabled. Only the stipple layer is visible by default: it
 * repaints the whole frame, so the underlying noise image is never shown.
 */
export const NOISE_STIPPLE_DEFAULTS = {
  /** Noise time advanced per animation frame (the demo advances once per requestAnimationFrame). */
  speed: 0.005,
  /** Reference frame rate used to convert the per-frame speed into a refresh-rate-independent rate. */
  referenceFps: 60,
  resolutionFactor: 0.9,
  invert: true,
  perlin1: { scale: 0.004, brightness: 0, contrast: 3 },
  perlin2: { scale: 0.009, brightness: 0, contrast: 5 },
  minDistance: 5,
  minDotSize: 0.1,
  maxDotSize: 2,
  brightnessThreshold: 255,
} as const;

export interface StipplePoint {
  /** Draw position in CSS pixels of the visible canvas. */
  drawX: number;
  drawY: number;
  /** Pre-scaled noise coordinates of the sampled noise pixel (time is added per frame). */
  n1x: number;
  n1y: number;
  n2x: number;
  n2y: number;
}

/** Bridson Poisson-disk sampling, matching the demo's sampler (k = 30 candidates per active point). */
export function poissonPoints(
  width: number,
  height: number,
  minDist: number,
  random: () => number = Math.random,
  k = 30,
): { x: number; y: number }[] {
  if (width <= 0 || height <= 0) return [];
  const cellSize = minDist / Math.SQRT2;
  const gridWidth = Math.ceil(width / cellSize);
  const gridHeight = Math.ceil(height / cellSize);
  const grid: ({ x: number; y: number } | null)[] = new Array(gridWidth * gridHeight).fill(null);
  const points: { x: number; y: number }[] = [];
  const active: { x: number; y: number }[] = [];
  const add = (pt: { x: number; y: number }) => {
    points.push(pt);
    active.push(pt);
    grid[Math.floor(pt.x / cellSize) + Math.floor(pt.y / cellSize) * gridWidth] = pt;
  };
  add({ x: random() * width, y: random() * height });
  const minDistSq = minDist * minDist;
  while (active.length) {
    const index = Math.floor(random() * active.length);
    const point = active[index];
    let found = false;
    for (let i = 0; i < k; i++) {
      const angle = random() * 2 * Math.PI;
      const mag = minDist * (1 + random());
      const x = point.x + Math.cos(angle) * mag;
      const y = point.y + Math.sin(angle) * mag;
      if (x < 0 || x >= width || y < 0 || y >= height) continue;
      const gx = Math.floor(x / cellSize);
      const gy = Math.floor(y / cellSize);
      let ok = true;
      for (let ix = Math.max(0, gx - 2); ok && ix <= Math.min(gx + 2, gridWidth - 1); ix++) {
        for (let iy = Math.max(0, gy - 2); iy <= Math.min(gy + 2, gridHeight - 1); iy++) {
          const neighbor = grid[ix + iy * gridWidth];
          if (neighbor) {
            const dx = neighbor.x - x;
            const dy = neighbor.y - y;
            if (dx * dx + dy * dy < minDistSq) {
              ok = false;
              break;
            }
          }
        }
      }
      if (ok) {
        add({ x, y });
        found = true;
        break;
      }
    }
    if (!found) active.splice(index, 1);
  }
  return points;
}

/**
 * Lay out stipple points for a canvas of `width` x `height` CSS pixels, reproducing the demo's
 * geometry: points live on a noise grid of `resolutionFactor` scale centred on the canvas and are
 * scaled back up to the visible size.
 */
export function layoutStipple(
  width: number,
  height: number,
  random: () => number = Math.random,
  settings = NOISE_STIPPLE_DEFAULTS,
): StipplePoint[] {
  const noiseWidth = Math.trunc(width * settings.resolutionFactor);
  const baseHeight = height * settings.resolutionFactor;
  const noiseHeight = Math.trunc(baseHeight);
  if (noiseWidth <= 0 || noiseHeight <= 0) return [];
  const cx = noiseWidth / 2;
  const cy = baseHeight / 2;
  const scaleX = width / noiseWidth;
  const scaleY = height / baseHeight;
  return poissonPoints(noiseWidth, noiseHeight, settings.minDistance, random).map((pt) => {
    const px = Math.floor(Math.min(pt.x, noiseWidth - 1));
    const py = Math.floor(Math.min(pt.y, noiseHeight - 1));
    return {
      drawX: pt.x * scaleX,
      drawY: pt.y * scaleY,
      n1x: (px - cx) * settings.perlin1.scale,
      n1y: (py - cy) * settings.perlin1.scale,
      n2x: (px - cx) * settings.perlin2.scale,
      n2y: (py - cy) * settings.perlin2.scale,
    };
  });
}

/** Grayscale value (0-255) of the demo's combined noise image at a stipple point. */
export function stippleBrightness(point: StipplePoint, time: number, settings = NOISE_STIPPLE_DEFAULTS): number {
  let v1 = (perlin2(point.n1x + time, point.n1y + time) + 1) * 127.5;
  v1 = (v1 - 128) * settings.perlin1.contrast + 128 + settings.perlin1.brightness;
  let v2 = (perlin2(point.n2x - time, point.n2y - time) + 1) * 127.5;
  v2 = (v2 - 128) * settings.perlin2.contrast + 128 + settings.perlin2.brightness;
  if (settings.invert) {
    v1 = 255 - v1;
    v2 = 255 - v2;
  }
  return Math.max(0, Math.min(255, Math.floor((v1 + v2) / 2)));
}

/** Dot radius in CSS pixels for a brightness value; darker noise draws larger dots. */
export function stippleRadius(brightness: number, settings = NOISE_STIPPLE_DEFAULTS): number {
  return settings.minDotSize + (1 - brightness / 255) * (settings.maxDotSize - settings.minDotSize);
}

/** Noise time after `elapsedMs`, matching the demo's per-frame advance at the reference frame rate. */
export function stippleTime(elapsedMs: number, settings = NOISE_STIPPLE_DEFAULTS): number {
  return settings.speed * (1 + (elapsedMs / 1000) * settings.referenceFps);
}

/** Paint one frame: a solid background with every visible dot batched into a single fill. */
export function drawStippleFrame(
  ctx: CanvasRenderingContext2D,
  points: readonly StipplePoint[],
  width: number,
  height: number,
  time: number,
  colors: { background: string; dot: string },
  settings = NOISE_STIPPLE_DEFAULTS,
): void {
  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = colors.dot;
  ctx.beginPath();
  for (const point of points) {
    const brightness = stippleBrightness(point, time, settings);
    if (brightness > settings.brightnessThreshold) continue;
    const radius = stippleRadius(brightness, settings);
    ctx.moveTo(point.drawX + radius, point.drawY);
    ctx.arc(point.drawX, point.drawY, radius, 0, Math.PI * 2);
  }
  ctx.fill();
}
