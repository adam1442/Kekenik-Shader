import { type Diagnostic, makeDiagnostic } from "../diagnostics";
import { DEF_SUBGRAPH, type Graph, type GraphBody, type SubgraphDef, type SubgraphPort } from "./types";

/** Param of a `subgraph` instance node holding the SubgraphDef id. */
export const SUBGRAPH_PARAM = "subgraph";

/** Subgraph ids instantiated directly by a body. */
export function subgraphRefs(body: GraphBody): string[] {
  const out = new Set<string>();
  for (const n of Object.values(body.nodes)) {
    if (n.defId === DEF_SUBGRAPH && typeof n.params[SUBGRAPH_PARAM] === "string")
      out.add(n.params[SUBGRAPH_PARAM] as string);
  }
  return [...out];
}

/** id → ids it instantiates directly (only ids that exist). */
function subgraphDependencies(graph: Graph): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const def of Object.values(graph.subgraphDefs))
    m.set(
      def.id,
      subgraphRefs(def).filter((id) => id in graph.subgraphDefs),
    );
  return m;
}

/** Subgraph definitions that (transitively) instantiate themselves. Recursion is forbidden. */
function findRecursiveSubgraphs(graph: Graph): string[] {
  const deps = subgraphDependencies(graph);
  const recursive: string[] = [];
  for (const start of deps.keys()) {
    const seen = new Set<string>();
    const stack = [...(deps.get(start) ?? [])];
    let hit = false;
    while (stack.length && !hit) {
      const cur = stack.pop()!;
      if (cur === start) hit = true;
      else if (!seen.has(cur)) {
        seen.add(cur);
        stack.push(...(deps.get(cur) ?? []));
      }
    }
    if (hit) recursive.push(start);
  }
  return recursive.sort();
}

export function recursionDiagnostics(graph: Graph): Diagnostic[] {
  return findRecursiveSubgraphs(graph).map((id) =>
    makeDiagnostic(
      "E_SUBGRAPH_RECURSION",
      `Subgraph "${graph.subgraphDefs[id]!.name}" instantiates itself (directly or through other subgraphs); recursion is not allowed`,
      { scope: id },
    ),
  );
}

/** Would instantiating `target` inside `host` (a subgraph id, or undefined for the main graph) create recursion? */
export function wouldRecurse(graph: Graph, host: string | undefined, target: string): boolean {
  if (host === undefined) return false;
  if (host === target) return true;
  const deps = subgraphDependencies(graph);
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === host) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(deps.get(cur) ?? []));
  }
  return false;
}

export function createSubgraphDef(
  id: string,
  name: string,
  inputs: SubgraphPort[],
  outputs: SubgraphPort[],
): SubgraphDef {
  return { id, name, inputs, outputs, nodes: {}, edges: {} };
}
