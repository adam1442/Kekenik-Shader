import type { Edge, Graph, GraphBody } from "./types";

/** Key of a port in lookup maps. */
export const portKey = (node: string, port: string): string => `${node}:${port}`;

/** Resolve the body addressed by `scope` (undefined = main graph). Throws if the subgraph is missing. */
export function getBody(graph: Graph, scope?: string): GraphBody {
  if (scope === undefined) return graph;
  const def = graph.subgraphDefs[scope];
  if (!def) throw new Error(`Unknown subgraph "${scope}"`);
  return def;
}

export interface EdgeIndex {
  /** `node:port` of an INPUT → the single edge feeding it. */
  byTarget: Map<string, Edge>;
  /** Node id → edges leaving it. */
  bySourceNode: Map<string, Edge[]>;
}

export function indexEdges(body: GraphBody): EdgeIndex {
  const byTarget = new Map<string, Edge>();
  const bySourceNode = new Map<string, Edge[]>();
  for (const e of Object.values(body.edges)) {
    byTarget.set(portKey(e.to.node, e.to.port), e);
    const list = bySourceNode.get(e.from.node);
    if (list) list.push(e);
    else bySourceNode.set(e.from.node, [e]);
  }
  return { byTarget, bySourceNode };
}

/** Would adding `from → to` close a cycle in the (unflattened) body? */
export function wouldCreateCycle(body: GraphBody, from: string, to: string): boolean {
  if (from === to) return true;
  const idx = indexEdges(body);
  const seen = new Set<string>([to]);
  const stack = [to];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of idx.bySourceNode.get(cur) ?? []) {
      if (e.to.node === from) return true;
      if (!seen.has(e.to.node)) {
        seen.add(e.to.node);
        stack.push(e.to.node);
      }
    }
  }
  return false;
}
