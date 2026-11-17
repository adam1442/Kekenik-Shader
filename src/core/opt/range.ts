import { IHASH_MAX } from "../ir/ihash";
import type { ExprId, IRExpr } from "../ir/types";
import { INTRINSICS } from "../ir/intrinsics";

/**
 * Forward interval analysis . One `Range` is the HULL over all components of a value.
 *
 *  - `lo` / `hi` bound every non-NaN component (they may be ±Infinity = unbounded).
 *  - `nan`  — the value MAY contain NaN. "finite" (see `isFinite_`) means: no NaN and both bounds are finite numbers.
 *  - `int`  — every component is integer-valued (floor/round/int casts/integer constants).
 *  - `unitLen` — the (vector) value has length 1 (result of `normalize`, exact unit constants).
 *
 * Soundness rules: when in doubt the result is wider / `nan: true`. Inputs are only ever assumed NaN-free (mesh data and uniforms are
 * finite), never bounded: UVs may leave [0,1], interpolated normals are not unit length, colours may be HDR. See docs/OPTIMIZATION.md.
 */
export interface Range {
  lo: number;
  hi: number;
  nan: boolean;
  int: boolean;
  unitLen: boolean;
}

const UNKNOWN: Range = { lo: -Infinity, hi: Infinity, nan: true, int: false, unitLen: false };
const FREE: Range = { lo: -Infinity, hi: Infinity, nan: false, int: false, unitLen: false };
const F32_MAX = 3.4028234663852886e38;

const isFinite_ = (r: Range): boolean => !r.nan && Number.isFinite(r.lo) && Number.isFinite(r.hi);
export const isBounded = (r: Range): boolean => Number.isFinite(r.lo) && Number.isFinite(r.hi);
/** Flag view used by the rewrite rules and the documentation. */
export const flagsOf = (
  r: Range,
): {
  nonNegative: boolean;
  finite: boolean;
  nonZero: boolean;
  unit: boolean;
  unitLength: boolean;
  integerValued: boolean;
} => ({
  nonNegative: r.lo >= 0,
  finite: isFinite_(r),
  nonZero: r.lo > 0 || r.hi < 0,
  unit: r.lo >= 0 && r.hi <= 1,
  unitLength: r.unitLen,
  integerValued: r.int,
});

/** Build a range, widening anything outside float32 to ±Infinity and replacing NaN bounds conservatively. */
function mk(lo: number, hi: number, nan: boolean, int = false, unitLen = false): Range {
  if (Number.isNaN(lo)) lo = -Infinity;
  if (Number.isNaN(hi)) hi = Infinity;
  if (lo < -F32_MAX) lo = -Infinity;
  if (hi > F32_MAX) hi = Infinity;
  if (lo > hi) return { ...UNKNOWN };
  return { lo, hi, nan, int, unitLen };
}
const hull = (a: Range, b: Range): Range =>
  mk(Math.min(a.lo, b.lo), Math.max(a.hi, b.hi), a.nan || b.nan, a.int && b.int, a.unitLen && b.unitLen);
const open = (r: Range): boolean => !isBounded(r);

function mulBounds(a: Range, b: Range): [number, number] {
  const ps = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi].filter((p) => !Number.isNaN(p));
  if (ps.length === 0) return [-Infinity, Infinity];
  return [Math.min(...ps), Math.max(...ps)];
}

