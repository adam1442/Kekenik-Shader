/**
 * Procedural "room" environment (equirectangular, linear HDR, RGBA float, row 0 = BOTTOM of the sphere).
 * Direction ↔ texel mapping is exactly the one the lit-approximation shader uses:
 *   u = atan(z, x) / 2π + 0.5,  v = asin(y) / π + 0.5
 */
import { clamp } from "@/core/values/numeric";

export const ENV_W = 128;
export const ENV_H = 64;

/** World direction of the texel centre (i, j). */
function equirectDir(u: number, v: number): [number, number, number] {
  const phi = (u - 0.5) * Math.PI * 2;
  const el = (v - 0.5) * Math.PI;
  const c = Math.cos(el);
  return [Math.cos(phi) * c, Math.sin(el), Math.sin(phi) * c];
}

const smooth = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Radiance seen in direction `d` inside the procedural room. */
function roomRadiance(d: [number, number, number]): [number, number, number] {
  const [x, y, z] = d;
  // Walls: warm dark grey with a vertical gradient; floor darker; ceiling a little brighter.
  const wall = 0.05 + 0.06 * smooth(-0.3, 0.8, y);
  let r = wall * 1.1,
    g = wall,
    b = wall * 0.92;
  if (y < -0.05) {
    const f = 0.03 + 0.04 * smooth(-1, -0.05, y);
    r = f * 1.05;
    g = f;
    b = f * 0.95;
  }
  // Big softbox in the ceiling (warm white).
  const box = smooth(0.82, 0.86, y) * (1 - smooth(0.0, 0.5, Math.hypot(x, z) - 0.45));
  r += box * 4.2;
  g += box * 4;
  b += box * 3.6;
  // Two tall windows on the +X / -Z side (cool daylight).
  const az = Math.atan2(z, x);
  for (const c of [-0.55, 0.15]) {
    const da = Math.abs(az - c);
    const w = (1 - smooth(0.1, 0.16, da)) * smooth(-0.15, -0.05, y) * (1 - smooth(0.45, 0.55, y));
    r += w * 3.5;
    g += w * 4.2;
    b += w * 5.6;
  }
  // Small warm kicker behind the camera side (-X).
  const k = 1 - smooth(0.06, 0.12, Math.hypot(az - 2.4, y - 0.15));
  r += k * 3.5;
  g += k * 2.3;
  b += k * 1.6;
  return [r, g, b];
}

/** RGBA float data for the room (deterministic). */
export function generateRoomEnv(w = ENV_W, h = ENV_H): Float32Array {
  const out = new Float32Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const [r, g, b] = roomRadiance(equirectDir((i + 0.5) / w, (j + 0.5) / h));
      const o = (j * w + i) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 1;
    }
  }
  return out;
}

/** Studio 3-light preset: key / fill / rim (directions point TO the light, colours are radiance multipliers). */
export interface LightRig {
  dirs: Array<[number, number, number]>;
  colors: Array<[number, number, number]>;
}

const norm = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Studio rig for a user-controlled key-light direction (azimuth / elevation in degrees). */
export function studioRig(azimuthDeg: number, elevationDeg: number, intensity = 1): LightRig {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  const key = norm([Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]);
  const fill = norm([-key[0], 0.25, key[2] * 0.6 - 0.2]);
  const rim = norm([-key[0] * 0.5, 0.45, -1]);
  const s = intensity;
  return {
    dirs: [key, fill, rim],
    colors: [
      [3 * s, 2.9 * s, 2.7 * s],
      [0.7 * s, 0.85 * s, 1.1 * s],
      [1.6 * s, 1.6 * s, 1.8 * s],
    ],
  };
}
