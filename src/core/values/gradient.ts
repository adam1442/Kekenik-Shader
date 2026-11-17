/**
 * Gradient value model (Unity-style: separate color stops and alpha stops).
 * Colors are LINEAR HDR floats; interpolation happens in linear light (Decision D-1c-6).
 * Duplicate stop positions are legal and create hard edges (the LATER stop wins at the exact position).
 */
import { clamp } from "./numeric";
import type { Rgba } from "./color";

export type GradientMode = "linear" | "smooth" | "constant";
interface ColorStop {
  pos: number;
  color: { r: number; g: number; b: number };
}
interface AlphaStop {
  pos: number;
  alpha: number;
}
export interface Gradient {
  colorStops: ColorStop[];
  alphaStops: AlphaStop[];
  mode: GradientMode;
}

export const DEFAULT_MAX_STOPS = 8;

const byPos = <T extends { pos: number }>(a: T[]): T[] =>
  a
    .map((s, i) => ({ s, i }))
    .sort((x, y) => x.s.pos - y.s.pos || x.i - y.i)
    .map((x) => x.s);

/** Sorted (stable), positions clamped to 0..1, alpha clamped, at least one stop per list. Never mutates. */
function normalizeGradient(g: Gradient): Gradient {
  const cs = g.colorStops.length ? g.colorStops : [{ pos: 0, color: { r: 1, g: 1, b: 1 } }];
  const as = g.alphaStops.length ? g.alphaStops : [{ pos: 0, alpha: 1 }];
  return {
    mode: g.mode,
    colorStops: byPos(cs.map((s) => ({ pos: clamp(s.pos, 0, 1), color: { ...s.color } }))),
    alphaStops: byPos(as.map((s) => ({ pos: clamp(s.pos, 0, 1), alpha: clamp(s.alpha, 0, 1) }))),
  };
}

export function makeGradient(
  colors: Array<[number, [number, number, number]]>,
  alphas: Array<[number, number]> = [
    [0, 1],
    [1, 1],
  ],
  mode: GradientMode = "linear",
): Gradient {
  return normalizeGradient({
    mode,
    colorStops: colors.map(([pos, c]) => ({ pos, color: { r: c[0], g: c[1], b: c[2] } })),
    alphaStops: alphas.map(([pos, alpha]) => ({ pos, alpha })),
  });
}

const smooth = (u: number) => u * u * (3 - 2 * u);

