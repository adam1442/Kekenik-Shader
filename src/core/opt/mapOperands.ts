import type { ExprId, IRExpr } from "../ir/types";

/** Copy of `e` with every operand id replaced by `f(id)`. Exhaustive over the IR; leaves are returned as-is. */
export function mapOperands(e: IRExpr, f: (id: ExprId) => ExprId): IRExpr {
  switch (e.op) {
    case "const":
    case "param":
    case "samplerState":
    case "input":
    case "uniform":
      return e;
    case "unary":
      return { ...e, a: f(e.a) };
    case "cast":
    case "swizzle":
    case "deriv":
      return { ...e, src: f(e.src) };
    case "textureSize":
      return { ...e, tex: f(e.tex) };
    case "binary":
    case "matmul":
      return { ...e, a: f(e.a), b: f(e.b) };
    case "select":
      return { ...e, cond: f(e.cond), a: f(e.a), b: f(e.b) };
    case "intrinsic":
    case "construct":
    case "call":
    case "custom":
    case "engine":
      return { ...e, args: e.args.map(f) };
    case "sample": {
      const out: IRExpr = { ...e, tex: f(e.tex), uv: f(e.uv) };
      if (e.samp !== undefined) out.samp = f(e.samp);
      if (e.lod !== undefined) out.lod = f(e.lod);
      if (e.ddx !== undefined) out.ddx = f(e.ddx);
      if (e.ddy !== undefined) out.ddy = f(e.ddy);
      return out;
    }
  }
}
