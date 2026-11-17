/**
 * Surface texture generators for the 11b samples (brick, terrain layers, lava crust, matcap). Same rules as `gen.ts`:
 * seeded, integer-hash based, tileable where it matters, no external assets.
 */
import { type Field, fbm, heightTex, normalMapOf, rampColor, rockTextures, toTex, worley } from "./gen";
import { hash2 } from "./rng";
import type { Tex } from "./types";

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number): number => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Running-bond brick wall, 2 bricks × 4 rows per tile (tileable). Height: bevelled bricks, sunken mortar. */
export function brickTextures(size: number, seed: number): { albedo: Tex; height: Tex; normal: Tex } {
  const bw = size / 2, bh = size / 4, m = Math.max(2, Math.round(size / 42));
  const grain = fbm(size, size, 16, 3, seed), pits = fbm(size, size, 48, 2, seed + 4);
  const h: Field = { w: size, h: size, v: new Float32Array(size * size) };
  const albedoAt = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const row = Math.floor(y / bh), sx = mod(x + (row % 2) * (bw / 2), size);
    const lx = sx % bw, ly = y % bh, key = row * 2 + Math.floor(sx / bw);
    const d = Math.min(lx, bw - 1 - lx, ly, bh - 1 - ly);
    const i = y * size + x;
    const bevel = smoothstep(m * 0.4, m * 1.8, d);
    const g = grain.v[i]!, p = pits.v[i]!;
    h.v[i] = 0.04 + bevel * (0.62 + g * 0.22 + (p - 0.5) * 0.12);
    const tint = 0.8 + hash2(key, 3, seed) * 0.4;
    const brick = [0.5 * tint + g * 0.12, 0.2 * tint + g * 0.04, 0.14 * tint];
    const mortar = [0.5 + p * 0.1, 0.48 + p * 0.1, 0.44 + p * 0.1];
    const k = smoothstep(m * 0.3, m * 1.2, d);
    for (let c = 0; c < 3; c++) albedoAt[i * 3 + c] = mortar[c]! + (brick[c]! - mortar[c]!) * k;
  }
  return {
    albedo: toTex(size, size, "Procedural running-bond brick albedo (tileable)", (x, y) => [albedoAt[(y * size + x) * 3]!, albedoAt[(y * size + x) * 3 + 1]!, albedoAt[(y * size + x) * 3 + 2]!, 1]),
    height: heightTex(h, "Procedural brick height (bevelled bricks, sunken mortar)"),
    normal: normalMapOf(h, 5, "Procedural brick normal map (from height)"),
  };
}

/** Four terrain albedos (grass, dirt, rock, snow), tileable. */
export function terrainLayers(size: number, seed: number): { grass: Tex; dirt: Tex; rock: Tex; snow: Tex } {
  const mk = (note: string, stops: Array<[number, number[]]>, cells: number, fine: number, s: number): Tex => {
    const a = fbm(size, size, cells, 4, s), b = fbm(size, size, fine, 2, s + 17);
    return toTex(size, size, note, (x, y) => { const i = y * size + x; const c = rampColor(stops, a.v[i]!); const g = 0.85 + b.v[i]! * 0.3; return [c[0]! * g, c[1]! * g, c[2]! * g, 1]; });
  };
  const pebbles = worley(size, size, 10, seed + 3);
  const dirtBase = mk("Procedural dirt albedo", [[0, [0.16, 0.1, 0.06]], [1, [0.42, 0.29, 0.17]]], 5, 40, seed + 2);
  for (let i = 0; i < size * size; i++) { const k = 0.8 + 0.3 * smoothstep(0.1, 0.45, pebbles.v[i]!); for (let c = 0; c < 3; c++) dirtBase.data[i * 4 + c] = Math.round(Math.min(255, dirtBase.data[i * 4 + c]! * k)); }
  return {
    grass: mk("Procedural grass albedo", [[0, [0.07, 0.18, 0.04]], [0.5, [0.2, 0.4, 0.08]], [1, [0.42, 0.56, 0.16]]], 7, 48, seed + 1),
    dirt: dirtBase,
    rock: rockTextures(size, seed + 5).albedo,
    snow: mk("Procedural snow albedo", [[0, [0.78, 0.85, 0.95]], [1, [1, 1, 1]]], 4, 32, seed + 4),
  };
}

/** Lava crust: R = heat (1 in the glowing cracks between plates), G = fine detail. Tileable. */
export function lavaCrust(size: number, seed: number): Tex {
  const plates = worley(size, size, 5, seed), warp = fbm(size, size, 6, 3, seed + 8), fine = fbm(size, size, 24, 3, seed + 9);
  return toTex(size, size, "Procedural lava crust: R heat (cracks), G detail", (x, y) => {
    const i = y * size + x;
    const heat = smoothstep(0.42, 0.78, plates.v[i]! * 1.15 + (warp.v[i]! - 0.5) * 0.45);
    return [heat, fine.v[i]!, 0, 1];
  });
}

/** Studio matcap (sphere shading in the unit disc): key light, soft fill, bright rim and a dark horizon band. */
export function matcapTex(size: number): Tex {
  return toTex(size, size, "Procedural studio matcap", (x, y) => {
    const u = ((x + 0.5) / size) * 2 - 1, v = 1 - ((y + 0.5) / size) * 2, r2 = u * u + v * v;
    if (r2 > 1) return [0, 0, 0, 1];
    const z = Math.sqrt(1 - r2);
    const key = Math.pow(clamp01(u * -0.45 + v * 0.62 + z * 0.64), 14) * 1.3;
    const fill = clamp01(u * 0.7 + v * -0.2 + z * 0.4) * 0.35;
    const rim = Math.pow(1 - z, 3) * 0.9;
    const horizon = 1 - 0.55 * Math.exp(-Math.pow((v + 0.12) / 0.11, 2));
    const base = (0.18 + 0.35 * clamp01(v * 0.5 + 0.5)) * horizon;
    const l = base + key + fill * horizon + rim * 0.6;
    return [l * 0.97, l * 1.0, l * 1.06, 1];
  });
}
