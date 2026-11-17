import { createNode } from "./create";
import { PORTAL_CHANNEL_PARAM } from "./flatten";
import { ops } from "./ops/make";
import type { GraphOp, PatchOp } from "./ops/types";
import { indexEdges, portKey, wouldCreateCycle } from "./query";
import {
  type Edge,
  type GraphBody,
  type NodeInstance,
  type PortRef,
  type Vec2,
  edgeId,
  isStructuralDefId,
} from "./types";

/**
 * Reroute / Portal helpers (pure). Reroutes and portals are real nodes in the body; the flatten pass removes them
 * before IR. Everything here only reads a body and returns data or `GraphOp`s.
 */
export const DEF_REROUTE = "reroute";
export const DEF_PORTAL_IN = "portalIn";
export const DEF_PORTAL_OUT = "portalOut";

export const isPortalDef = (defId: string): boolean => defId === DEF_PORTAL_IN || defId === DEF_PORTAL_OUT;
export const channelOf = (n: NodeInstance): string => String(n.params[PORTAL_CHANNEL_PARAM] ?? "");

export interface ChannelInfo {
  name: string;
  /** The (first) Portal In of the channel, if any. */
  inId?: string;
  /** Extra Portal Ins with the same name (a diagnostic: E_PORTAL_DUPLICATE). */
  duplicateIns: string[];
  outIds: string[];
}

