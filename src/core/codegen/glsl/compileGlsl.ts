import { type CompileOptions, type CompileResult, compileGraph } from "../../compile/pipeline";
import type { Graph } from "../../graph/types";
import { defaultNodeRegistry } from "../../nodes";
import type { NodeRegistry } from "../../registry/registry";
import { glslBackend, type GlslEmitOptions } from "./backend";

/** graph node id → display label (user label, else the node definition's name). Used to name temporaries. */
export function nodeLabels(graph: Graph, registry: NodeRegistry = defaultNodeRegistry): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of Object.values(graph.nodes)) out[n.id] = n.label ?? registry.get(n.defId)?.name ?? n.defId;
  for (const sg of Object.values(graph.subgraphDefs))
    for (const n of Object.values(sg.nodes)) out[n.id] = n.label ?? registry.get(n.defId)?.name ?? n.defId;
  return out;
}

/** Convenience: compile a graph with the GLSL backend, naming temporaries after the graph nodes. */
export function compileToGlsl(graph: Graph, options: CompileOptions & { glsl?: GlslEmitOptions } = {}): CompileResult {
  const { glsl, ...rest } = options;
  return compileGraph(graph, {
    ...rest,
    backend: glslBackend,
    emitOptions: { labels: nodeLabels(graph, rest.registry), ...glsl, ...(rest.emitOptions ?? {}) },
  });
}
