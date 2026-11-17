/**
 * Procedural texture generators (docs/SAMPLES.md §Textures). Seeded + integer-hash based ⇒ byte-identical on every platform;
 * no external or copyrighted assets. Heights are Float32 [0,1] fields; `normalMapOf` uses the same Sobel / central-difference
 * math as the Height-To-Normal node (green = +Y up, OpenGL convention; the graphs that read it set flipGreen where an engine needs it).
 */
import { hash2 } from "./rng";
import type { Tex } from "./types";

export interface Field { w: number; h: number; v: Float32Array }
const smooth = (t: number): number => t * t * (3 - 2 * t);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Tileable value noise at `cells` lattice cells per image edge. */
function valueNoise(w: number, h: number, cells: number, seed: number): Field {
  const v = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cells, fy = (y / h) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = smooth(fx - x0), ty = smooth(fy - y0);
      const c = (ix: number, iy: number): number => hash2(mod(ix, cells), mod(iy, cells), seed);
      const a = c(x0, y0) + (c(x0 + 1, y0) - c(x0, y0)) * tx;
      const b = c(x0, y0 + 1) + (c(x0 + 1, y0 + 1) - c(x0, y0 + 1)) * tx;
      v[y * w + x] = a + (b - a) * ty;
    }
  }
  return { w, h, v };
}

/** Tileable fractal noise (octaves of `valueNoise`, normalised to ~[0,1]). */
export function fbm(w: number, h: number, baseCells: number, octaves: number, seed: number, gain = 0.5): Field {
  const out = new Float32Array(w * h);
  let amp = 1, sum = 0;
  for (let o = 0; o < octaves; o++) {
    const f = valueNoise(w, h, baseCells * 2 ** o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i]! += f.v[i]! * amp;
    sum += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / sum;
  return { w, h, v: out };
}

/** Tileable cellular (Worley F1) distance field — rock cracks / plates. */
export function worley(w: number, h: number, cells: number, seed: number): Field {
  const v = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cells, fy = (y / h) * cells;
      const cx = Math.floor(fx), cy = Math.floor(fy);
      let best = 9;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const px = cx + i + hash2(mod(cx + i, cells), mod(cy + j, cells), seed), py = cy + j + hash2(mod(cx + i, cells), mod(cy + j, cells), seed + 7);
        best = Math.min(best, Math.hypot(fx - px, fy - py));
      }
      v[y * w + x] = clamp01(best);
    }
  }
  return { w, h, v };
}

export const toTex = (w: number, h: number, note: string, px: (x: number, y: number) => [number, number, number, number]): Tex => {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = px(x, y);
    for (let k = 0; k < 4; k++) data[(y * w + x) * 4 + k] = Math.round(clamp01(c[k]!) * 255);
  }
  return { w, h, data, note };
};

export const heightTex = (f: Field, note: string): Tex => toTex(f.w, f.h, note, (x, y) => { const g = f.v[y * f.w + x]!; return [g, g, g, 1]; });

/** Tangent-space normal map from a tileable height field (central differences with wrap-around; `strength` scales the slope). */
export function normalMapOf(f: Field, strength: number, note: string): Tex {
  return toTex(f.w, f.h, note, (x, y) => {
    const hx = f.v[y * f.w + mod(x + 1, f.w)]! - f.v[y * f.w + mod(x - 1, f.w)]!;
    const hy = f.v[mod(y - 1, f.h) * f.w + x]! - f.v[mod(y + 1, f.h) * f.w + x]!; // row 0 is the top ⇒ +Y is up
    const l = Math.hypot(hx * strength, hy * strength, 1);
    return [((-hx * strength) / l) * 0.5 + 0.5, ((-hy * strength) / l) * 0.5 + 0.5, (1 / l) * 0.5 + 0.5, 1];
  });
}

const lerp3 = (a: number[], b: number[], t: number): number[] => [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];
export function rampColor(stops: ReadonlyArray<[number, number[]]>, t: number): number[] {
  if (t <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i]![0]) { const [t0, c0] = stops[i - 1]!, [t1, c1] = stops[i]!; return lerp3(c0, c1, (t - t0) / Math.max(1e-6, t1 - t0)); }
  return stops[stops.length - 1]![1];
}

