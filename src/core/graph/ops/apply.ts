import type { Graph } from "../types";
import { getBody } from "../query";
import { type GraphOp, type PatchOp } from "./types";
import { toPatch } from "./toPatch";

export interface ApplyResult {
  graph: Graph;
  /** Applying this to `graph` yields the input graph again. */
  inverse: GraphOp;
}

/** Apply `changes` (null = delete) to a record; fills `inv` with the previous values. */
function applyRecord<T>(
  cur: Record<string, T>,
  changes: Record<string, T | null>,
  inv: Record<string, T | null>,
): Record<string, T> {
  const out = { ...cur };
  for (const key of Object.keys(changes)) {
    inv[key] = cur[key] ?? null;
    const next = changes[key];
    if (next === null || next === undefined) delete out[key];
    else out[key] = next;
  }
  return out;
}

/** Apply a PatchOp. The returned inverse is itself a PatchOp holding exactly the previous values of the touched keys. */
function applyPatch(graph: Graph, patch: PatchOp): { graph: Graph; inverse: PatchOp } {
  const inverse: PatchOp = { type: "patch" };
  if (patch.scope !== undefined) inverse.scope = patch.scope;
  let g = graph;

  if (patch.nodes || patch.edges) {
    const body = getBody(g, patch.scope);
    let nodes = body.nodes;
    let edges = body.edges;
    if (patch.nodes) {
      inverse.nodes = {};
      nodes = applyRecord(nodes, patch.nodes, inverse.nodes);
    }
    if (patch.edges) {
      inverse.edges = {};
      edges = applyRecord(edges, patch.edges, inverse.edges);
    }
    g =
      patch.scope === undefined
        ? { ...g, nodes, edges }
        : {
            ...g,
            subgraphDefs: { ...g.subgraphDefs, [patch.scope]: { ...g.subgraphDefs[patch.scope]!, nodes, edges } },
          };
  }
  if (patch.coll) {
    inverse.coll = {};
    if (patch.scope === undefined) {
      const next = { ...g };
      for (const key of Object.keys(patch.coll) as Array<keyof NonNullable<PatchOp["coll"]>>) {
        (inverse.coll as Record<string, unknown>)[key] = g[key];
        (next as Record<string, unknown>)[key] = patch.coll[key];
      }
      g = next;
    } else {
      // scoped groups / comments live inside the subgraph definition
      const def = { ...getBody(g, patch.scope) } as Record<string, unknown>;
      for (const key of Object.keys(patch.coll) as Array<"groups" | "comments">) {
        (inverse.coll as Record<string, unknown>)[key] = (def[key] as unknown[] | undefined) ?? [];
        def[key] = patch.coll[key];
      }
      g = { ...g, subgraphDefs: { ...g.subgraphDefs, [patch.scope]: def as unknown as Graph["subgraphDefs"][string] } };
    }
  }
  if (patch.subgraphDefs) {
    inverse.subgraphDefs = {};
    g = { ...g, subgraphDefs: applyRecord(g.subgraphDefs, patch.subgraphDefs, inverse.subgraphDefs) };
  }
  if (patch.settings) {
    inverse.settings = g.settings;
    g = { ...g, settings: patch.settings };
  }
  if (patch.profileId !== undefined) {
    inverse.profileId = g.profileId;
    g = { ...g, profileId: patch.profileId };
  }
  if (patch.name !== undefined) {
    inverse.name = g.name;
    g = { ...g, name: patch.name };
  }
  return { graph: g, inverse };
}

/**
 * Apply any operation purely. Throws GraphOpError on invalid input (the input graph is never modified, and a
 * failing transaction applies nothing because the caller keeps the old graph).
 */
export function applyOperation(graph: Graph, op: GraphOp): ApplyResult {
  if (op.type === "transaction") {
    let g = graph;
    const inverses: GraphOp[] = [];
    for (const sub of op.ops) {
      const r = applyOperation(g, sub);
      g = r.graph;
      inverses.push(r.inverse);
    }
    return { graph: g, inverse: { type: "transaction", ops: inverses.reverse() } };
  }
  if (op.type === "patch") return applyPatch(graph, op);
  return applyPatch(graph, toPatch(graph, op));
}

/** Apply a list of operations as one atomic step. */
export function applyOperations(graph: Graph, ops: GraphOp[]): ApplyResult {
  return applyOperation(graph, { type: "transaction", ops });
}
