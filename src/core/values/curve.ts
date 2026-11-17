/**
 * Keyframe curve model (Unity AnimationCurve-like): Hermite segments, tangent modes, wrap modes, LUT baking.
 *
 * Tangent modes (per key): `auto` (smooth, overshoot-safe by default), `free` (both handles user-controlled & mirrored
 * in slope), `flat` (slope 0), `linear` (slopes toward neighbours), `constant` (stepped: holds the key's value until the
 * next key), `broken` (left and right sides independent; each side is free / linear / constant).
 * Tangents are SLOPES (dv/dt). Constant segments are flagged by the left key's out-side, not by an infinite slope.
 */
import { clamp } from "./numeric";

export type TangentMode = "auto" | "free" | "flat" | "linear" | "constant" | "broken";
export type SideMode = "free" | "linear" | "constant";
export type WrapMode = "clamp" | "loop" | "pingpong";

export interface Key {
  t: number;
  v: number;
  inTan: number;
  outTan: number;
  mode: TangentMode;
  /** Only used when mode === "broken". */
  inSide?: SideMode;
  outSide?: SideMode;
}

export interface Curve {
  keys: Key[];
  preWrap: WrapMode;
  postWrap: WrapMode;
  /** Auto tangents never overshoot neighbouring key values (monotone cubic). Default true. */
  overshootSafe: boolean;
}

const MIN_KEY_GAP = 1e-4;

export function makeKey(t: number, v: number, mode: TangentMode = "auto", inTan = 0, outTan = 0): Key {
  return { t, v, inTan, outTan, mode };
}

export function makeCurve(keys: Key[], opts: Partial<Omit<Curve, "keys">> = {}): Curve {
  return solveTangents({
    keys: keys.map((k) => ({ ...k })),
    preWrap: "clamp",
    postWrap: "clamp",
    overshootSafe: true,
    ...opts,
  });
}

/** Which behaviour each side of a key follows. */
export function sideOf(k: Key, side: "in" | "out"): SideMode | "auto" | "flat" {
  if (k.mode === "broken") return (side === "in" ? k.inSide : k.outSide) ?? "free";
  if (k.mode === "auto" || k.mode === "flat") return k.mode;
  return k.mode; // free | linear | constant
}

/** Slope used for the PCHIP / Catmull-Rom auto tangent of key `i`. */
function autoSlope(keys: Key[], i: number, safe: boolean): number {
  const n = keys.length;
  if (n < 2 || i === 0 || i === n - 1) return 0;
  const p = keys[i - 1]!;
  const k = keys[i]!;
  const q = keys[i + 1]!;
  const h0 = k.t - p.t;
  const h1 = q.t - k.t;
  const d0 = (k.v - p.v) / h0;
  const d1 = (q.v - k.v) / h1;
  if (!safe) return (q.v - p.v) / (q.t - p.t);
  if (d0 * d1 <= 0) return 0; // local extremum or plateau → flat, no overshoot
  const w1 = 2 * h1 + h0;
  const w2 = h1 + 2 * h0;
  return (w1 + w2) / (w1 / d0 + w2 / d1);
}

/** Recompute tangents that are derived from neighbours (auto / flat / linear sides). Returns a new curve. */
export function solveTangents(c: Curve): Curve {
  const keys = c.keys.map((k) => ({ ...k }));
  keys.forEach((k, i) => {
    const prev = keys[i - 1];
    const next = keys[i + 1];
    const slopeIn = prev ? (k.v - prev.v) / (k.t - prev.t) : 0;
    const slopeOut = next ? (next.v - k.v) / (next.t - k.t) : 0;
    const resolve = (side: "in" | "out"): number | null => {
      const s = sideOf(k, side);
      if (s === "auto") return autoSlope(keys, i, c.overshootSafe);
      if (s === "flat") return 0;
      if (s === "linear") return side === "in" ? slopeIn : slopeOut;
      if (s === "constant") return 0;
      return null; // free: keep stored
    };
    const a = resolve("in");
    const b = resolve("out");
    if (k.mode === "free") {
      // free = user-set slope, mirrored on both sides (smooth handle)
      k.outTan = k.inTan = k.outTan;
    } else {
      if (a !== null) k.inTan = a;
      if (b !== null) k.outTan = b;
    }
  });
  return { ...c, keys };
}

function wrapT(t: number, t0: number, t1: number, mode: WrapMode, before: boolean): number {
  const len = t1 - t0;
  if (len <= 0 || mode === "clamp") return before ? t0 : t1;
  const u = (t - t0) / len;
  if (mode === "loop") return t0 + (u - Math.floor(u)) * len;
  const m = ((u % 2) + 2) % 2; // pingpong
  return t0 + (m <= 1 ? m : 2 - m) * len;
}

