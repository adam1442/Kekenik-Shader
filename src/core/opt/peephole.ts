import type { ExprId, IRExpr } from "../ir/types";
import type { Simplified, SimplifyCtx } from "./simplify";

type Const = Extract<IRExpr, { op: "const" }>;
const constOf = (c: SimplifyCtx, id: ExprId | undefined): Const | undefined => {
  if (id === undefined) return undefined;
  const e = c.get(id);
  return e.op === "const" ? e : undefined;
};
const FLOATY = new Set(["float", "vec2", "vec3", "vec4"]);
const uniformConst = (k: Const): number | undefined =>
  k.value.length > 0 && k.value.every((v) => v === k.value[0]) ? k.value[0] : undefined;
const isPow2 = (v: number): boolean => {
  const a = Math.abs(v);
  if (!Number.isFinite(a) || a === 0) return false;
  const l = Math.log2(a);
  return Number.isInteger(l) && Math.abs(l) <= 100;
};

/**
 * Peephole / strength-reduction rules . Level 1 rules are exact on the reference evaluator (and at most a few ULPs
 * apart on a GPU); level 2 rules are "fast-math" (may differ for NaN / Inf / negative-base pow, or by rounding).
 * Each returns a rule id used by the optimisation report.
 */
export function peephole(e: IRExpr, c: SimplifyCtx): Simplified | undefined {
  switch (e.op) {
    case "binary":
      return binaryRules(e, c);
    case "intrinsic":
      return intrinsicRules(e, c);
    case "select":
      return selectRules(e, c);
    default:
      return undefined;
  }
}

function binaryRules(e: Extract<IRExpr, { op: "binary" }>, c: SimplifyCtx): Simplified | undefined {
  if (!FLOATY.has(e.ty)) return undefined;
  const A = c.get(e.a);
  if (e.kind === "div") {
    // x / c → x * (1/c): exact when c is a power of two (level 1); any finite non-zero c at level 2.
    const k = constOf(c, e.b);
    if (
      k &&
      k.value.length > 0 &&
      k.value.every((v) => Number.isFinite(v) && v !== 0 && Number.isFinite(1 / v) && 1 / v !== 0)
    ) {
      const exact = k.value.every(isPow2);
      if (exact || c.level >= 2) {
        const recip = c.put({ op: "const", ty: k.ty, value: k.value.map((v) => 1 / v) });
        return {
          expr: { op: "binary", ty: e.ty, kind: "mul", a: e.a, b: recip },
          rule: exact ? "peephole:div→mul(pow2)" : "peephole:div→mul",
        };
      }
    }
  }
  if (
    e.kind === "mul" &&
    c.level >= 2 &&
    e.a === e.b &&
    A.op === "intrinsic" &&
    A.fn === "length" &&
    c.get(A.args[0]!).ty !== "float"
  ) {
    // length(v)² → dot(v,v): drops the square root (rounding differs in the last bit).
    return {
      expr: { op: "intrinsic", ty: "float", fn: "dot", args: [A.args[0]!, A.args[0]!] },
      rule: "peephole:length²→dot",
    };
  }
  return undefined;
}

function intrinsicRules(e: Extract<IRExpr, { op: "intrinsic" }>, c: SimplifyCtx): Simplified | undefined {
  const x = e.args[0];
  if (x === undefined) return undefined;
  const X = c.get(x);
  switch (e.fn) {
    case "clamp": {
      const lo = constOf(c, e.args[1]);
      const hi = constOf(c, e.args[2]);
      if (lo && hi && lo.value.every((v) => v === 0) && hi.value.every((v) => v === 1) && X.ty === e.ty)
        return { expr: { op: "intrinsic", ty: e.ty, fn: "saturate", args: [x] }, rule: "peephole:clamp01→saturate" };
      return undefined;
    }
    case "min": {
      // min(max(x,0),1) → saturate(x)
      const one = constOf(c, e.args[1]);
      if (one && one.value.every((v) => v === 1) && X.op === "intrinsic" && X.fn === "max") {
        const zero = constOf(c, X.args[1]);
        if (zero && zero.value.every((v) => v === 0) && c.get(X.args[0]!).ty === e.ty)
          return {
            expr: { op: "intrinsic", ty: e.ty, fn: "saturate", args: [X.args[0]!] },
            rule: "peephole:clamp01→saturate",
          };
      }
      return undefined;
    }
    case "sqrt": {
      // sqrt(dot(v,v)) → length(v)
      if (X.op === "intrinsic" && X.fn === "dot" && X.args[0] === X.args[1])
        return {
          expr: { op: "intrinsic", ty: "float", fn: "length", args: [X.args[0]!] },
          rule: "peephole:sqrt(dot)→length",
        };
      return undefined;
    }
    case "pow": {
      if (c.level < 2 || X.ty !== e.ty) return undefined;
      const k = constOf(c, e.args[1]);
      const p = k ? uniformConst(k) : undefined;
      if (p === undefined) return undefined;
      const mul = (a: ExprId, b: ExprId): ExprId => c.put({ op: "binary", ty: e.ty, kind: "mul", a, b });
      const one = (): ExprId =>
        c.put({
          op: "const",
          ty: e.ty,
          value: new Array<number>(Math.max(1, e.ty === "float" ? 1 : Number(e.ty.slice(3)))).fill(1),
        });
      switch (p) {
        case 2:
          return { expr: { op: "binary", ty: e.ty, kind: "mul", a: x, b: x }, rule: "peephole:pow→mul" };
        case 3:
          return { expr: { op: "binary", ty: e.ty, kind: "mul", a: mul(x, x), b: x }, rule: "peephole:pow→mul" };
        case 0.5:
          return { expr: { op: "intrinsic", ty: e.ty, fn: "sqrt", args: [x] }, rule: "peephole:pow→sqrt" };
        case -0.5:
          return { expr: { op: "intrinsic", ty: e.ty, fn: "inversesqrt", args: [x] }, rule: "peephole:pow→rsqrt" };
        case -1:
          return { expr: { op: "binary", ty: e.ty, kind: "div", a: one(), b: x }, rule: "peephole:pow→rcp" };
        case 0:
          return {
            expr: {
              op: "const",
              ty: e.ty,
              value: new Array<number>(e.ty === "float" ? 1 : Number(e.ty.slice(3))).fill(1),
            },
            rule: "peephole:pow0",
          };
        default:
          return undefined;
      }
    }
    default:
      return undefined;
  }
}

/** select(x ≥ e, 1, 0) → step(e, x) — exact when x and e are NaN-free (step and `>=` disagree on NaN), so level 2 or proven finite. */
function selectRules(e: Extract<IRExpr, { op: "select" }>, c: SimplifyCtx): Simplified | undefined {
  if (e.ty !== "float") return undefined;
  const cond = c.get(e.cond);
  const t = constOf(c, e.a);
  const f = constOf(c, e.b);
  if (cond.op !== "binary" || !t || !f) return undefined;
  const ok = (): boolean => c.level >= 2 || (!c.range(cond.a).nan && !c.range(cond.b).nan);
  if (cond.kind === "ge" && t.value[0] === 1 && f.value[0] === 0 && ok() && c.get(cond.a).ty === "float") {
    return { expr: { op: "intrinsic", ty: "float", fn: "step", args: [cond.b, cond.a] }, rule: "peephole:select→step" };
  }
  if (cond.kind === "lt" && t.value[0] === 0 && f.value[0] === 1 && ok() && c.get(cond.a).ty === "float") {
    return { expr: { op: "intrinsic", ty: "float", fn: "step", args: [cond.b, cond.a] }, rule: "peephole:select→step" };
  }
  return undefined;
}