/** Rock set: height (R), albedo, and tangent-space normal; all tileable, 256² by default. */
export function rockTextures(size: number, seed: number): { height: Tex; albedo: Tex; normal: Tex } {
  const big = fbm(size, size, 4, 5, seed);
  const cells = worley(size, size, 6, seed + 31);
  const f: Field = { w: size, h: size, v: new Float32Array(size * size) };
  for (let i = 0; i < f.v.length; i++) f.v[i] = clamp01(big.v[i]! * 0.75 + (1 - Math.min(1, cells.v[i]! * 1.35)) * 0.45 - 0.1);
  const stops: Array<[number, number[]]> = [[0, [0.12, 0.11, 0.1]], [0.45, [0.34, 0.31, 0.28]], [0.8, [0.55, 0.51, 0.46]], [1, [0.7, 0.67, 0.62]]];
  const grain = fbm(size, size, 32, 2, seed + 9);
  const albedo = toTex(size, size, "Procedural rock albedo (seeded)", (x, y) => { const i = y * size + x; const c = rampColor(stops, f.v[i]!); const g = 0.88 + grain.v[i]! * 0.24; return [c[0]! * g, c[1]! * g, c[2]! * g, 1]; });
  return { height: heightTex(f, "Procedural rock height (seeded fbm + cells)"), albedo, normal: normalMapOf(f, 5, "Procedural rock normal map (from height)") };
}

/** Water ripple normal map (tileable) + a 2-channel flow map (swirling vector field encoded as RG, 0.5 = no flow). */
export function waterTextures(size: number, seed: number): { normal: Tex; flow: Tex } {
  const a = fbm(size, size, 6, 4, seed, 0.55);
  const nx = fbm(size, size, 3, 3, seed + 5), ny = fbm(size, size, 3, 3, seed + 6);
  return {
    normal: normalMapOf(a, 3.5, "Procedural water ripple normal map (tileable)"),
    flow: toTex(size, size, "Procedural flow map (RG vector field, 0.5 = still)", (x, y) => [0.5 + (nx.v[y * size + x]! - 0.5) * 1.6, 0.5 + (ny.v[y * size + x]! - 0.5) * 1.6, 0.5, 1]),
  };
}

/** Palette ramps: row r = palette r, left → right = dark → light (sample with U = luminance, V = (r + 0.5) / rows). */
export function paletteLut(palettes: ReadonlyArray<ReadonlyArray<number[]>>, w = 64): Tex {
  const rows = palettes.length;
  return toTex(w, rows, `Palette LUT: ${rows} ramps × ${w} texels`, (x, y) => {
    const p = palettes[y]!;
    const stops = p.map((c, i) => [i / (p.length - 1), c] as [number, number[]]);
    const c = rampColor(stops, x / (w - 1));
    return [c[0]!, c[1]!, c[2]!, 1];
  });
}

/**
 * A little pixel-art "slime" sprite (64×64). `indexed` = grey levels 0.15 / 0.4 / 0.7 / 1.0 (shadow / body / light / highlight)
 * for palette swapping; otherwise coloured through `colors`. Alpha 0 outside the body (hard edge: nearest-neighbour friendly).
 */
export function slimeSprite(size: number, indexed: boolean, colors: ReadonlyArray<number[]> = [[0.1, 0.25, 0.12], [0.25, 0.7, 0.3], [0.55, 0.9, 0.45], [0.95, 1, 0.9]]): Tex {
  const levels = [0.15, 0.4, 0.7, 1];
  return toTex(size, size, indexed ? "Procedural slime sprite, 4 grey index levels" : "Procedural slime sprite", (x, y) => {
    const u = (x + 0.5) / size * 2 - 1, v = 1 - (y + 0.5) / size * 2; // -1..1, +y up
    const body = Math.hypot(u / 0.64, (v + 0.22) / (v > -0.22 ? 0.5 : 0.38));
    if (body > 1) return [0, 0, 0, 0];
    let tone = 1;
    if (body > 0.86 || v < -0.55) tone = 0; // rim + base shadow
    else if (u + v * 0.5 < -0.1) tone = 1; // body
    if (u + v * 0.55 > 0.18 && body < 0.86 && v > -0.5) tone = 2; // lit side
    if (Math.hypot(u + 0.24, v - 0.14) < 0.07) tone = 3; // highlight
    if (Math.hypot(u + 0.22, v + 0.05) < 0.09 || Math.hypot(u - 0.22, v + 0.05) < 0.09) tone = 0; // eyes
    if (Math.hypot(u + 0.2, v + 0.02) < 0.035 || Math.hypot(u - 0.24, v + 0.02) < 0.035) tone = 3; // eye glints
    if (tone === 1 && body < 0.86) tone = 1;
    const g = levels[tone]!;
    if (indexed) return [g, g, g, 1];
    const c = colors[tone]!;
    return [c[0]!, c[1]!, c[2]!, 1];
  });
}