/** Evaluate the curve at time t (applies wrap modes outside the key range). Empty curve → 0. */
export function evaluate(c: Curve, t: number): number {
  const keys = c.keys;
  const n = keys.length;
  if (n === 0) return 0;
  if (n === 1) return keys[0]!.v;
  const t0 = keys[0]!.t;
  const t1 = keys[n - 1]!.t;
  if (t < t0) t = wrapT(t, t0, t1, c.preWrap, true);
  else if (t > t1) t = wrapT(t, t0, t1, c.postWrap, false);
  if (t <= t0) return keys[0]!.v;
  if (t >= t1) return keys[n - 1]!.v;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid]!.t <= t) lo = mid;
    else hi = mid;
  }
  const a = keys[lo]!;
  const b = keys[hi]!;
  if (sideOf(a, "out") === "constant") return a.v;
  const dt = b.t - a.t;
  const s = (t - a.t) / dt;
  const s2 = s * s;
  const s3 = s2 * s;
  const m0 = a.outTan * dt;
  const m1 = (sideOf(b, "in") === "constant" ? 0 : b.inTan) * dt;
  return (2 * s3 - 3 * s2 + 1) * a.v + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * b.v + (s3 - s2) * m1;
}

/** Bake `n` samples across [t0, t1] (default: the key range, or 0..1 when empty). Endpoints are exact. */
function bakeLUT(c: Curve, n: number, t0?: number, t1?: number): Float32Array {
  const count = Math.max(1, Math.floor(n));
  const a = t0 ?? c.keys[0]?.t ?? 0;
  const b = t1 ?? c.keys[c.keys.length - 1]?.t ?? 1;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = evaluate(c, count === 1 ? a : a + ((b - a) * i) / (count - 1));
  return out;
}

/** Bake several channel curves interleaved (e.g. 4 curves → RGBA LUT of n texels). */
export function bakeMultiLUT(curves: Curve[], n: number, t0 = 0, t1 = 1): Float32Array {
  const ch = curves.length;
  const out = new Float32Array(n * ch);
  for (let c = 0; c < ch; c++) {
    const l = bakeLUT(curves[c]!, n, t0, t1);
    for (let i = 0; i < n; i++) out[i * ch + c] = l[i]!;
  }
  return out;
}