function intrinsicRange(e: Extract<IRExpr, { op: "intrinsic" }>, r: (id: ExprId) => Range): Range {
  const a = r(e.args[0]!);
  const b = e.args[1] === undefined ? UNKNOWN : r(e.args[1]);
  const c = e.args[2] === undefined ? UNKNOWN : r(e.args[2]);
  const any = a.nan || (e.args.length > 1 && b.nan) || (e.args.length > 2 && c.nan);
  const kind = INTRINSICS[e.fn].kind;
  if (kind === "dot") {
    if (e.args[0] === e.args[1]) return mk(0, Infinity, a.nan || open(a));
    if (a.unitLen && b.unitLen) return mk(-1, 1, any);
    return mk(-Infinity, Infinity, any || (open(a) && open(b)));
  }
  if (kind === "hash") return mk(0, IHASH_MAX, false);
  if (kind === "normalize") return mk(-1, 1, a.nan || !a.unitLen, false, true);
  if (kind === "length" || kind === "distance") return mk(0, Infinity, any || open(a));
  if (kind !== "cw") return { ...UNKNOWN };
  switch (e.fn) {
    case "sin":
    case "cos":
      return mk(-1, 1, a.nan || open(a));
    case "tan":
      return mk(-Infinity, Infinity, true);
    case "asin":
      return mk(-Math.PI / 2, Math.PI / 2, a.nan || a.lo < -1 || a.hi > 1);
    case "acos":
      return mk(0, Math.PI, a.nan || a.lo < -1 || a.hi > 1);
    case "atan":
      return mk(-Math.PI / 2, Math.PI / 2, a.nan);
    case "atan2":
      return mk(-Math.PI, Math.PI, any);
    case "exp":
      return mk(Math.exp(a.lo), Math.exp(a.hi), a.nan);
    case "exp2":
      return mk(Math.pow(2, a.lo), Math.pow(2, a.hi), a.nan);
    case "log":
    case "log2": {
      const f = e.fn === "log" ? Math.log : Math.log2;
      return a.lo >= 0
        ? mk(a.lo > 0 ? f(a.lo) : -Infinity, f(a.hi), a.nan)
        : mk(-Infinity, Number.isFinite(a.hi) ? f(Math.max(a.hi, 1e-38)) : Infinity, true);
    }
    case "sqrt":
      return a.lo >= 0 ? mk(Math.sqrt(a.lo), Math.sqrt(a.hi), a.nan) : mk(0, Math.sqrt(Math.max(a.hi, 0)), true);
    case "inversesqrt":
      return a.lo > 0 ? mk(1 / Math.sqrt(a.hi), 1 / Math.sqrt(a.lo), a.nan) : mk(0, Infinity, a.nan || a.lo < 0);
    case "abs": {
      if (a.lo >= 0) return a;
      if (a.hi <= 0) return mk(-a.hi, -a.lo, a.nan, a.int);
      return mk(0, Math.max(-a.lo, a.hi), a.nan, a.int);
    }
    case "sign":
      return mk(-1, 1, a.nan, true);
    case "floor":
      return mk(Math.floor(a.lo), Math.floor(a.hi), a.nan, true);
    case "ceil":
      return mk(Math.ceil(a.lo), Math.ceil(a.hi), a.nan, true);
    case "round":
      return mk(Math.round(a.lo), Math.round(a.hi), a.nan, true);
    case "trunc":
      return mk(Math.trunc(a.lo), Math.trunc(a.hi), a.nan, true);
    case "fract":
      return a.int && !a.nan ? mk(0, 0, false, true) : mk(0, 1, a.nan || open(a));
    case "mod":
      return b.lo > 0 ? mk(0, b.hi, any || open(a)) : { ...UNKNOWN };
    case "min":
      return mk(Math.min(a.lo, b.lo), Math.min(a.hi, b.hi), any, a.int && b.int);
    case "max":
      return mk(Math.max(a.lo, b.lo), Math.max(a.hi, b.hi), any, a.int && b.int);
    case "clamp":
      return mk(Math.min(Math.max(a.lo, b.lo), c.lo), Math.min(Math.max(a.hi, b.hi), c.hi), any || b.hi > c.lo);
    case "saturate":
      return mk(Math.min(Math.max(a.lo, 0), 1), Math.min(Math.max(a.hi, 0), 1), a.nan);
    case "mix": {
      if (!(c.lo >= 0 && c.hi <= 1) || a.nan || b.nan || c.nan) return mk(-Infinity, Infinity, any);
      const h = hull(a, b);
      const slack = 2.4e-7 * Math.max(Math.abs(h.lo), Math.abs(h.hi)); // a*(1-t)+b*t may overshoot the hull by rounding
      return mk(h.lo - slack, h.hi + slack, false);
    }
    case "step":
      return mk(0, 1, false, true);
    case "smoothstep":
      return mk(0, 1, any || !(a.hi < b.lo || b.hi < a.lo));
    case "radians":
      return mk(a.lo * 0.017453292519943295, a.hi * 0.017453292519943295, a.nan);
    case "degrees":
      return mk(a.lo * 57.29577951308232, a.hi * 57.29577951308232, a.nan);
    case "pow": {
      if (a.lo < 0 || any) return mk(-Infinity, Infinity, true);
      if (b.lo === b.hi && Number.isFinite(b.lo)) {
        const y = b.lo;
        const f = (x: number): number => Math.pow(x, y);
        return y >= 0
          ? mk(f(a.lo), f(a.hi), false)
          : mk(a.hi === Infinity ? 0 : f(a.hi), a.lo === 0 ? Infinity : f(a.lo), false);
      }
      return mk(0, Infinity, false);
    }
    default:
      return { ...UNKNOWN };
  }
}

