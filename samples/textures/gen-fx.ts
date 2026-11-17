/** FX / sprite texture generators for the 11b samples (retro scene sprite, fire flipbook, smoke puff). Seeded, no external assets. */
import { fbm, heightTex, toTex } from "./gen";
import { hash2 } from "./rng";
import type { Tex } from "./types";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number): number => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mod = (a: number, n: number): number => ((a % n) + n) % n;
const mix = (a: number[], b: number[], t: number): number[] => [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];

/** "Retro sunset" scene (opaque): striped sun, mountains, perspective grid floor, stars. A busy image shows CRT / glitch effects well. */
export function retroScene(w: number, h: number): Tex {
  return toTex(w, h, "Procedural retro sunset scene (opaque sprite)", (x, y) => {
    const u = (x + 0.5) / w, v = 1 - (y + 0.5) / h; // v up
    const horizon = 0.42;
    if (v >= horizon) {
      let c = mix([0.08, 0.02, 0.2], [0.85, 0.2, 0.55], smoothstep(1, horizon, v) ** 1.5);
      const star = hash2(Math.floor(u * w), Math.floor(v * h), 5) > 0.992 ? 0.9 * smoothstep(0.55, 0.85, v) : 0;
      c = [c[0]! + star, c[1]! + star, c[2]! + star];
      const sd = Math.hypot((u - 0.5) * (w / h), v - 0.64);
      if (sd < 0.2) {
        const gap = v < 0.6 ? (0.6 - v) / 0.18 : -1; // stripes widen towards the bottom of the sun
        const cut = gap >= 0 && fractAbs((0.6 - v) * 22) < gap * 0.55;
        if (!cut) c = mix([1, 0.85, 0.2], [1, 0.2, 0.6], smoothstep(0.76, 0.46, v));
      }
      const ridge = 0.5 + 0.06 * Math.sin(u * 17) + 0.04 * Math.sin(u * 41 + 1) + 0.05 * Math.abs(Math.sin(u * 7 + 2));
      if (v < ridge && v >= horizon) c = mix([0.05, 0.02, 0.12], [0.2, 0.06, 0.3], smoothstep(horizon, ridge, v) * 0.5 + (hash2(Math.floor(u * 40), 2, 9) * 0.1));
      return [c[0]!, c[1]!, c[2]!, 1];
    }
    const depth = (horizon - v) / horizon; // 0 at horizon → 1 at the bottom
    const gx = Math.abs(fractAbs((u - 0.5) / Math.max(0.02, depth) * 3 + 0.5) - 0.5);
    const gy = fractAbs(0.35 / Math.max(0.05, depth)), hl = 1 - smoothstep(0, 0.09, Math.min(gy, 1 - gy));
    const line = Math.max(1 - smoothstep(0.0, 0.04 + 0.03 * (1 - depth), gx), hl * 0.8);
    const glow = 1 - smoothstep(0, 0.12, depth);
    const base = mix([0.06, 0.02, 0.16], [0.2, 0.05, 0.3], depth);
    const c = mix(base, [0.1, 0.9, 1], clamp01(line * (0.35 + 0.65 * depth)));
    return [c[0]! + glow * 0.5, c[1]! + glow * 0.15, c[2]! + glow * 0.6, 1];
  });
}
const fractAbs = (x: number): number => x - Math.floor(x);

/** Soft cloudy puff for smoke: tileable fbm (grey). */
export const smokeTex = (size: number, seed: number): Tex => heightTex(fbm(size, size, 4, 5, seed, 0.55), "Procedural smoke noise (tileable fbm)");

/**
 * Fire flipbook: `grid × grid` frames (row-major, frame 0 top-left) of `frame`² px. Grey intensity (1 = hottest core).
 * The noise scrolls upward by exactly one lattice period over the whole loop, so frame `n-1 → 0` is seamless.
 */
export function fireFlipbook(frame: number, grid: number, seed: number): Tex {
  const n = grid * grid, size = frame * grid;
  const lattice = (ix: number, iy: number, p: number, s: number): number => hash2(mod(ix, p), mod(iy, p), s);
  const noise = (x: number, y: number, p: number, s: number): number => {
    const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = lattice(x0, y0, p, s) + (lattice(x0 + 1, y0, p, s) - lattice(x0, y0, p, s)) * sx;
    const b = lattice(x0, y0 + 1, p, s) + (lattice(x0 + 1, y0 + 1, p, s) - lattice(x0, y0 + 1, p, s)) * sx;
    return a + (b - a) * sy;
  };
  return toTex(size, size, `Procedural fire flipbook ${grid}×${grid} (grey intensity, looping)`, (px, py) => {
    const f = Math.floor(py / frame) * grid + Math.floor(px / frame);
    const u = ((px % frame) + 0.5) / frame, v = 1 - ((py % frame) + 0.5) / frame;
    const phase = f / n;
    let turb = 0, amp = 1, sum = 0;
    for (let o = 0; o < 3; o++) {
      const p = 3 * 2 ** o; // period in lattice cells (also the loop length of the scroll)
      turb += noise(u * p + 0.37 * o, v * p - phase * p + 0.5 * o, p, seed + o * 31) * amp;
      sum += amp;
      amp *= 0.55;
    }
    turb /= sum;
    const width = 0.3 * (1 - Math.pow(v, 1.15)) + 0.035;
    const sway = (turb - 0.5) * 0.22 * v;
    const core = 1 - Math.abs(u - 0.5 - sway) / width;
    const d = core * 1.3 + (turb - 0.5) * 1.0 * (0.4 + v) - v * 0.55 + 0.12;
    const edge = smoothstep(0, 0.1, u) * smoothstep(0, 0.1, 1 - u) * smoothstep(0, 0.06, v) * smoothstep(0, 0.12, 1 - v);
    const g = clamp01(smoothstep(0, 0.9, d)) * edge;
    return [g, g, g, 1];
  });
}
