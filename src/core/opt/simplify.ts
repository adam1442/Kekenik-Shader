import type { StorageType } from "../types/shaderType";
import { componentCount } from "../types/shaderType";
import type { ExprId, IRExpr } from "../ir/types";
import type { Range } from "./range";
import { peephole } from "./peephole";
import { rangeRules } from "./rangeRules";
import { sampleRules } from "./sampleRules";

export type OptLevel = 0 | 1 | 2;

/** Services of the rebuild loop. `get` reads already-rebuilt expressions. */
export interface SimplifyCtx {
  level: OptLevel;
  get(id: ExprId): IRExpr;
  /** Intern an expression into the rebuilt body (used for helper constants). */
  put(e: IRExpr): ExprId;
  /** Interval facts of an already-rebuilt expression (, `range.ts`). */
  range(id: ExprId): Range;
}

/** Result: an existing expression to alias, or a replacement expression to intern. */
export type Simplified = ({ alias: ExprId } | { expr: IRExpr }) & { rule?: string };

const allEq = (e: IRExpr, v: number): boolean => e.op === "const" && e.value.every((x) => x === v);
const zeroOf = (ty: StorageType): IRExpr => ({ op: "const", ty, value: new Array<number>(componentCount(ty)).fill(0) });
const IDEMPOTENT = new Set(["abs", "saturate", "floor", "ceil", "round", "trunc"]);
const COMMUTATIVE = new Set(["add", "mul", "and", "or", "eq", "ne"]);
const COMPONENTS = "xyzw";

/**
 * Algebraic simplification of ONE expression whose operands are already rebuilt. Level 1 only applies identities that
 * are exact in IEEE arithmetic; level 2 ("fast-math") may change results for NaN / Inf / negative-base inputs.
 */
export function simplify(e: IRExpr, c: SimplifyCtx): Simplified | undefined {
  return basicRules(e, c) ?? rangeRules(e, c) ?? peephole(e, c) ?? sampleRules(e, c);
}

function basicRules(e: IRExpr, c: SimplifyCtx): Simplified | undefined {
  const same = (id: ExprId): boolean => c.get(id).ty === e.ty;
  switch (e.op) {
    case "unary": {
      const a = c.get(e.a);
      if (a.op === "unary" && a.kind === e.kind) return { alias: a.a };
      return undefined;
    }
    case "binary": {
      const A = c.get(e.a);
      const B = c.get(e.b);
      const num = e.ty === "float" || e.ty === "int" || e.ty === "vec2" || e.ty === "vec3" || e.ty === "vec4";
      if (num) {
        if (e.kind === "add" && allEq(B, 0) && same(e.a)) return { alias: e.a };
        if (e.kind === "add" && allEq(A, 0) && same(e.b)) return { alias: e.b };
        if (e.kind === "sub" && allEq(B, 0) && same(e.a)) return { alias: e.a };
        if (e.kind === "mul" && allEq(B, 1) && same(e.a)) return { alias: e.a };
        if (e.kind === "mul" && allEq(A, 1) && same(e.b)) return { alias: e.b };
        if (e.kind === "div" && allEq(B, 1) && same(e.a)) return { alias: e.a };
        if (c.level >= 2 && e.kind === "mul" && (allEq(A, 0) || allEq(B, 0))) return { expr: zeroOf(e.ty) };
        if (c.level >= 2 && e.kind === "sub" && e.a === e.b) return { expr: zeroOf(e.ty) };
      }
      if (e.ty === "bool" && (e.kind === "and" || e.kind === "or")) {
        const one = e.kind === "and" ? 1 : 0; // identity element
        if (allEq(B, one)) return { alias: e.a };
        if (allEq(A, one)) return { alias: e.b };
        if (B.op === "const" || A.op === "const") {
          const k = (B.op === "const" ? B : A) as Extract<IRExpr, { op: "const" }>;
          if (k.value[0] === 1 - one) return { expr: k }; // and(x,false) / or(x,true)
        }
      }
      // Canonical operand order lets CSE merge a*b with b*a (commutative IEEE ops; only when no broadcast is involved).
      if (COMMUTATIVE.has(e.kind) && e.a > e.b && A.ty === B.ty) return { expr: { ...e, a: e.b, b: e.a } };
      return undefined;
    }
    case "select": {
      const cond = c.get(e.cond);
      if (cond.op === "const") return { alias: cond.value[0] ? e.a : e.b };
      if (e.a === e.b) return { alias: e.a };
      return undefined;
    }
    case "swizzle": {
      const S = c.get(e.src);
      let mask = e.mask;
      let src = e.src;
      if (S.op === "swizzle") {
        mask = mask
          .split("")
          .map((ch) => S.mask[COMPONENTS.indexOf(ch)])
          .join("");
        src = S.src;
      }
      const st = c.get(src).ty;
      if (mask === COMPONENTS.slice(0, mask.length) && st === e.ty) return { alias: src };
      const base = c.get(src);
      if (mask.length === 1 && base.op === "construct" && base.args.every((a) => c.get(a).ty === "float")) {
        // `construct(x)` with one scalar argument is a splat: every component is that argument (fix.opt.swizzle-of-splat).
        const arg = base.args.length === 1 ? base.args[0] : base.args[COMPONENTS.indexOf(mask)];
        if (arg !== undefined) return { alias: arg };
      }
      if (src !== e.src) return { expr: { ...e, src, mask } };
      return undefined;
    }
    case "cast":
      return c.get(e.src).ty === e.ty ? { alias: e.src } : undefined;
    case "intrinsic": {
      const a0 = e.args[0] === undefined ? undefined : c.get(e.args[0]);
      if (IDEMPOTENT.has(e.fn) && a0?.op === "intrinsic" && a0.fn === e.fn) return { alias: e.args[0]! };
      if ((e.fn === "min" || e.fn === "max") && e.args[0] === e.args[1] && same(e.args[0]!))
        return { alias: e.args[0]! };
      if (e.fn === "pow") {
        const k = c.get(e.args[1]!);
        if (allEq(k, 1) && same(e.args[0]!)) return { alias: e.args[0]! };
      }
      if (e.fn === "mix") {
        const t = c.get(e.args[2]!);
        if (allEq(t, 0) && same(e.args[0]!)) return { alias: e.args[0]! };
        if (allEq(t, 1) && same(e.args[1]!)) return { alias: e.args[1]! };
      }
      return undefined;
    }
    default:
      return undefined;
  }
}
