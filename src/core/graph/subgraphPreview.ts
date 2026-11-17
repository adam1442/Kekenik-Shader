import { analyzeGraph } from "../compile/pipeline";
import { createNode } from "./create";
import { applyOperation } from "./ops/apply";
import { ops } from "./ops/make";
import type { GraphOp } from "./ops/types";
import {
  DEF_MASTER,
  DEF_SUBGRAPH_INPUTS,
  DEF_SUBGRAPH_OUTPUTS,
  type Edge,
  type Graph,
  type NodeInstance,
  edgeId,
} from "./types";
import { zeroValue } from "./zero";

/**
 * The main body used to PREVIEW the inside of a subgraph: the subgraph's nodes (same ids, so node thumbnails keep working),
 * every subgraph input replaced by a constant holding its default (or the type's zero), and a Master Output whose Color shows
 * the chosen output (default: the first). The real graph is untouched.
 */
export function buildSubgraphPreviewGraph(graph: Graph, defId: string, outputId?: string): Graph | null {
  const def = graph.subgraphDefs[defId];
  if (!def) return null;
  // U13: `outputId` picks which output is shown (unknown / absent = the first one)
  const shownOutput = def.outputs.find((o) => o.id === outputId) ?? def.outputs[0];
  const nodes: Record<string, NodeInstance> = {};
  for (const n of Object.values(def.nodes))
    if (n.defId !== DEF_SUBGRAPH_INPUTS && n.defId !== DEF_SUBGRAPH_OUTPUTS) nodes[n.id] = n;
  const inNode = Object.values(def.nodes).find((n) => n.defId === DEF_SUBGRAPH_INPUTS);
  const outNode = Object.values(def.nodes).find((n) => n.defId === DEF_SUBGRAPH_OUTPUTS);
  const edges: Record<string, Edge> = {};
  const add = (from: Edge["from"], to: Edge["to"]) => (edges[edgeId(from, to)] = { id: edgeId(from, to), from, to });
  const feed = new Map<string, string>();
  def.inputs.forEach((p, i) => {
    const v = p.default ?? zeroValue(p.type);
    if (v === undefined) return;
    const id = `__in_${p.id}`;
    const a = Array.isArray(v) ? v : [Number(v)];
    const pos = { x: -200, y: i * 70 };
    const c =
      p.type === "vec2"
        ? createNode(id, "vector2", { position: pos, values: { x: a[0] ?? 0, y: a[1] ?? 0 } })
        : p.type === "vec3" || p.type === "color"
          ? createNode(id, "vector3", { position: pos, values: { x: a[0] ?? 0, y: a[1] ?? 0, z: a[2] ?? 0 } })
          : p.type === "vec4"
            ? createNode(id, "vector4", {
                position: pos,
                values: { x: a[0] ?? 0, y: a[1] ?? 0, z: a[2] ?? 0, w: a[3] ?? 0 },
              })
            : p.type === "color4"
              ? createNode(id, "color", {
                  position: pos,
                  params: { value: [a[0] ?? 0, a[1] ?? 0, a[2] ?? 0, a[3] ?? 1] },
                })
              : createNode(id, "float", { position: pos, values: { x: Number(a[0]) } });
    nodes[id] = c;
    feed.set(p.id, id);
  });
  for (const e of Object.values(def.edges)) {
    if (inNode && e.from.node === inNode.id) {
      const c = feed.get(e.from.port);
      if (c && nodes[e.to.node]) add({ node: c, port: "out" }, e.to);
    } else if (nodes[e.from.node] && nodes[e.to.node]) add(e.from, e.to);
  }
  const master = createNode("__master", DEF_MASTER, { position: { x: 600, y: 0 } });
  nodes[master.id] = master;
  let g: Graph = { ...graph, nodes, edges, groups: def.groups ?? [], comments: def.comments ?? [] };
  // Color ← first output (widened to vec4)
  const first =
    outNode && shownOutput
      ? Object.values(def.edges).find((e) => e.to.node === outNode.id && e.to.port === shownOutput.id)?.from
      : undefined;
  const src =
    first && inNode && first.node === inNode.id
      ? feed.get(first.port)
        ? { node: feed.get(first.port)!, port: "out" }
        : undefined
      : first;
  if (src && nodes[src.node]) {
    const type = analyzeGraph(g).main.info.get(src.node)?.outputs[src.port];
    const scalar = !type || type === "float" || type === "int" || type === "bool";
    const sw = createNode("__swizzle", "swizzle", {
      position: { x: 400, y: 0 },
      params: { mask: scalar ? "xxxx" : "xyzw" },
    });
    const steps: GraphOp[] = [
      ops.addNode(sw),
      ops.connect(src, { node: sw.id, port: "in" }),
      ops.connect({ node: sw.id, port: "out" }, { node: master.id, port: "Color" }),
    ];
    try {
      for (const s of steps) g = applyOperation(g, s).graph;
    } catch {
      /* keep the unconnected master: the Preview then shows the compile diagnostics */
    }
  }
  return g;
}
