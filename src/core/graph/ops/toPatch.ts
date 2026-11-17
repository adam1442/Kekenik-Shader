import type { Edge, Graph, Group, NodeInstance } from "../types";
import { edgeId } from "../types";
import { getBody } from "../query";
import { type CollName, type GraphOp, GraphOpError, type PatchOp, SCOPED_COLLS } from "./types";

const fail = (msg: string): never => {
  throw new GraphOpError(msg);
};

function node(graph: Graph, scope: string | undefined, id: string): NodeInstance {
  const n = getBody(graph, scope).nodes[id];
  if (!n) return fail(`Unknown node "${id}"${scope ? ` in subgraph "${scope}"` : ""}`);
  return n;
}

function withScope(scope: string | undefined, p: Omit<PatchOp, "type" | "scope">): PatchOp {
  return scope === undefined ? { type: "patch", ...p } : { type: "patch", scope, ...p };
}

type Item = { id: string };

const scoped = (coll: CollName, scope: string | undefined): string | undefined =>
  scope !== undefined && SCOPED_COLLS.includes(coll) ? scope : undefined;

function collPatch(coll: CollName, items: unknown[], scope?: string): PatchOp {
  const sc = scoped(coll, scope);
  return sc === undefined
    ? { type: "patch", coll: { [coll]: items } as PatchOp["coll"] }
    : { type: "patch", scope: sc, coll: { [coll]: items } as PatchOp["coll"] };
}

/** Current items of a collection (scoped groups / comments come from the subgraph definition). */
function collItems(graph: Graph, coll: CollName, scope?: string): Item[] {
  const sc = scoped(coll, scope);
  if (sc === undefined) return graph[coll] as Item[];
  return ((getBody(graph, sc) as { groups?: Item[]; comments?: Item[] })[coll as "groups" | "comments"] ??
    []) as Item[];
}