/** Range of one expression from the ranges of its operands (`r`). Pure. */
export function rangeOf(e: IRExpr, r: (id: ExprId) => Range): Range {
  switch (e.op) {
    case "const": {
      if (e.ty === "bool") return mk(0, 1, false, true);
      const v = e.value;
      if (v.length === 0 || v.some((x) => Number.isNaN(x))) return { ...UNKNOWN };
      const len2 = v.reduce((s, x) => s + x * x, 0);
      return mk(Math.min(...v), Math.max(...v), false, v.every(Number.isInteger), v.length > 1 && len2 === 1);
    }
    case "unary": {
      const a = r(e.a);
      return e.kind === "not" ? mk(0, 1, false, true) : mk(-a.hi, -a.lo, a.nan, a.int, a.unitLen);
    }
    case "binary": {
      const a = r(e.a);
      const b = r(e.b);
      const nan = a.nan || b.nan;
      switch (e.kind) {
        case "lt":
        case "le":
        case "gt":
        case "ge":
        case "eq":
        case "ne":
        case "and":
        case "or":
          return mk(0, 1, false, true);
        case "add":
          return mk(a.lo + b.lo, a.hi + b.hi, nan || (open(a) && open(b)), a.int && b.int);
        case "sub":
          return mk(a.lo - b.hi, a.hi - b.lo, nan || (open(a) && open(b)), a.int && b.int);
        case "mul": {
          const [lo, hi] = mulBounds(a, b);
          return mk(
            lo,
            hi,
            nan || (open(a) && b.lo <= 0 && b.hi >= 0) || (open(b) && a.lo <= 0 && a.hi >= 0),
            a.int && b.int,
          );
        }
        case "div": {
          if (e.ty === "int" || !(b.lo > 0 || b.hi < 0)) return mk(-Infinity, Infinity, true);
          const inv = mk(1 / b.hi, 1 / b.lo, false);
          const [lo, hi] = mulBounds(a, inv);
          return mk(lo, hi, nan || (open(a) && open(inv)));
        }
      }
      return { ...UNKNOWN };
    }
    case "cast": {
      const a = r(e.src);
      if (e.ty === "bool") return mk(0, 1, false, true);
      if (e.ty === "int") return mk(Math.trunc(a.lo), Math.trunc(a.hi), false, true);
      return { ...a, unitLen: false };
    }
    case "select":
      return hull(r(e.a), r(e.b));
    case "swizzle": {
      const a = r(e.src);
      return { ...a, unitLen: false };
    }
    case "construct": {
      let h: Range | undefined;
      for (const id of e.args) {
        const x = r(id);
        h = h ? hull(h, x) : x;
      }
      return h ? { ...h, unitLen: false } : { ...UNKNOWN };
    }
    case "intrinsic":
      return intrinsicRange(e, r);
    case "input":
      if (e.input === "faceSign") return mk(-1, 1, false);
      if (e.input === "vertexId" || e.input === "instanceId") return mk(0, Infinity, false, true);
      return FREE;
    case "uniform":
      return e.ty === "bool" ? mk(0, 1, false, true) : FREE;
    case "sample":
    case "deriv":
    case "samplerState":
      return FREE;
    case "textureSize":
      return mk(0, Infinity, false);
    case "matmul":
      return { ...FREE, nan: r(e.a).nan || r(e.b).nan };
    default:
      return { ...UNKNOWN };
  }
}

/** Ranges of every expression of a body (used by tests / analysis; the optimiser keeps them incrementally). */
export function analyzeRanges(exprs: readonly IRExpr[]): Range[] {
  const out: Range[] = [];
  for (const e of exprs) out.push(rangeOf(e, (id) => out[id]!));
  return out;
}
