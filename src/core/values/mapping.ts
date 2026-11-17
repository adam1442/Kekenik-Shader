/** Slider value ↔ normalised position mappings (linear / logarithmic / power) with exact inverses. */

export type SliderMapping = { kind: "linear" } | { kind: "log" } | { kind: "power"; exponent: number };

export const LINEAR: SliderMapping = { kind: "linear" };

/** Shift that makes log mapping defined when min <= 0 (symmetric-log style): log(v + shift). */
function logShift(min: number): number {
  return min > 0 ? 0 : 1 - min;
}

/** value → t in [0,1] (not clamped; callers clamp). */
export function valueToT(v: number, min: number, max: number, map: SliderMapping = LINEAR): number {
  if (!(max > min)) return 0;
  switch (map.kind) {
    case "linear":
      return (v - min) / (max - min);
    case "log": {
      const s = logShift(min);
      const a = Math.log(min + s);
      const b = Math.log(max + s);
      return (Math.log(Math.max(v + s, 1e-300)) - a) / (b - a);
    }
    case "power": {
      const u = Math.max(0, (v - min) / (max - min));
      return Math.pow(u, 1 / map.exponent);
    }
  }
}

/** t in [0,1] → value. Exact inverse of {@link valueToT}. */
export function tToValue(t: number, min: number, max: number, map: SliderMapping = LINEAR): number {
  if (!(max > min)) return min;
  switch (map.kind) {
    case "linear":
      return min + t * (max - min);
    case "log": {
      const s = logShift(min);
      const a = Math.log(min + s);
      const b = Math.log(max + s);
      return Math.exp(a + t * (b - a)) - s;
    }
    case "power":
      return min + Math.pow(Math.max(0, t), map.exponent) * (max - min);
  }
}
