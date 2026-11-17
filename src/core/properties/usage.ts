import type { Graph, GraphBody } from "../graph/types";
import { PROPERTY_PARAM } from "../nodes/propertyTexture";
import { KEYWORD_PARAM } from "../nodes/keyword";

/** One place a property / keyword is read. */
export interface UsageSite {
  nodeId: string;
  /** Subgraph id when the node lives in a subgraph body. */
  scope?: string;
}

function scan(
  body: GraphBody,
  defIds: readonly string[],
  param: string,
  id: string,
  scope: string | undefined,
  out: UsageSite[],
): void {
  for (const n of Object.values(body.nodes)) {
    if (defIds.includes(n.defId) && n.params[param] === id)
      out.push({ nodeId: n.id, ...(scope === undefined ? {} : { scope }) });
  }
}

/** All Property nodes (main graph + subgraph bodies) that read property `id`. */
export function propertyUsage(graph: Graph, id: string): UsageSite[] {
  const out: UsageSite[] = [];
  scan(graph, ["property"], PROPERTY_PARAM, id, undefined, out);
  for (const sg of Object.values(graph.subgraphDefs)) scan(sg, ["property"], PROPERTY_PARAM, id, sg.id, out);
  return out;
}

/** All keyword switch nodes that read keyword `id`. */
export function keywordUsage(graph: Graph, id: string): UsageSite[] {
  const out: UsageSite[] = [];
  scan(graph, ["keywordBool", "keywordEnum"], KEYWORD_PARAM, id, undefined, out);
  for (const sg of Object.values(graph.subgraphDefs))
    scan(sg, ["keywordBool", "keywordEnum"], KEYWORD_PARAM, id, sg.id, out);
  return out;
}
