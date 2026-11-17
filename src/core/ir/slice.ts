import type { IRModule } from "./types";
import { reachableMask } from "./walk";

/**
 * Output slice of a module (dead-code elimination for multi-pass targets): keeps only the master outputs whose slot is listed.
 * Backends plan their stages from `module.outputs`, so everything not needed for the kept outputs disappears from the generated code.
 * Used by Unity: DepthOnly / ShadowCaster evaluate only `alpha` + `alphaClipThreshold`, DepthNormals adds `normalTS`.
 */
export function sliceModule(module: IRModule, keepSlots: Iterable<string>): IRModule {
  const keep = new Set(keepSlots);
  return { ...module, outputs: module.outputs.filter((o) => keep.has(o.slot)) };
}

/** Number of main-body expressions needed by the module's outputs. */
export function reachableExprCount(module: IRModule): number {
  const mark = reachableMask(
    module.main,
    module.outputs.map((o) => o.value),
  );
  let n = 0;
  for (const m of mark) if (m) n++;
  return n;
}
