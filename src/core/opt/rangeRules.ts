import type { ExprId, IRExpr } from "../ir/types";
import type { Simplified, SimplifyCtx } from "./simplify";

type Const = Extract<IRExpr, { op: "const" }>;
const constOf = (c: SimplifyCtx, id: ExprId | undefined): Const | undefined => {
  if (id === undefined) return undefined;
  const e = c.get(id);
  return e.op === "const" ? e : undefined;
};
const alias = (id: ExprId, rule: string): Simplified => ({ alias: id, rule });
const lit = (ty: "bool", v: boolean, rule: string): Simplified => ({
  expr: { op: "const", ty, value: [v ? 1 : 0] },
  rule,
});

/**
 * Range-driven rewrites . Every rule needs a PROVEN property from `range.ts`; with unproven operands none fires
 * (negative tests in `10d.range.*`). Rules that keep the result bit-identical on the reference evaluator are level 1;
 * the one that is only equal up to rounding (`normalize` of a unit vector) is level 2.
 */
export function rangeRules(e: IRExpr, c: SimplifyCtx): Simplified | undefined {
  if (e.op === "binary") return compareFold(e, c);
  if (e.op !== "intrinsic") return undefined;
  const a = e.args[0] === undefined ? undefined : c.range(e.args[0]);
  if (!a) return undefined;
  const same = (id: ExprId): boolean => c.get(id).ty === e.ty;
  const x = e.args[0]!;
  switch (e.fn) {
    case "saturate":
      // saturate(x) with x proven inside [0,1] (and not NaN, where saturate is implementation-defined) is x.
      if (a.lo >= 0 && a.hi <= 1 && !a.nan && same(x)) return alias(x, "range:redundant-saturate");
      return undefined;
    case "abs":
      if (a.lo >= 0 && same(x)) return alias(x, "range:redundant-abs");
      return undefined;
    case "floor":
    case "ceil":
    case "round":
    case "trunc":
      if (a.int && !a.nan && same(x)) return alias(x, "range:integer-rounding");
      return undefined;
    case "clamp": {
      const lo = constOf(c, e.args[1]);
      const hi = constOf(c, e.args[2]);
      if (lo && hi && a.lo >= Math.max(...lo.value) && a.hi <= Math.min(...hi.value) && !a.nan && same(x))
        return alias(x, "range:redundant-clamp");
      return undefined;
    }
    case "max":
    case "min": {
      // max(x, k) with x ≥ k ⇒ x   |   min(x, k) with x ≤ k ⇒ x   (either operand order; NaN-free only: min/max of NaN is implementation-defined)
      for (const [i, j] of [
        [0, 1],
        [1, 0],
      ] as const) {
        const k = constOf(c, e.args[j]);
        const v = e.args[i]!;
        const r = c.range(v);
        if (!k || r.nan || !same(v)) continue;
        if (e.fn === "max" && r.lo >= Math.max(...k.value)) return alias(v, "range:redundant-max");
        if (e.fn === "min" && r.hi <= Math.min(...k.value)) return alias(v, "range:redundant-min");
      }
      return undefined;
    }
    case "mod": {
      // floor-mod → fract. mod(x,1) is exactly fract(x). mod(x,y) for a constant y>0 and x proven ≥ 0 is fract(x/y)*y (level 2: rounding differs).
      const k = constOf(c, e.args[1]);
      if (!k || !k.value.every((v) => v > 0 && Number.isFinite(v))) return undefined;
      if (k.value.every((v) => v === 1) && same(x))
        return { expr: { op: "intrinsic", ty: e.ty, fn: "fract", args: [x] }, rule: "range:mod-to-fract" };
      if (c.level >= 2 && a.lo >= 0 && !a.nan && same(x)) {
        const recip = c.put({ op: "const", ty: k.ty, value: k.value.map((v) => 1 / v) });
        const q = c.put({ op: "binary", ty: e.ty, kind: "mul", a: x, b: recip });
        const f = c.put({ op: "intrinsic", ty: e.ty, fn: "fract", args: [q] });
        return { expr: { op: "binary", ty: e.ty, kind: "mul", a: f, b: e.args[1]! }, rule: "range:mod-to-fract" };
      }
      return undefined;
    }
    case "normalize":
      // normalize of a vector that is already unit length (e.g. normalize(normalize(v))): level 2 (1-ulp difference possible).
      if (c.level >= 2 && a.unitLen && same(x)) return alias(x, "range:double-normalize");
      return undefined;
    default:
      return undefined;
  }
}

/** a < b etc. decided by disjoint intervals (NaN-free operands only), so guards like `select(len > eps, …)` disappear when provable. */
function compareFold(e: Extract<IRExpr, { op: "binary" }>, c: SimplifyCtx): Simplified | undefined {
  if (!["lt", "le", "gt", "ge", "eq", "ne"].includes(e.kind)) return undefined;
  const a = c.range(e.a);
  const b = c.range(e.b);
  if (a.nan || b.nan) return undefined;
  switch (e.kind) {
    case "lt":
      return a.hi < b.lo
        ? lit("bool", true, "range:compare")
        : a.lo >= b.hi
          ? lit("bool", false, "range:compare")
          : undefined;
    case "le":
      return a.hi <= b.lo
        ? lit("bool", true, "range:compare")
        : a.lo > b.hi
          ? lit("bool", false, "range:compare")
          : undefined;
    case "gt":
      return a.lo > b.hi
        ? lit("bool", true, "range:compare")
        : a.hi <= b.lo
          ? lit("bool", false, "range:compare")
          : undefined;
    case "ge":
      return a.lo >= b.hi
        ? lit("bool", true, "range:compare")
        : a.hi < b.lo
          ? lit("bool", false, "range:compare")
          : undefined;
    case "eq":
      return a.hi < b.lo || a.lo > b.hi ? lit("bool", false, "range:compare") : undefined;
    case "ne":
      return a.hi < b.lo || a.lo > b.hi ? lit("bool", true, "range:compare") : undefined;
    default:
      return undefined;
  }
}