/** [min,max] of the curve value over its key range (sampled; includes handles' effect). */
export function valueRange(c: Curve, samples = 128): [number, number] {
  if (c.keys.length === 0) return [0, 1];
  let lo = Infinity;
  let hi = -Infinity;
  const a = c.keys[0]!.t;
  const b = c.keys[c.keys.length - 1]!.t;
  for (let i = 0; i <= samples; i++) {
    const v = evaluate(c, b > a ? a + ((b - a) * i) / samples : a);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (const k of c.keys) {
    lo = Math.min(lo, k.v);
    hi = Math.max(hi, k.v);
  }
  return [lo, hi];
}

/* ── key operations (pure) ────────────────────────────────────────────── */

export interface KeyEdit {
  curve: Curve;
  index: number;
}

export interface UnitBox {
  /** Clamp key times/values to [0,1] (normalised mode). */
  unit?: boolean;
}

export function addKey(c: Curve, t: number, v?: number, opts: UnitBox = {}): KeyEdit {
  const tt = opts.unit ? clamp(t, 0, 1) : t;
  let vv = v ?? evaluate(c, tt);
  if (opts.unit) vv = clamp(vv, 0, 1);
  const near = c.keys.findIndex((k) => Math.abs(k.t - tt) < MIN_KEY_GAP);
  if (near >= 0) return { curve: c, index: near };
  const keys = [...c.keys, makeKey(tt, vv, "auto")].sort((a, b) => a.t - b.t);
  const index = keys.findIndex((k) => k.t === tt);
  return { curve: solveTangents({ ...c, keys }), index };
}

/** Move key `i` to (t, v); time is clamped between its neighbours (keys never cross). */
export function moveKey(c: Curve, i: number, t: number, v: number, opts: UnitBox = {}): Curve {
  const prev = c.keys[i - 1];
  const next = c.keys[i + 1];
  let lo = prev ? prev.t + MIN_KEY_GAP : -Infinity;
  let hi = next ? next.t - MIN_KEY_GAP : Infinity;
  if (opts.unit) {
    lo = Math.max(lo, 0);
    hi = Math.min(hi, 1);
  }
  const tt = clamp(t, lo, hi);
  const vv = opts.unit ? clamp(v, 0, 1) : v;
  const keys = c.keys.map((k, j) => (j === i ? { ...k, t: tt, v: vv } : k));
  return solveTangents({ ...c, keys });
}

/** Move several keys by a delta; the whole selection is limited so no key crosses an unselected neighbour. */
export function moveKeys(c: Curve, indices: number[], dt: number, dv: number, opts: UnitBox = {}): Curve {
  const sel = new Set(indices);
  let lo = -Infinity;
  let hi = Infinity;
  for (const i of sel) {
    const k = c.keys[i]!;
    const p = c.keys[i - 1];
    const q = c.keys[i + 1];
    if (p && !sel.has(i - 1)) lo = Math.max(lo, p.t + MIN_KEY_GAP - k.t);
    if (q && !sel.has(i + 1)) hi = Math.min(hi, q.t - MIN_KEY_GAP - k.t);
    if (opts.unit) {
      lo = Math.max(lo, -k.t);
      hi = Math.min(hi, 1 - k.t);
    }
  }
  const ddt = clamp(dt, lo, hi);
  const keys = c.keys.map((k, i) => {
    if (!sel.has(i)) return k;
    const v = opts.unit ? clamp(k.v + dv, 0, 1) : k.v + dv;
    return { ...k, t: k.t + ddt, v };
  });
  return solveTangents({ ...c, keys });
}

export function removeKey(c: Curve, i: number): Curve {
  if (c.keys.length <= 1) return c;
  return solveTangents({ ...c, keys: c.keys.filter((_, j) => j !== i) });
}

export function setKeyMode(c: Curve, i: number, mode: TangentMode): Curve {
  const keys = c.keys.map((k, j) => {
    if (j !== i) return k;
    const out: Key = { ...k, mode };
    if (mode === "broken") {
      out.inSide = out.inSide ?? "free";
      out.outSide = out.outSide ?? "free";
    }
    return out;
  });
  return solveTangents({ ...c, keys });
}

/** Set a handle's slope. Free keys mirror it; auto/flat/linear keys switch to `broken` on that side only (free). */
export function setTangent(c: Curve, i: number, side: "in" | "out", slope: number): Curve {
  const keys = c.keys.map((k, j) => {
    if (j !== i) return k;
    if (k.mode === "free") return { ...k, inTan: slope, outTan: slope };
    const cur = {
      ...k,
      mode: "broken" as TangentMode,
      inSide: k.mode === "broken" ? k.inSide : ((sideOf(k, "in") === "constant" ? "constant" : "free") as SideMode),
      outSide: k.mode === "broken" ? k.outSide : ((sideOf(k, "out") === "constant" ? "constant" : "free") as SideMode),
    };
    if (side === "in") return { ...cur, inSide: "free" as SideMode, inTan: slope };
    return { ...cur, outSide: "free" as SideMode, outTan: slope };
  });
  return solveTangents({ ...c, keys });
}

export function setWrap(c: Curve, pre: WrapMode, post: WrapMode): Curve {
  return { ...c, preWrap: pre, postWrap: post };
}

/* ── serialization ────────────────────────────────────────────────────── */

export function serializeCurve(c: Curve): unknown {
  const f = (x: number) => Number(x.toFixed(6));
  return {
    preWrap: c.preWrap,
    postWrap: c.postWrap,
    overshootSafe: c.overshootSafe,
    keys: c.keys.map((k) => ({
      t: f(k.t),
      v: f(k.v),
      inTan: f(k.inTan),
      outTan: f(k.outTan),
      mode: k.mode,
      ...(k.mode === "broken" ? { inSide: k.inSide ?? "free", outSide: k.outSide ?? "free" } : {}),
    })),
  };
}

const MODES: TangentMode[] = ["auto", "free", "flat", "linear", "constant", "broken"];
const WRAPS: WrapMode[] = ["clamp", "loop", "pingpong"];
const SIDES: SideMode[] = ["free", "linear", "constant"];

export function parseCurve(j: unknown): Curve | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  if (!Array.isArray(o.keys)) return null;
  if (!WRAPS.includes(o.preWrap as WrapMode) || !WRAPS.includes(o.postWrap as WrapMode)) return null;
  const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
  const keys: Key[] = [];
  for (const raw of o.keys as Array<Record<string, unknown>>) {
    if (
      !raw ||
      !num(raw.t) ||
      !num(raw.v) ||
      !num(raw.inTan) ||
      !num(raw.outTan) ||
      !MODES.includes(raw.mode as TangentMode)
    )
      return null;
    const k: Key = { t: raw.t, v: raw.v, inTan: raw.inTan, outTan: raw.outTan, mode: raw.mode as TangentMode };
    if (k.mode === "broken") {
      k.inSide = SIDES.includes(raw.inSide as SideMode) ? (raw.inSide as SideMode) : "free";
      k.outSide = SIDES.includes(raw.outSide as SideMode) ? (raw.outSide as SideMode) : "free";
    }
    keys.push(k);
  }
  keys.sort((a, b) => a.t - b.t);
  return makeCurve(keys, {
    preWrap: o.preWrap as WrapMode,
    postWrap: o.postWrap as WrapMode,
    overshootSafe: o.overshootSafe !== false,
  });
}
