// 2D Perlin noise, ported from noisejs `perlin@1.0.0` (Joseph Gentle) with its default seed 0.
// Based on example code by Stefan Gustavson, optimised by Peter Eastman. The original authors placed
// this algorithm in the public domain; attribution is appreciated.

const P = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225,
  140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32,
  57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122,
  60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169,
  200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212,
  207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
  129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241,
  81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93,
  222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
];
const GRAD_X = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0];
const GRAD_Y = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1];

// seed(0) leaves the permutation unchanged; doubling it removes index wrapping.
const perm = new Uint8Array(512);
const gradX = new Float64Array(512);
const gradY = new Float64Array(512);
for (let i = 0; i < 512; i++) {
  const v = P[i & 255];
  perm[i] = v;
  gradX[i] = GRAD_X[v % 12];
  gradY[i] = GRAD_Y[v % 12];
}

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => (1 - t) * a + t * b;

/** Returns 2D Perlin noise in roughly [-1, 1], identical to noisejs `noise.perlin2`. */
export function perlin2(x: number, y: number): number {
  let X = Math.floor(x);
  let Y = Math.floor(y);
  x -= X;
  y -= Y;
  X &= 255;
  Y &= 255;
  const g00 = X + perm[Y];
  const g01 = X + perm[Y + 1];
  const g10 = X + 1 + perm[Y];
  const g11 = X + 1 + perm[Y + 1];
  const n00 = gradX[g00] * x + gradY[g00] * y;
  const n01 = gradX[g01] * x + gradY[g01] * (y - 1);
  const n10 = gradX[g10] * (x - 1) + gradY[g10] * y;
  const n11 = gradX[g11] * (x - 1) + gradY[g11] * (y - 1);
  const u = fade(x);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), fade(y));
}