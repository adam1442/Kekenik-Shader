import { componentCount } from "../types/shaderType";
import { evalExpr } from "../ir/eval";
import type { ExprId, IRExpr, IRModule } from "../ir/types";
import { operandsOf } from "../ir/walk";
import { mapOperands } from "./mapOperands";

const FOLDABLE = new Set(["unary", "binary", "intrinsic", "construct", "swizzle", "select", "cast", "matmul"]);

/** Fold-reference semantics are the IR evaluator's (`ir/eval.ts`), so folded values equal what the unoptimised graph computes on the CPU. */
const EMPTY: Omit<IRModule, "main"> = {
  irVersion: 1,
  profileId: "",
  uniforms: [],
  customBlocks: [],
  functions: [],
  outputs: [],
  sourceMap: {},
};

/**
 * Constant-fold `e` when every operand is a `const`. Returns the folded `const` or undefined (not foldable / non-finite result).
 * `get` resolves operand ids of the body being rebuilt.
 */
export function foldExpr(e: IRExpr, get: (id: ExprId) => IRExpr): IRExpr | undefined {
  if (!FOLDABLE.has(e.op) || componentCount(e.ty) === 0) return undefined;
  const ops = operandsOf(e);
  if (ops.length === 0) return undefined;
  const local = new Map<ExprId, number>();
  const exprs: IRExpr[] = [];
  for (const o of ops) {
    const x = get(o);
    if (x.op !== "const") return undefined;
    if (!local.has(o)) {
      local.set(o, exprs.length);
      exprs.push(x);
    }
  }
  exprs.push(mapOperands(e, (id) => local.get(id)!));
  let value: number[];
  try {
    value = evalExpr({ ...EMPTY, main: { exprs } }, exprs.length - 1).slice();
  } catch {
    return undefined;
  }
  if (e.ty === "int") value = value.map(Math.trunc);
  if (value.length !== componentCount(e.ty) || value.some((v) => !Number.isFinite(v))) return undefined;
  return { op: "const", ty: e.ty, value: value.map((v) => (Object.is(v, -0) ? 0 : v)) };
}
