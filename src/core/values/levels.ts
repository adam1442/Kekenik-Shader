/** Photoshop-like Levels + histogram math (no DOM). Values are floats in 0..1 unless stated. */
import { clamp } from "./numeric";

export interface ChannelLevels {
  inBlack: number;
  inWhite: number;
  /** >1 brightens midtones (Photoshop convention). */
  gamma: number;
  outBlack: number;
  outWhite: number;
}

export type LevelsChannel = "rgb" | "r" | "g" | "b" | "a" | "luma";

export interface Levels {
  /** Applied to R,G,B first (the "RGB" tab; the "Luma" tab edits this too). */
  master: ChannelLevels;
  r: ChannelLevels;
  g: ChannelLevels;
  b: ChannelLevels;
  a: ChannelLevels;
}

export const IDENTITY_CHANNEL: ChannelLevels = { inBlack: 0, inWhite: 1, gamma: 1, outBlack: 0, outWhite: 1 };

export function identityLevels(): Levels {
  return {
    master: { ...IDENTITY_CHANNEL },
    r: { ...IDENTITY_CHANNEL },
    g: { ...IDENTITY_CHANNEL },
    b: { ...IDENTITY_CHANNEL },
    a: { ...IDENTITY_CHANNEL },
  };
}

function isIdentityChannel(c: ChannelLevels): boolean {
  return c.inBlack === 0 && c.inWhite === 1 && c.gamma === 1 && c.outBlack === 0 && c.outWhite === 1;
}

export function isIdentityLevels(l: Levels): boolean {
  return (["master", "r", "g", "b", "a"] as const).every((k) => isIdentityChannel(l[k]));
}

/** Levels formula for one value: normalise by input range, gamma, map to output range. Result is clamped to 0..1. */
function applyLevel(x: number, c: ChannelLevels): number {
  const range = c.inWhite - c.inBlack;
  const n = range > 1e-9 ? clamp((x - c.inBlack) / range, 0, 1) : x >= c.inWhite ? 1 : 0;
  const g = Math.pow(n, 1 / Math.max(c.gamma, 1e-4));
  return clamp(c.outBlack + g * (c.outWhite - c.outBlack), 0, 1);
}

function applyLevels(
  px: { r: number; g: number; b: number; a: number },
  l: Levels,
): { r: number; g: number; b: number; a: number } {
  return {
    r: applyLevel(applyLevel(px.r, l.master), l.r),
    g: applyLevel(applyLevel(px.g, l.master), l.g),
    b: applyLevel(applyLevel(px.b, l.master), l.b),
    a: applyLevel(px.a, l.a),
  };
}

/** Apply to an interleaved RGBA buffer (Float32Array 0..1 or Uint8ClampedArray 0..255) in place-safe fashion (returns a copy). */
export function applyLevelsToBuffer(
  data: Float32Array | Uint8ClampedArray,
  l: Levels,
): Float32Array | Uint8ClampedArray {
  const is8 = data instanceof Uint8ClampedArray;
  const out = is8 ? new Uint8ClampedArray(data.length) : new Float32Array(data.length);
  const s = is8 ? 255 : 1;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const p = applyLevels({ r: data[i]! / s, g: data[i + 1]! / s, b: data[i + 2]! / s, a: data[i + 3]! / s }, l);
    out[i] = p.r * s;
    out[i + 1] = p.g * s;
    out[i + 2] = p.b * s;
    out[i + 3] = p.a * s;
  }
  return out;
}

/** Bake a 1-D LUT of a channel's response (n entries, input 0..1). */
export function bakeLevelsLUT(c: ChannelLevels, n = 256): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = applyLevel(n === 1 ? 0 : i / (n - 1), c);
  return out;
}

/* ── histogram ────────────────────────────────────────────────────────── */

export interface Histogram {
  bins: number;
  r: Uint32Array;
  g: Uint32Array;
  b: Uint32Array;
  a: Uint32Array;
  luma: Uint32Array;
  /** Number of pixels counted. */
  count: number;
}

/** Anything that can supply RGBA pixels for the histogram. */
export interface HistogramSource {
  /** `u8` = 0..255 interleaved RGBA, `float` = 0..1 (values >1 land in the last bin). */
  read(): { data: Uint8ClampedArray | Uint8Array | Float32Array; kind?: "u8" | "float" } | null;
}

export function computeHistogram(
  data: ArrayLike<number>,
  kind: "u8" | "float" = "u8",
  bins = 256,
  stride = 1,
): Histogram {
  const h: Histogram = {
    bins,
    r: new Uint32Array(bins),
    g: new Uint32Array(bins),
    b: new Uint32Array(bins),
    a: new Uint32Array(bins),
    luma: new Uint32Array(bins),
    count: 0,
  };
  const scale = kind === "u8" ? 1 / 255 : 1;
  const bin = (x: number) => Math.min(bins - 1, Math.max(0, Math.floor(x * scale * (bins - 1) + 0.5)));
  const step = Math.max(1, Math.floor(stride)) * 4;
  for (let i = 0; i + 3 < data.length; i += step) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    h.r[bin(r)]!++;
    h.g[bin(g)]!++;
    h.b[bin(b)]!++;
    h.a[bin(data[i + 3]!)]!++;
    h.luma[bin(0.2126 * r + 0.7152 * g + 0.0722 * b)]!++;
    h.count++;
  }
  return h;
}

/** Scale a histogram channel to 0..1 heights for drawing (log optional). The peak bin is 1. */
export function histogramHeights(bins: Uint32Array, log: boolean): Float32Array {
  const out = new Float32Array(bins.length);
  let peak = 0;
  for (let i = 0; i < bins.length; i++) peak = Math.max(peak, bins[i]!);
  if (peak === 0) return out;
  const denom = log ? Math.log1p(peak) : peak;
  for (let i = 0; i < bins.length; i++) out[i] = (log ? Math.log1p(bins[i]!) : bins[i]!) / denom;
  return out;
}

/** Position (0..1) where the cumulative distribution reaches `fraction` of the total. */
function percentile(bins: Uint32Array, fraction: number, fromTop: boolean): number {
  let total = 0;
  for (const v of bins) total += v;
  if (total === 0) return fromTop ? 1 : 0;
  const target = total * fraction;
  let acc = 0;
  const n = bins.length;
  for (let k = 0; k < n; k++) {
    const i = fromTop ? n - 1 - k : k;
    acc += bins[i]!;
    if (acc > target) return i / (n - 1);
  }
  return fromTop ? 0 : 1;
}

/**
 * Auto levels: clip `clip` (fraction, default 0.1 %) of pixels at each end and stretch.
 * By default one master range is derived from luma; `perChannel` stretches R,G,B independently (can shift colour).
 */
export function autoLevels(h: Histogram, opts: { clip?: number; perChannel?: boolean } = {}): Levels {
  const clip = opts.clip ?? 0.001;
  const out = identityLevels();
  const range = (bins: Uint32Array): ChannelLevels => {
    const lo = percentile(bins, clip, false);
    let hi = percentile(bins, clip, true);
    if (hi <= lo + 1 / (h.bins - 1)) hi = Math.min(1, lo + 1 / (h.bins - 1));
    return { ...IDENTITY_CHANNEL, inBlack: lo, inWhite: Math.max(hi, lo + 1e-3) };
  };
  if (opts.perChannel) {
    out.r = range(h.r);
    out.g = range(h.g);
    out.b = range(h.b);
  } else {
    out.master = range(h.luma);
  }
  return out;
}

export function channelKey(ch: LevelsChannel): keyof Levels {
  return ch === "rgb" || ch === "luma" ? "master" : ch;
}
