import type { ExprId, IRBody, IRExpr } from "./types";

/** Operand expression ids of an expression (in a stable order). */
export function operandsOf(e: IRExpr): ExprId[] {
  switch (e.op) {
    case "const":
    case "param":
    case "samplerState":
    case "input":
    case "uniform":
      return [];
    case "unary":
      return [e.a];
    case "cast":
    case "swizzle":
    case "deriv":
      return [e.src];
    case "textureSize":
      return [e.tex];
    case "binary":
    case "matmul":
      return [e.a, e.b];
    case "select":
      return [e.cond, e.a, e.b];
    case "intrinsic":
    case "construct":
    case "call":
    case "custom":
    case "engine":
      return e.args;
    case "sample": {
      const out = [e.tex];
      if (e.samp !== undefined) out.push(e.samp);
      out.push(e.uv);
      if (e.lod !== undefined) out.push(e.lod);
      if (e.ddx !== undefined) out.push(e.ddx);
      if (e.ddy !== undefined) out.push(e.ddy);
      return out;
    }
  }
}

/** Boolean mask of all expressions reachable from `roots` (operands only reference lower ids → one reverse sweep). */
export function reachableMask(body: IRBody, roots: readonly ExprId[]): Uint8Array {
  const mark = new Uint8Array(body.exprs.length);
  for (const r of roots) mark[r] = 1;
  for (let i = body.exprs.length - 1; i >= 0; i--) {
    if (!mark[i]) continue;
    for (const o of operandsOf(body.exprs[i]!)) mark[o] = 1;
  }
  return mark;
}
