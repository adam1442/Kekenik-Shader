import {
  type Edge,
  type Graph,
  type GraphOp,
  type NodeInstance,
  type Property,
  type Vec2,
  channelOf,
  edgeId,
  uniqueChannelName,
} from "@/core";
import { PORTAL_CHANNEL_PARAM } from "@/core/graph/flatten";
import { boundsOf } from "./viewport";

/**
 * JSON clipboard of nodes (works across tabs and projects; the text is plain JSON so it also survives the OS clipboard).
 * Internal wires are preserved; wires to nodes outside the copied set are dropped. Referenced properties travel along.
 */
const CLIP_FORMAT = "kekenik-shader/nodes";
const PROPERTY_PARAM = "property";
/** Singletons / plumbing that must never be duplicated by copy-paste. */
const NON_COPYABLE_DEFS: readonly string[] = ["masterOutput", "subgraphInputs", "subgraphOutputs"];

export interface ClipPayload {
  format: typeof CLIP_FORMAT;
  version: 1;
  nodes: NodeInstance[];
  edges: Edge[];
  properties: Property[];
}

export function copyPayload(graph: Graph, ids: Iterable<string>): ClipPayload | null {
  const set = new Set<string>();
  for (const id of ids) {
    const n = graph.nodes[id];
    if (n && !NON_COPYABLE_DEFS.includes(n.defId)) set.add(id);
  }
  if (set.size === 0) return null;
  const nodes = [...set].map((id) => graph.nodes[id]!);
  const edges = Object.values(graph.edges).filter((e) => set.has(e.from.node) && set.has(e.to.node));
  const used = new Set(nodes.map((n) => n.params[PROPERTY_PARAM]).filter((v): v is string => typeof v === "string"));
  return { format: CLIP_FORMAT, version: 1, nodes, edges, properties: graph.properties.filter((p) => used.has(p.id)) };
}

export const clipToText = (p: ClipPayload): string => JSON.stringify(p);

export function parseClip(text: string): ClipPayload | null {
  if (!text || text.length > 20_000_000 || text.charCodeAt(0) !== 123) return null;
  try {
    const p = JSON.parse(text) as Partial<ClipPayload>;
    if (p.format !== CLIP_FORMAT || !Array.isArray(p.nodes) || !Array.isArray(p.edges)) return null;
    const okNode = (n: NodeInstance) =>
      !!n &&
      typeof n.id === "string" &&
      typeof n.defId === "string" &&
      !!n.position &&
      typeof n.position.x === "number" &&
      typeof n.position.y === "number";
    if (!p.nodes.every(okNode)) return null;
    return {
      format: CLIP_FORMAT,
      version: 1,
      nodes: p.nodes,
      edges: p.edges,
      properties: Array.isArray(p.properties) ? p.properties : [],
    };
  } catch {
    return null;
  }
}

export interface PasteOptions {
  /** World point the pasted block is centred on; without it the block is shifted by `offset`. */
  anchor?: Vec2;
  offset?: Vec2;
  newId: (prefix: string) => string;
}

export interface PasteResult {
  /** One transaction (a single undo step); null when there is nothing to paste. */
  op: GraphOp | null;
  /** Ids of the new nodes (old id → new id order preserved). */
  ids: string[];
  idMap: Record<string, string>;
}

/**
 * U9: a pasted Portal In whose channel already exists gets a fresh name (`name_2`…) as part of the same transaction (no E_PORTAL_DUPLICATE);
 * pasted Portal Outs of that channel follow the rename, so a copied In + Out pair stays a working pair.
 */
function portalChannelRenames(graph: Graph, nodes: NodeInstance[]): Map<string, string> {
  const out = new Map<string, string>();
  const reserved = new Set<string>();
  for (const n of nodes) {
    if (n.defId !== "portalIn") continue;
    const name = channelOf(n);
    if (out.has(name)) continue;
    const taken = Object.values(graph.nodes).some((m) => m.defId === "portalIn" && channelOf(m) === name);
    reserved.add(name);
    if (taken) {
      const fresh = uniqueChannelName(graph, name, "_", reserved);
      reserved.add(fresh);
      out.set(name, fresh);
    }
  }
  return out;
}

export function buildPaste(graph: Graph, payload: ClipPayload, opt: PasteOptions): PasteResult {
  const nodes = payload.nodes.filter((n) => !NON_COPYABLE_DEFS.includes(n.defId));
  if (nodes.length === 0) return { op: null, ids: [], idMap: {} };
  // Centre of the pasted nodes' positions (points = zero-size rects).
  const b = boundsOf(nodes.map((n) => ({ x: n.position.x, y: n.position.y, w: 0, h: 0 })))!;
  const shift: Vec2 = opt.anchor
    ? { x: opt.anchor.x - (b.x + b.w / 2), y: opt.anchor.y - (b.y + b.h / 2) }
    : (opt.offset ?? { x: 32, y: 32 });
  const taken = new Set(Object.keys(graph.nodes));
  const idMap: Record<string, string> = {};
  for (const n of nodes) {
    let id = opt.newId("n");
    while (taken.has(id)) id = opt.newId("n");
    taken.add(id);
    idMap[n.id] = id;
  }
  const channelRename = portalChannelRenames(graph, nodes);
  const ops: GraphOp[] = [];
  for (const p of payload.properties) {
    if (!graph.properties.some((q) => q.id === p.id)) ops.push({ type: "collAdd", coll: "properties", item: p });
  }
  for (const n of nodes) {
    const renamed = (n.defId === "portalIn" || n.defId === "portalOut") && channelRename.get(channelOf(n));
    const params = renamed ? { ...n.params, [PORTAL_CHANNEL_PARAM]: renamed } : n.params;
    ops.push({
      type: "addNode",
      node: {
        ...n,
        params,
        id: idMap[n.id]!,
        position: { x: Math.round(n.position.x + shift.x), y: Math.round(n.position.y + shift.y) },
      },
    });
  }
  for (const e of payload.edges) {
    const a = idMap[e.from.node],
      b = idMap[e.to.node];
    if (!a || !b) continue;
    const from = { node: a, port: e.from.port },
      to = { node: b, port: e.to.port };
    if (ops.some((o) => o.type === "connect" && edgeId(o.from, o.to) === edgeId(from, to))) continue;
    ops.push({ type: "connect", from, to });
  }
  return { op: { type: "transaction", ops }, ids: nodes.map((n) => idMap[n.id]!), idMap };
}
