import type { M, V } from "../procedural/irm";
import { SRGB_DECODE_KNEE, SRGB_ENCODE_KNEE } from "../../values/color";
import { EPS } from "./common";

/**
 * Colour maths on IR values . Pure functions of `V` so every colour node (and the tests) share one definition.
 * Colour spaces: nothing here converts implicitly. `emitSrgbToLinear` / `emitLinearToSrgb` (IR emitters — the numeric versions live in core/values/color.ts and share its knee constants) use the exact IEC 61966-2-1 piecewise curves.
 */

/** sRGB (encoded) → linear. Exact piecewise curve; negative values are mirrored (odd function), so the result is always finite. */
export function emitSrgbToLinear(m: M, c: V): V {
  const a = c.abs();
  const lo = a.div(12.92);
  const hi = a.add(0.055).div(1.055).pow(m.f(2.4).splat("vec3"));
  return m.fn("sign", c).mul(lo.mix(hi, m.step(SRGB_DECODE_KNEE, a)));
}

/** linear → sRGB (encoded). Exact piecewise curve (knee 0.0031308); negative values are mirrored. */
export function emitLinearToSrgb(m: M, c: V): V {
  const a = c.abs();
  const lo = a.mul(12.92);
  const hi = a
    .pow(m.f(1 / 2.4).splat("vec3"))
    .mul(1.055)
    .sub(0.055);
  return m.fn("sign", c).mul(lo.mix(hi, m.step(SRGB_ENCODE_KNEE, a)));
}

/** RGB → HSV: H in turns [0, 1) (red = 0, green = 1/3, blue = 2/3), S in [0, 1], V = max(r, g, b). Pure grey (and black) give H = 0, S = 0. */
export function rgbToHsv(m: M, rgb: V): { h: V; s: V; v: V } {
  const r = rgb.x,
    g = rgb.y,
    b = rgb.z;
  const v = r.max(g).max(b);
  const d = v.sub(r.min(g).min(b));
  const hasD = d.gt(0);
  const dd = m.sel(hasD, d, 1);
  const sector = m.sel(
    r.ge(v),
    g.sub(b).div(dd).mod(6),
    m.sel(g.ge(v), b.sub(r).div(dd).add(2), r.sub(g).div(dd).add(4)),
  );
  const h = m.sel(hasD, sector.div(6).fract(), 0);
  const s = m.sel(v.gt(0), d.div(m.sel(v.gt(0), v, 1)), 0);
  return { h, s, v };
}

/** HSV → RGB. H wraps (any real, in turns), S is used as given (S > 1 over-saturates and may go negative), V is unbounded (HDR). */
export function hsvToRgb(m: M, h: V, s: V, v: V): V {
  const k = m.k("vec3", 1, 2 / 3, 1 / 3);
  const p = m.v3(h, h, h).add(k).fract().mul(6).sub(3).abs().sub(1).clamp(0, 1);
  return m.k("vec3", 1, 1, 1).mix(p, s).mul(v);
}

export type LumaWeights = "rec709" | "rec601" | "average";
export const LUMA_OPTIONS: Array<[string, string]> = [
  ["rec709", "Rec.709 (linear light)"],
  ["rec601", "Rec.601"],
  ["average", "Average"],
];
const LUMA: Record<LumaWeights, [number, number, number]> = {
  rec709: [0.2126, 0.7152, 0.0722],
  rec601: [0.299, 0.587, 0.114],
  average: [1 / 3, 1 / 3, 1 / 3],
};
export const luma = (m: M, rgb: V, w: LumaWeights): V => rgb.dot(m.k("vec3", ...(LUMA[w] ?? LUMA.rec709)));

export type BlendMode =
  | "multiply"
  | "screen"
  | "overlay"
  | "softLight"
  | "hardLight"
  | "colorDodge"
  | "colorBurn"
  | "darken"
  | "lighten"
  | "difference"
  | "exclusion"
  | "add"
  | "subtract"
  | "divide"
  | "linearDodge"
  | "linearBurn";
export const BLEND_MODE_LIST: Array<[BlendMode, string]> = [
  ["multiply", "Multiply"],
  ["screen", "Screen"],
  ["overlay", "Overlay"],
  ["softLight", "Soft Light"],
  ["hardLight", "Hard Light"],
  ["colorDodge", "Color Dodge"],
  ["colorBurn", "Color Burn"],
  ["darken", "Darken"],
  ["lighten", "Lighten"],
  ["difference", "Difference"],
  ["exclusion", "Exclusion"],
  ["add", "Add"],
  ["subtract", "Subtract"],
  ["divide", "Divide"],
  ["linearDodge", "Linear Dodge"],
  ["linearBurn", "Linear Burn"],
];
/** Modes whose formula is only defined on 0…1: both operands are saturated first (documented). */
const CLAMPED_MODES: ReadonlySet<BlendMode> = new Set(["overlay", "softLight", "hardLight", "colorDodge", "colorBurn"]);

/**
 * Separable blend functions B(Cb, Cs) per channel (W3C Compositing and Blending Level 1 for the non-trivial ones).
 *  Cb = base (backdrop), Cs = blend (source). Dodge / burn / divide never divide by zero: denominators are floored at 1e-20,
 *  which reproduces the W3C special cases exactly (Cb = 0 → 0 for dodge, Cb = 1 → 1 for burn, Cs = 0 → 1 or 0 for divide).
 */
export function blendRgb(m: M, mode: BlendMode, base: V, src: V): V {
  const cb = CLAMPED_MODES.has(mode) ? base.clamp(0, 1) : base;
  const cs = CLAMPED_MODES.has(mode) ? src.clamp(0, 1) : src;
  const one = m.k("vec3", 1, 1, 1);
  switch (mode) {
    case "multiply":
      return cb.mul(cs);
    case "screen":
      return cb.add(cs).sub(cb.mul(cs));
    case "hardLight":
      return cb
        .mul(cs)
        .mul(2)
        .mix(one.sub(one.sub(cb).mul(one.sub(cs).mul(2))), m.step(0.5, cs));
    case "overlay":
      return cb
        .mul(cs)
        .mul(2)
        .mix(one.sub(one.sub(cs).mul(one.sub(cb).mul(2))), m.step(0.5, cb));
    case "softLight": {
      const low = cb.sub(one.sub(cs.mul(2)).mul(cb).mul(one.sub(cb)));
      const d = cb.mul(16).sub(12).mul(cb).add(4).mul(cb).mix(cb.sqrt(), m.step(0.25, cb));
      return low.mix(cb.add(cs.mul(2).sub(1).mul(d.sub(cb))), m.step(0.5, cs));
    }
    case "colorDodge":
      return cb.div(one.sub(cs).max(EPS)).min(1);
    case "colorBurn":
      return one.sub(one.sub(cb).div(cs.max(EPS)).min(1));
    case "darken":
      return cb.min(cs);
    case "lighten":
      return cb.max(cs);
    case "difference":
      return cb.sub(cs).abs();
    case "exclusion":
      return cb.add(cs).sub(cb.mul(cs).mul(2));
    case "add":
      return cb.add(cs);
    case "subtract":
      return cb.sub(cs);
    case "divide":
      return m
        .k("vec3", 0, 0, 0)
        .add(m.step(EPS, cb))
        .mix(cb.div(cs.max(EPS)), m.step(EPS, cs));
    case "linearDodge":
      return cb.add(cs).min(1);
    case "linearBurn":
      return cb.add(cs).sub(1).max(0);
  }
}
