import type { IRModule } from "../../ir/types";
import type { UniformBinding } from "../../compile/backend";

/**
 * GLSL ES 3.00 has combined samplers, so a Sampler State node cannot be written into the shader. The backend instead reports, per texture
 * uniform, the sampler state that every sample of it uses (the first one wins when a texture is sampled with several), and the Kekenik Shader
 * preview applies it to the bound texture object. Exported GLSL is unchanged (it keeps the existing warning).
 */
export function samplerStatesOf(module: IRModule): Map<string, NonNullable<UniformBinding["sampler"]>> {
  const out = new Map<string, NonNullable<UniformBinding["sampler"]>>();
  const exprs = module.main.exprs;
  for (const e of exprs) {
    if (e.op !== "sample" || e.samp === undefined) continue;
    const tex = exprs[e.tex];
    const smp = exprs[e.samp];
    if (tex?.op === "uniform" && smp?.op === "samplerState" && !out.has(tex.prop))
      out.set(tex.prop, { filter: smp.filter, wrap: smp.wrap });
  }
  return out;
}
