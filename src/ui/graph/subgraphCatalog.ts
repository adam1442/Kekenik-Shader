import { useMemo } from "react";
import { type Graph, type NodeDef, DEF_SUBGRAPH, SUBGRAPH_PARAM, defaultNodeRegistry, wouldRecurse } from "@/core";
import { portOf } from "@/core/nodes/graphNodes";
import { useGraphs } from "./graphStore";

/**
 * U8: subgraph definitions as *virtual* library entries. The Add-Node search and the Node Library list them under the category
 * "Subgraphs"; creating one places an ordinary `subgraph` instance (`addNodeAt` resolves the virtual id via `resolveCatalogDef`).
 * Virtual defs are never registered in the node registry (they depend on the open document), so the registry and serialization are untouched.
 */
const SUBGRAPH_CATALOG_CATEGORY = "Subgraphs";
const PREFIX = "subgraph:";

const catalogIdOf = (defId: string): string => PREFIX + defId;
const isCatalogId = (id: string): boolean => id.startsWith(PREFIX);
const subgraphIdOfCatalog = (id: string): string => id.slice(PREFIX.length);

/** Virtual NodeDefs of every subgraph of `graph` that may be instantiated in `scope` (recursion is excluded). Sorted by name. */
function subgraphCatalogDefs(graph: Graph, scope?: string): NodeDef[] {
  return Object.values(graph.subgraphDefs)
    .filter((d) => !wouldRecurse(graph, scope, d.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d): NodeDef => ({
      id: catalogIdOf(d.id),
      category: SUBGRAPH_CATALOG_CATEGORY,
      name: d.name,
      synonyms: ["subgraph", "sub graph", "function"],
      description: `Subgraph — ${d.inputs.length} input${d.inputs.length === 1 ? "" : "s"}, ${d.outputs.length} output${d.outputs.length === 1 ? "" : "s"}.`,
      inputs: d.inputs.map((p) => portOf(p, true)),
      outputs: d.outputs.map((p) => portOf(p, false)),
      params: [],
    }));
}

/** The def for a registry id OR a virtual subgraph id; for virtual ids also the instance params to create the node with. */
export function resolveCatalogDef(
  id: string,
  graph: Graph,
): { def: NodeDef; nodeDefId: string; params?: Record<string, string> } | null {
  if (!isCatalogId(id)) {
    const def = defaultNodeRegistry.get(id);
    return def ? { def, nodeDefId: def.id } : null;
  }
  const sg = graph.subgraphDefs[subgraphIdOfCatalog(id)];
  const def = sg
    ? (subgraphCatalogDefs({ ...graph, subgraphDefs: { [sg.id]: sg } }).find((d) => d.id === id) ?? null)
    : null;
  return def ? { def, nodeDefId: DEF_SUBGRAPH, params: { [SUBGRAPH_PARAM]: sg!.id } } : null;
}

/** Registry nodes + subgraph entries of the active document's project (re-computed when the definitions or the open scope change). */
export function useCatalogDefs(): NodeDef[] {
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  const scope = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.scope);
  const defs = graph?.subgraphDefs;
  return useMemo(
    () => [...defaultNodeRegistry.list(), ...(graph ? subgraphCatalogDefs(graph, scope) : [])],
    [defs, scope],
  ); // eslint-disable-line react-hooks/exhaustive-deps
}
