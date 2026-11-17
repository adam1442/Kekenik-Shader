import type { ExprId, IRExpr } from "../ir/types";
import type { Simplified, SimplifyCtx } from "./simplify";

/**
 * Texture-sample optimisations .
 *
 * LUT lookup = an implicit-LOD sample whose coordinate is `vec2(x, constant)` or `vec2(constant, x)`: a 1-D lookup into an N×1 (or 1×N)
 * ramp — gradients, curves, colour grading strips. The screen-space derivative that selects the mip level is meaningless there (such
 * textures should have no mips), so level 2 reads mip 0 explicitly: no derivative work, no mip artefacts, and the sample becomes legal
 * in more places. Level 1 never does this (it is only exact for textures WITHOUT mips).
 */
export function isLutUv(uv: ExprId, get: (id: ExprId) => IRExpr): boolean {
  const e = get(uv);
  if (e.op !== "construct" || e.ty !== "vec2" || e.args.length !== 2) return false;
  const c = e.args.map((a) => get(a).op === "const");
  return (c[0] === true) !== (c[1] === true);
}

/** `sample:lut-lod0`: implicit LUT lookup → explicit LOD 0 (level 2 only). */
export function sampleRules(e: IRExpr, c: SimplifyCtx): Simplified | undefined {
  if (c.level < 2 || e.op !== "sample" || e.mode !== "implicit" || !isLutUv(e.uv, c.get)) return undefined;
  const zero = c.put({ op: "const", ty: "float", value: [0] });
  return { expr: { ...e, mode: "lod", lod: zero }, rule: "sample:lut-lod0" };
}
