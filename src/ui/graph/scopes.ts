import { type Graph, type GraphAnalysis, type GraphOp } from "@/core";

/**
 * Subgraph tabs are VIEWS onto the project graph. The view's `graph` is a projection: the main graph with the subgraph's body
 * (nodes, edges, groups, comments) swapped in, so the whole canvas stack keeps working on a plain `Graph`. Edits made through
 * a view are rewritten to carry `scope` (see `scopeOp`) and applied to the real graph.
 */
const projections = new WeakMap<Graph, Map<string, Graph>>();
const origins = new WeakMap<Graph, { real: Graph; scope: string }>();

/** Projection of `real` onto subgraph `scope` (memoised: identical inputs give the identical object). undefined = unknown subgraph. */
export function projectScope(real: Graph, scope: string): Graph | undefined {
  const def = real.subgraphDefs[scope];
  if (!def) return undefined;
  let per = projections.get(real);
  if (!per) projections.set(real, (per = new Map()));
  const hit = per.get(scope);
  if (
    hit &&
    hit.nodes === def.nodes &&
    hit.edges === def.edges &&
    hit.groups === (def.groups ?? hit.groups) &&
    hit.comments === (def.comments ?? hit.comments)
  )
    return hit;
  const g: Graph = {
    ...real,
    nodes: def.nodes,
    edges: def.edges,
    groups: def.groups ?? EMPTY_LIST,
    comments: def.comments ?? EMPTY_COMMENTS,
  };
  origins.set(g, { real, scope });
  per.set(scope, g);
  return g;
}
const EMPTY_LIST: Graph["groups"] = [];
const EMPTY_COMMENTS: Graph["comments"] = [];

/** If `g` is a projection: its real graph and subgraph id. */
export const originOf = (g: Graph): { real: Graph; scope: string } | undefined => origins.get(g);

const BODY_OPS = new Set([
  "addNode",
  "removeNode",
  "moveNodes",
  "connect",
  "disconnect",
  "setParam",
  "setPortValue",
  "setNodeMeta",
]);

/** Rewrite an operation built for the visible canvas so that it targets subgraph `scope` (explicit scopes are kept). */
export function scopeOp(op: GraphOp, scope: string): GraphOp {
  if (op.type === "transaction") return { ...op, ops: op.ops.map((o) => scopeOp(o, scope)) };
  if (BODY_OPS.has(op.type) && (op as { scope?: string }).scope === undefined) return { ...op, scope } as GraphOp;
  if (
    (op.type === "collAdd" || op.type === "collUpdate" || op.type === "collRemove" || op.type === "collMove") &&
    (op.coll === "groups" || op.coll === "comments") &&
    op.scope === undefined
  )
    return { ...op, scope } as GraphOp;
  if (op.type === "patch" && op.scope === undefined && (op.nodes || op.edges || op.coll)) return { ...op, scope };
  return op;
}

/** Analysis of a view: the subgraph's body analysis as `main`, with only that subgraph's diagnostics. */
export function scopedAnalysis(real: GraphAnalysis, scope: string): GraphAnalysis {
  const body = real.subgraphs[scope];
  const diagnostics = real.diagnostics
    .filter((d) => d.scope === scope)
    .map((d) => {
      const { scope: _drop, ...rest } = d;
      return rest;
    });
  return { ...real, main: body ?? real.main, diagnostics };
}