/** Every channel of a body, sorted by name. A channel with outs but no `inId` is orphaned. */
export function listChannels(body: GraphBody): ChannelInfo[] {
  const m = new Map<string, ChannelInfo>();
  const at = (name: string): ChannelInfo =>
    m.get(name) ?? (m.set(name, { name, duplicateIns: [], outIds: [] }), m.get(name)!);
  for (const n of Object.values(body.nodes)) {
    if (n.defId === DEF_PORTAL_IN) {
      const c = at(channelOf(n));
      if (c.inId === undefined) c.inId = n.id;
      else c.duplicateIns.push(n.id);
    } else if (n.defId === DEF_PORTAL_OUT) at(channelOf(n)).outIds.push(n.id);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Names of the channels that have a Portal In (what a Portal Out may pick). */
export const channelNames = (body: GraphBody): string[] =>
  listChannels(body)
    .filter((c) => c.inId !== undefined)
    .map((c) => c.name);

/** Counterparts of a portal: for an In → every Out of its channel; for an Out → the In. */
export function portalPartners(body: GraphBody, nodeId: string): string[] {
  const n = body.nodes[nodeId];
  if (!n || !isPortalDef(n.defId)) return [];
  const ch = listChannels(body).find((c) => c.name === channelOf(n));
  if (!ch) return [];
  if (n.defId === DEF_PORTAL_IN) return ch.outIds;
  return ch.inId !== undefined ? [ch.inId] : [];
}

/** Every portal (In and Outs) of the channel of `nodeId`. */
export function channelMembers(body: GraphBody, nodeId: string): string[] {
  const n = body.nodes[nodeId];
  if (!n || !isPortalDef(n.defId)) return [];
  const ch = listChannels(body).find((c) => c.name === channelOf(n));
  return ch ? [...(ch.inId !== undefined ? [ch.inId] : []), ...ch.duplicateIns, ...ch.outIds] : [];
}

/** A Portal Out whose channel has no Portal In. */
export const isOrphanOut = (body: GraphBody, nodeId: string): boolean => {
  const n = body.nodes[nodeId];
  return (
    !!n &&
    n.defId === DEF_PORTAL_OUT &&
    !listChannels(body).some((c) => c.name === channelOf(n) && c.inId !== undefined)
  );
};

/** `base`, or `base 2`, `base 3`… (separator `sep`) — a channel name no Portal In uses yet and that is not in `reserved`. */
export function uniqueChannelName(
  body: GraphBody,
  base = "Portal",
  sep = " ",
  reserved: ReadonlySet<string> = new Set(),
): string {
  const used = new Set(
    listChannels(body)
      .filter((c) => c.inId !== undefined)
      .map((c) => c.name),
  );
  const free = (n: string) => !used.has(n) && !reserved.has(n);
  if (free(base)) return base;
  for (let i = 2; ; i++) if (free(`${base}${sep}${i}`)) return `${base}${sep}${i}`;
}

/**
 * Rename a channel: the In and every Out follow in one transaction. Returns null when `to` is empty or already the
 * channel of another Portal In (two channels with one name would merge); `[]` when nothing changes.
 */
export function renameChannelOps(body: GraphBody, from: string, to: string, scope?: string): GraphOp[] | null {
  const name = to.trim();
  if (name === from) return [];
  if (!name) return null;
  if (listChannels(body).some((c) => c.name === name && c.inId !== undefined)) return null;
  return Object.values(body.nodes)
    .filter((n) => isPortalDef(n.defId) && channelOf(n) === from)
    .map((n) => ops.setParam(n.id, PORTAL_CHANNEL_PARAM, name, scope));
}

/** Source (a REAL node port) feeding `start`, walking back through reroutes and portal pairs. null = unconnected / unresolved / loop. */
export function traceSource(body: GraphBody, start: PortRef): { from: PortRef; via: string[] } | null {
  const idx = indexEdges(body);
  const chans = listChannels(body);
  let cur = start;
  const via: string[] = [];
  const seen = new Set<string>();
  for (;;) {
    const n = body.nodes[cur.node];
    if (!n) return null;
    if (!isStructuralDefId(n.defId)) return { from: cur, via };
    if (seen.has(n.id)) return null;
    seen.add(n.id);
    via.push(n.id);
    let inId = n.id;
    if (n.defId === DEF_PORTAL_OUT) {
      const inn = chans.find((c) => c.name === channelOf(n))?.inId;
      if (!inn) return null;
      inId = inn;
      via.push(inn);
    }
    const next = idx.byTarget.get(portKey(inId, "in"));
    if (!next) return null;
    cur = next.from;
  }
}

/** Same as `wouldCreateCycle` but portal channels count as wires (In → its Outs), so a loop closed through a portal is caught. */
export function wouldCreateCycleThroughPortals(body: GraphBody, from: string, to: string): boolean {
  const extra: Record<string, Edge> = {};
  for (const c of listChannels(body)) {
    if (c.inId === undefined) continue;
    for (const o of c.outIds) {
      const a = { node: c.inId, port: "~" };
      const b = { node: o, port: "~" };
      extra[edgeId(a, b)] = { id: edgeId(a, b), from: a, to: b };
    }
  }
  return wouldCreateCycle({ nodes: body.nodes, edges: { ...body.edges, ...extra } }, from, to);
}

const patch = (scope: string | undefined, p: Omit<PatchOp, "type" | "scope">): PatchOp =>
  scope === undefined ? { type: "patch", ...p } : { type: "patch", scope, ...p };

/** Insert a Reroute in the middle of a wire (the wire is split in two; nothing else changes). */
export function insertRerouteOps(
  body: GraphBody,
  wireId: string,
  rerouteId: string,
  at: Vec2,
  scope?: string,
): GraphOp[] | null {
  const e = body.edges[wireId];
  if (!e) return null;
  return [
    ops.disconnect(e.id, scope),
    ops.addNode(createNode(rerouteId, DEF_REROUTE, { position: at }), scope),
    ops.connect(e.from, { node: rerouteId, port: "in" }, scope),
    ops.connect({ node: rerouteId, port: "out" }, e.to, scope),
  ];
}

/**
 * "Convert wire to portal pair": the wire `A → B` becomes `A → [Portal In]` … `[Portal Out] → B` (same channel).
 * The flattened graph — and therefore the generated shader — is identical.
 */
export function wireToPortalPairOps(
  body: GraphBody,
  wireId: string,
  ids: { inId: string; outId: string },
  channel: string,
  at: { inPos: Vec2; outPos: Vec2 },
  scope?: string,
): GraphOp[] | null {
  const e = body.edges[wireId];
  if (!e) return null;
  return [
    ops.disconnect(e.id, scope),
    ops.addNode(
      createNode(ids.inId, DEF_PORTAL_IN, { position: at.inPos, params: { [PORTAL_CHANNEL_PARAM]: channel } }),
      scope,
    ),
    ops.addNode(
      createNode(ids.outId, DEF_PORTAL_OUT, { position: at.outPos, params: { [PORTAL_CHANNEL_PARAM]: channel } }),
      scope,
    ),
    ops.connect(e.from, { node: ids.inId, port: "in" }, scope),
    ops.connect({ node: ids.outId, port: "out" }, e.to, scope),
  ];
}

/**
 * Reroute → Portal: the reroute becomes a Portal In (keeping its input wire) and a new Portal Out takes over its
 * output wires. Semantics are unchanged.
 */
export function rerouteToPortalOps(
  body: GraphBody,
  rerouteId: string,
  outId: string,
  channel: string,
  outPos: Vec2,
  scope?: string,
): GraphOp[] | null {
  const n = body.nodes[rerouteId];
  if (!n || n.defId !== DEF_REROUTE) return null;
  const outEdges = Object.values(body.edges).filter((e) => e.from.node === rerouteId);
  const edges: Record<string, Edge | null> = {};
  for (const e of outEdges) edges[e.id] = null;
  const inNode: NodeInstance = { ...n, defId: DEF_PORTAL_IN, params: { ...n.params, [PORTAL_CHANNEL_PARAM]: channel } };
  const out = createNode(outId, DEF_PORTAL_OUT, { position: outPos, params: { [PORTAL_CHANNEL_PARAM]: channel } });
  const list: GraphOp[] = [patch(scope, { nodes: { [n.id]: inNode }, edges }), ops.addNode(out, scope)];
  for (const e of outEdges) list.push(ops.connect({ node: outId, port: "out" }, e.to, scope));
  return list;
}

/**
 * Portal → Reroute: every Portal Out of the channel becomes a Reroute wired straight from the In's source and the
 * Portal In is removed (converting half a channel would orphan the rest).
 */
export function portalChannelToReroutesOps(body: GraphBody, anyPortalId: string, scope?: string): GraphOp[] | null {
  const n = body.nodes[anyPortalId];
  if (!n || !isPortalDef(n.defId)) return null;
  const ch = listChannels(body).find((c) => c.name === channelOf(n));
  if (!ch) return null;
  const idx = indexEdges(body);
  const src = ch.inId !== undefined ? idx.byTarget.get(portKey(ch.inId, "in")) : undefined;
  const nodes: Record<string, NodeInstance | null> = {};
  for (const o of ch.outIds) {
    const on = body.nodes[o]!;
    const params = { ...on.params };
    delete params[PORTAL_CHANNEL_PARAM];
    nodes[o] = { ...on, defId: DEF_REROUTE, params };
  }
  const list: GraphOp[] = [patch(scope, { nodes })];
  if (src) for (const o of ch.outIds) list.push(ops.connect(src.from, { node: o, port: "in" }, scope));
  for (const inId of [ch.inId, ...ch.duplicateIns]) if (inId !== undefined) list.push(ops.removeNode(inId, scope));
  return list;
}