/** Compile any non-transaction operation to a PatchOp against the current graph. Throws GraphOpError when invalid. */
export function toPatch(graph: Graph, op: Exclude<GraphOp, { type: "transaction" } | PatchOp>): PatchOp {
  switch (op.type) {
    case "addNode": {
      const body = getBody(graph, op.scope);
      if (body.nodes[op.node.id]) fail(`Node "${op.node.id}" already exists`);
      return withScope(op.scope, { nodes: { [op.node.id]: op.node } });
    }
    case "removeNode": {
      const body = getBody(graph, op.scope);
      node(graph, op.scope, op.id);
      const edges: Record<string, null> = {};
      for (const e of Object.values(body.edges)) if (e.from.node === op.id || e.to.node === op.id) edges[e.id] = null;
      const p = withScope(op.scope, { nodes: { [op.id]: null }, edges });
      const groups = collItems(graph, "groups", op.scope) as Group[];
      if (groups.some((g) => g.nodeIds.includes(op.id))) {
        p.coll = {
          groups: groups.map((g) =>
            g.nodeIds.includes(op.id) ? { ...g, nodeIds: g.nodeIds.filter((n) => n !== op.id) } : g,
          ),
        };
      }
      return p;
    }
    case "moveNodes": {
      const nodes: Record<string, NodeInstance> = {};
      for (const m of op.moves) nodes[m.id] = { ...node(graph, op.scope, m.id), position: m.position };
      return withScope(op.scope, { nodes });
    }
    case "connect": {
      const body = getBody(graph, op.scope);
      node(graph, op.scope, op.from.node);
      node(graph, op.scope, op.to.node);
      if (op.from.node === op.to.node) fail("A node cannot be connected to itself");
      const id = edgeId(op.from, op.to);
      if (body.edges[id]) return withScope(op.scope, {});
      const edges: Record<string, Edge | null> = {};
      for (const e of Object.values(body.edges))
        if (e.to.node === op.to.node && e.to.port === op.to.port) edges[e.id] = null;
      edges[id] = { id, from: op.from, to: op.to };
      return withScope(op.scope, { edges });
    }
    case "disconnect": {
      if (!getBody(graph, op.scope).edges[op.edgeId]) fail(`Unknown edge "${op.edgeId}"`);
      return withScope(op.scope, { edges: { [op.edgeId]: null } });
    }
    case "setParam": {
      const n = node(graph, op.scope, op.node);
      return withScope(op.scope, { nodes: { [n.id]: { ...n, params: { ...n.params, [op.param]: op.value } } } });
    }
    case "setPortValue": {
      const n = node(graph, op.scope, op.node);
      const values = { ...n.values };
      if (op.value === null) delete values[op.port];
      else values[op.port] = op.value;
      return withScope(op.scope, { nodes: { [n.id]: { ...n, values } } });
    }
    case "setNodeMeta": {
      const n = { ...node(graph, op.scope, op.node) };
      const { label, color, previewEnabled } = op.patch;
      if (label === null) delete n.label;
      else if (label !== undefined) n.label = label;
      if (color === null) delete n.color;
      else if (color !== undefined) n.color = color;
      if (previewEnabled !== undefined) n.previewEnabled = previewEnabled;
      if (op.patch.collapsed === false) delete n.collapsed;
      else if (op.patch.collapsed === true) n.collapsed = true;
      return withScope(op.scope, { nodes: { [n.id]: n } });
    }
    case "collAdd": {
      const list = [...collItems(graph, op.coll, op.scope)];
      if (list.some((i) => i.id === op.item.id)) fail(`${op.coll} already has "${op.item.id}"`);
      const at = op.index === undefined ? list.length : Math.max(0, Math.min(list.length, op.index));
      list.splice(at, 0, op.item);
      return collPatch(op.coll, list, op.scope);
    }
    case "collUpdate": {
      const list = collItems(graph, op.coll, op.scope);
      if (!list.some((i) => i.id === op.id)) fail(`${op.coll} has no "${op.id}"`);
      return collPatch(
        op.coll,
        list.map((i) => (i.id === op.id ? { ...i, ...op.patch, id: op.id } : i)),
        op.scope,
      );
    }
    case "collRemove": {
      const list = collItems(graph, op.coll, op.scope);
      if (!list.some((i) => i.id === op.id)) fail(`${op.coll} has no "${op.id}"`);
      return collPatch(
        op.coll,
        list.filter((i) => i.id !== op.id),
        op.scope,
      );
    }
    case "collMove": {
      const list = [...collItems(graph, op.coll, op.scope)];
      const from = list.findIndex((i) => i.id === op.id);
      if (from < 0) fail(`${op.coll} has no "${op.id}"`);
      const [item] = list.splice(from, 1);
      list.splice(Math.max(0, Math.min(list.length, op.toIndex)), 0, item!);
      return collPatch(op.coll, list, op.scope);
    }
    case "addSubgraphDef": {
      if (graph.subgraphDefs[op.def.id]) fail(`Subgraph "${op.def.id}" already exists`);
      return { type: "patch", subgraphDefs: { [op.def.id]: op.def } };
    }
    case "updateSubgraphDef": {
      const def = graph.subgraphDefs[op.id];
      if (!def) return fail(`Unknown subgraph "${op.id}"`);
      return { type: "patch", subgraphDefs: { [op.id]: { ...def, ...op.patch, id: def.id } } };
    }
    case "removeSubgraphDef": {
      if (!graph.subgraphDefs[op.id]) fail(`Unknown subgraph "${op.id}"`);
      return { type: "patch", subgraphDefs: { [op.id]: null } };
    }
    case "setSettings": {
      const settings = { ...graph.settings };
      for (const [k, v] of Object.entries(op.patch)) {
        if (v === null) delete settings[k];
        else settings[k] = v;
      }
      return { type: "patch", settings };
    }
    case "setProfile":
      return { type: "patch", profileId: op.profileId };
    case "setGraphName":
      return { type: "patch", name: op.name };
  }
}
