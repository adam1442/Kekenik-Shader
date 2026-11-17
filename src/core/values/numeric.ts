/** Pure numeric helpers shared by every numeric control (no DOM). */

const FINE_MULT = 0.1;
const COARSE_MULT = 10;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Number of decimals needed to represent `n` exactly in shortest form (handles exponent notation). */
export function decimalsOf(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const s = n.toString();
  const ei = s.indexOf("e-");
  if (ei >= 0) {
    const mant = s.slice(0, ei);
    return Number(s.slice(ei + 2)) + (mant.split(".")[1] ?? "").length;
  }
  return (s.split(".")[1] ?? "").length;
}

/** Round to `digits` decimals (digits is capped to 12) — float-noise free (0.1+0.2 → 0.3). */
export function roundTo(v: number, digits: number): number {
  const d = Math.max(0, Math.min(12, Math.floor(digits)));
  const r = Number(v.toFixed(d));
  return r === 0 ? 0 : r;
}

/** Add `delta` to `value` without binary-float noise: result keeps the finest decimals of both operands. */
export function safeAdd(value: number, delta: number): number {
  return roundTo(value + delta, Math.max(decimalsOf(value), decimalsOf(delta)));
}

/** Snap to the nearest multiple of `step` (anchored at `origin`), float-noise free. */
export function snapToStep(v: number, step: number, origin = 0): number {
  if (!(step > 0)) return v;
  const n = Math.round((v - origin) / step);
  return roundTo(origin + n * step, Math.max(decimalsOf(step), decimalsOf(origin)));
}

export interface NumRange {
  /** Hard limits: typing and every other input path is clamped to these. */
  min?: number;
  max?: number;
  /** Soft limits: dragging / stepping / sliders stop here, but typing may exceed them up to the hard limits. */
  softMin?: number;
  softMax?: number;
}

export type LimitMode = "soft" | "hard";

export function limitsOf(r: NumRange, mode: LimitMode): { lo: number; hi: number } {
  const lo = mode === "soft" ? Math.max(r.min ?? -Infinity, r.softMin ?? -Infinity) : (r.min ?? -Infinity);
  const hi = mode === "soft" ? Math.min(r.max ?? Infinity, r.softMax ?? Infinity) : (r.max ?? Infinity);
  return { lo, hi };
}

/** Clamp to the soft range (scrub/step/slider) or the hard range (typing/paste). */
export function clampRange(v: number, r: NumRange, mode: LimitMode): number {
  const { lo, hi } = limitsOf(r, mode);
  return clamp(v, lo, hi);
}

export interface Modifiers {
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  alt?: boolean;
}

/** Shift = fine (×0.1), Ctrl/Cmd = coarse (×10). */
export function modMultiplier(m: Modifiers): number {
  return m.shift ? FINE_MULT : m.ctrl || m.meta ? COARSE_MULT : 1;
}

export interface ScrubConfig extends NumRange {
  /** Value units per pixel at ×1. */
  perPx: number;
  step: number;
  precision: number;
  integer?: boolean;
}

/**
 * One scrub update. `raw` is the unquantised accumulator (so slow drags with tiny deltas still progress);
 * the returned `value` is quantised (Alt = snap to `step`) and clamped to the soft range.
 */
export function scrubStep(raw: number, dx: number, cfg: ScrubConfig, mods: Modifiers): { raw: number; value: number } {
  const next = clamp(raw + dx * cfg.perPx * modMultiplier(mods), ...rangeTuple(cfg));
  let value: number;
  if (cfg.integer) value = Math.round(next);
  else if (mods.alt) value = snapToStep(next, cfg.step);
  else value = roundTo(next, cfg.precision);
  value = clampRange(value, cfg, "soft");
  return { raw: next, value };
}

function rangeTuple(cfg: NumRange): [number, number] {
  const { lo, hi } = limitsOf(cfg, "soft");
  return [lo, hi];
}

/** Arrow-key / wheel step with modifiers; Alt snaps to the step grid first. */
export function stepValue(
  value: number,
  dir: 1 | -1,
  step: number,
  mods: Modifiers,
  r: NumRange,
  integer = false,
): number {
  const delta = step * modMultiplier(mods) * dir;
  let next = mods.alt ? snapToStep(value + delta, step) : safeAdd(value, delta);
  if (integer) next = Math.round(next);
  return clampRange(next, r, "soft");
}

/** Default display precision for a step. */
export function defaultPrecision(step: number): number {
  return Math.max(decimalsOf(step), step >= 1 ? 0 : 3);
}

/** Format with fixed decimals; `trim` strips trailing zeros. `-0` is shown as `0`. NaN/Infinity → "—". */
export function formatFixed(v: number, precision: number, trim = true): string {
  if (!Number.isFinite(v)) return "\u2014";
  const s = v.toFixed(Math.max(0, Math.min(12, precision)));
  const out = trim && s.includes(".") ? s.replace(/\.?0+$/, "") || "0" : s;
  return out === "-0" ? "0" : out;
}

export function formatHex(n: number, minDigits = 2): string {
  const v = Math.max(0, Math.round(n));
  return "0x" + v.toString(16).toUpperCase().padStart(minDigits, "0");
}

/** Parse "0x1F" / "#1f" hex integers; returns null when not hex. */
export function parseHexInt(text: string): number | null {
  const m = /^\s*(?:0x|#)([0-9a-f]+)\s*$/i.exec(text);
  return m ? parseInt(m[1]!, 16) : null;
}

/** Wrap an angle into [0, period). */
export function wrapAngle(v: number, period: number): number {
  const r = v % period;
  return r < 0 ? r + period : r === 0 ? 0 : r;
}

export function deg2rad(d: number): number {
  return (d * Math.PI) / 180;
}
export function rad2deg(r: number): number {
  return (r * 180) / Math.PI;
}