/** Locate segment for sorted stops: returns [i, u] where u in [0,1) is the position between stop i and i+1 (u=0 on the last stop). */
function locate(pos: number[], t: number): [number, number] {
  const n = pos.length;
  if (n === 0) return [0, 0];
  if (t < pos[0]!) return [0, 0];
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pos[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  if (lo >= n - 1) return [n - 1, 0];
  return [lo, (t - pos[lo]!) / (pos[lo + 1]! - pos[lo]!)];
}

function shape(u: number, mode: GradientMode): number {
  return mode === "constant" ? 0 : mode === "smooth" ? smooth(u) : u;
}

function evaluateColor(g: Gradient, t: number): { r: number; g: number; b: number } {
  const s = g.colorStops;
  const [i, u0] = locate(
    s.map((x) => x.pos),
    clamp(t, 0, 1),
  );
  const a = s[i]!.color;
  const b = s[Math.min(i + 1, s.length - 1)]!.color;
  const u = shape(u0, g.mode);
  return { r: a.r + (b.r - a.r) * u, g: a.g + (b.g - a.g) * u, b: a.b + (b.b - a.b) * u };
}

function evaluateAlpha(g: Gradient, t: number): number {
  const s = g.alphaStops;
  const [i, u0] = locate(
    s.map((x) => x.pos),
    clamp(t, 0, 1),
  );
  const a = s[i]!.alpha;
  const b = s[Math.min(i + 1, s.length - 1)]!.alpha;
  return a + (b - a) * shape(u0, g.mode);
}

/** Evaluate the gradient at t (clamped to 0..1). Expects a normalised gradient. */
function evaluate(g: Gradient, t: number): Rgba {
  return { ...evaluateColor(g, t), a: evaluateAlpha(g, t) };
}

/** Bake into a Float32 RGBA LUT of `width` texels, sampled at t = i/(width-1) (endpoints are exact). */
export function bakeLUT(g: Gradient, width: number): Float32Array {
  const w = Math.max(1, Math.floor(width));
  const out = new Float32Array(w * 4);
  for (let i = 0; i < w; i++) {
    const c = evaluate(g, w === 1 ? 0 : i / (w - 1));
    out.set([c.r, c.g, c.b, c.a], i * 4);
  }
  return out;
}

/** True when the gradient can be emitted inline (≤ maxStops of each kind) instead of a LUT texture. */
export function fitsInline(g: Gradient, maxStops = DEFAULT_MAX_STOPS): boolean {
  return g.colorStops.length <= maxStops && g.alphaStops.length <= maxStops;
}

/* ── stop operations (all pure; return the new gradient + the new index of the touched stop) ── */

export interface StopEdit {
  gradient: Gradient;
  index: number;
}

export function addColorStop(
  g: Gradient,
  pos: number,
  color?: { r: number; g: number; b: number },
  maxStops = DEFAULT_MAX_STOPS,
): StopEdit | null {
  if (g.colorStops.length >= maxStops) return null;
  const p = clamp(pos, 0, 1);
  const c = color ?? evaluateColor(g, p);
  const next = normalizeGradient({ ...g, colorStops: [...g.colorStops, { pos: p, color: { ...c } }] });
  return { gradient: next, index: lastIndexAt(next.colorStops, p) };
}

export function addAlphaStop(g: Gradient, pos: number, alpha?: number, maxStops = DEFAULT_MAX_STOPS): StopEdit | null {
  if (g.alphaStops.length >= maxStops) return null;
  const p = clamp(pos, 0, 1);
  const next = normalizeGradient({
    ...g,
    alphaStops: [...g.alphaStops, { pos: p, alpha: alpha ?? evaluateAlpha(g, p) }],
  });
  return { gradient: next, index: lastIndexAt(next.alphaStops, p) };
}

function lastIndexAt(stops: Array<{ pos: number }>, p: number): number {
  for (let i = stops.length - 1; i >= 0; i--) if (stops[i]!.pos === p) return i;
  return 0;
}

/** Re-insert the moved stop so ties resolve intuitively: moving right lands AFTER equal positions, moving left BEFORE them. */
function reinsert<T extends { pos: number }>(list: T[], index: number, moved: T): { list: T[]; index: number } {
  const old = list[index]!.pos;
  const rest = list.filter((_, i) => i !== index);
  let at = rest.findIndex((s) => (moved.pos >= old ? s.pos > moved.pos : s.pos >= moved.pos));
  if (at < 0) at = rest.length;
  rest.splice(at, 0, moved);
  return { list: rest, index: at };
}

export function moveColorStop(g: Gradient, index: number, pos: number): StopEdit {
  const moved = { ...g.colorStops[index]!, pos: clamp(pos, 0, 1) };
  const r = reinsert(g.colorStops, index, moved);
  return { gradient: { ...g, colorStops: r.list }, index: r.index };
}

export function moveAlphaStop(g: Gradient, index: number, pos: number): StopEdit {
  const moved = { ...g.alphaStops[index]!, pos: clamp(pos, 0, 1) };
  const r = reinsert(g.alphaStops, index, moved);
  return { gradient: { ...g, alphaStops: r.list }, index: r.index };
}

export function removeColorStop(g: Gradient, index: number): Gradient {
  if (g.colorStops.length <= 1) return g;
  return { ...g, colorStops: g.colorStops.filter((_, i) => i !== index) };
}
export function removeAlphaStop(g: Gradient, index: number): Gradient {
  if (g.alphaStops.length <= 1) return g;
  return { ...g, alphaStops: g.alphaStops.filter((_, i) => i !== index) };
}

export function setColorStopColor(g: Gradient, index: number, color: { r: number; g: number; b: number }): Gradient {
  return { ...g, colorStops: g.colorStops.map((s, i) => (i === index ? { ...s, color: { ...color } } : s)) };
}
export function setAlphaStopValue(g: Gradient, index: number, alpha: number): Gradient {
  return { ...g, alphaStops: g.alphaStops.map((s, i) => (i === index ? { ...s, alpha: clamp(alpha, 0, 1) } : s)) };
}

/** Mirror positions of both stop lists (the gradient plays backwards). */
export function reverseGradient(g: Gradient): Gradient {
  return normalizeGradient({
    ...g,
    colorStops: g.colorStops.map((s) => ({ ...s, pos: 1 - s.pos })),
    alphaStops: g.alphaStops.map((s) => ({ ...s, pos: 1 - s.pos })),
  });
}

/** Reverse only the colors (alpha untouched) — "flip colors". */
export function flipColors(g: Gradient): Gradient {
  return normalizeGradient({ ...g, colorStops: g.colorStops.map((s) => ({ ...s, pos: 1 - s.pos })) });
}
/** Reverse only the alpha ramp — "flip alpha". */
export function flipAlpha(g: Gradient): Gradient {
  return normalizeGradient({ ...g, alphaStops: g.alphaStops.map((s) => ({ ...s, pos: 1 - s.pos })) });
}

/** Spread both stop lists evenly over 0..1 keeping their order and values. */
export function distributeEvenly(g: Gradient): Gradient {
  const spread = <T extends { pos: number }>(a: T[]): T[] =>
    a.map((s, i) => ({ ...s, pos: a.length === 1 ? 0 : i / (a.length - 1) }));
  return { ...g, colorStops: spread(g.colorStops), alphaStops: spread(g.alphaStops) };
}

/* ── serialization ────────────────────────────────────────────────────── */

export interface GradientJson {
  mode: GradientMode;
  colorStops: Array<{ pos: number; r: number; g: number; b: number }>;
  alphaStops: Array<{ pos: number; a: number }>;
}

export function serializeGradient(g: Gradient): GradientJson {
  const f = (x: number) => Number(x.toFixed(6));
  return {
    mode: g.mode,
    colorStops: g.colorStops.map((s) => ({ pos: f(s.pos), r: f(s.color.r), g: f(s.color.g), b: f(s.color.b) })),
    alphaStops: g.alphaStops.map((s) => ({ pos: f(s.pos), a: f(s.alpha) })),
  };
}

/** Validate untrusted JSON → normalised Gradient, or null. */
export function parseGradient(j: unknown): Gradient | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const mode = o.mode;
  if (mode !== "linear" && mode !== "smooth" && mode !== "constant") return null;
  const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  if (!Array.isArray(o.colorStops) || !Array.isArray(o.alphaStops)) return null;
  const colorStops: ColorStop[] = [];
  for (const s of o.colorStops as Array<Record<string, unknown>>) {
    if (!s || !num(s.pos) || !num(s.r) || !num(s.g) || !num(s.b)) return null;
    colorStops.push({ pos: s.pos, color: { r: s.r, g: s.g, b: s.b } });
  }
  const alphaStops: AlphaStop[] = [];
  for (const s of o.alphaStops as Array<Record<string, unknown>>) {
    if (!s || !num(s.pos) || !num(s.a)) return null;
    alphaStops.push({ pos: s.pos, alpha: s.a });
  }
  return normalizeGradient({ mode, colorStops, alphaStops });
}
