import type { Graph } from "../graph/types";
import { makeDiagnostic, type Diagnostic } from "../diagnostics";
import { CUSTOM_INTERPOLATOR_ID } from "../nodes/shading/customInterpolator";
import { readNodeOverrides } from "./nodeOverrides";
import { AFF_AFFINE, AFF_FLAT, analyzeAffine } from "../opt/hoist";
import { type IRModule, MAIN_BODY, sourceKey } from "../ir/types";

/**
 * Custom Interpolator wiring : interpolator node id → id of the node feeding its `in` port (main graph only).
 * Nodes with the per-node override "Evaluate in Vertex" (`nodeStage:<id>` = vertex) map to themselves — same semantics, same warning.
 */
function interpolatorSources(graph: Graph): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of readNodeOverrides(graph).vertex) out.set(id, id);
  const ids = Object.values(graph.nodes)
    .filter((n) => n.defId === CUSTOM_INTERPOLATOR_ID)
    .map((n) => n.id);
  for (const e of Object.values(graph.edges))
    if (ids.includes(e.to.node) && e.to.port === "in") out.set(e.to.node, e.from.node);
  return out;
}

/** Node ids whose value must be evaluated per vertex (fed into the stage-split `interpolate` hint of every backend). */
export const forcedInterpolateNodes = (graph: Graph): string[] =>
  [...new Set(interpolatorSources(graph).values())].sort();

/**
 * `W_INTERPOLATOR_NON_AFFINE` for every Custom Interpolator whose connected expression is NOT an affine function of the interpolated inputs
 * (so per-vertex evaluation changes the image). Uses the same legality analysis as automatic vertex hoisting.
 */
export function interpolatorWarnings(graph: Graph, module: IRModule): Diagnostic[] {
  const src = interpolatorSources(graph);
  if (src.size === 0) return [];
  const an = analyzeAffine(module);
  const diags: Diagnostic[] = [];
  for (const [interp, from] of src) {
    let bad = 0;
    module.main.exprs.forEach((_, i) => {
      if (!an.mask[i] || module.sourceMap[sourceKey(MAIN_BODY, i)]?.nodeId !== from) return;
      if (an.cls[i] !== AFF_AFFINE && an.cls[i] !== AFF_FLAT) bad++;
    });
    if (bad > 0)
      diags.push(
        makeDiagnostic(
          "W_INTERPOLATOR_NON_AFFINE",
          "The connected expression is not affine in the interpolated inputs (normalize / sin / pow / varying × varying …): the per-vertex result differs from per-pixel evaluation.",
          { nodeId: interp },
        ),
      );
  }
  return diags;
}
