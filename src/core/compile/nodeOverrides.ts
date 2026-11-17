import type { Graph } from "../graph/types";

/**
 * Per-node optimisation overrides , stored in `graph.settings` so they persist in `.kshader`, are copied by
 * snapshots and are ignored by every backend:
 *   `nodePrec:<nodeId>`  = "half" | "float"        (absent = Inherit the graph precision)
 *   `nodeStage:<nodeId>` = "vertex" | "fragment"   (absent = Auto: the hoist pass decides)
 * "vertex" behaves like a Custom Interpolator on the node (forced per-vertex evaluation, warns when non-affine);
 * "fragment" keeps the node's expressions per pixel even when hoisting is on.
 */
export type NodePrecisionOverride = "inherit" | "half" | "float";
export type NodeStageOverride = "auto" | "vertex" | "fragment";
const PREC_PREFIX = "nodePrec:";
const STAGE_PREFIX = "nodeStage:";
export const nodePrecKey = (id: string): string => `${PREC_PREFIX}${id}`;
export const nodeStageKey = (id: string): string => `${STAGE_PREFIX}${id}`;

export interface NodeOverrides {
  half: Set<string>;
  float: Set<string>;
  vertex: Set<string>;
  fragment: Set<string>;
}

/** All overrides of live nodes (entries of deleted nodes and unknown values are ignored). Pure. */
export function readNodeOverrides(graph: Pick<Graph, "settings" | "nodes">): NodeOverrides {
  const out: NodeOverrides = { half: new Set(), float: new Set(), vertex: new Set(), fragment: new Set() };
  for (const [k, v] of Object.entries(graph.settings)) {
    if (k.startsWith(PREC_PREFIX)) {
      const id = k.slice(PREC_PREFIX.length);
      if (graph.nodes[id]) {
        if (v === "half") out.half.add(id);
        else if (v === "float") out.float.add(id);
      }
    } else if (k.startsWith(STAGE_PREFIX)) {
      const id = k.slice(STAGE_PREFIX.length);
      if (graph.nodes[id]) {
        if (v === "vertex") out.vertex.add(id);
        else if (v === "fragment") out.fragment.add(id);
      }
    }
  }
  return out;
}

export const nodePrecisionOf = (graph: Pick<Graph, "settings">, id: string): NodePrecisionOverride => {
  const v = graph.settings[nodePrecKey(id)];
  return v === "half" || v === "float" ? v : "inherit";
};
export const nodeStageOf = (graph: Pick<Graph, "settings">, id: string): NodeStageOverride => {
  const v = graph.settings[nodeStageKey(id)];
  return v === "vertex" || v === "fragment" ? v : "auto";
};
