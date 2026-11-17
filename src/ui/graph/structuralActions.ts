import {
  type Vec2,
  DEF_PORTAL_IN,
  DEF_PORTAL_OUT,
  DEF_REROUTE,
  PORTAL_CHANNEL_PARAM,
  createNode,
  insertRerouteOps,
  listChannels,
  channelMembers,
  ops,
  portalChannelToReroutesOps,
  renameChannelOps,
  rerouteToPortalOps,
  uniqueChannelName,
  wireToPortalPairOps,
} from "@/core";
import { commit, getGraph, getScene, newNodeId, setSelection } from "./graphStore";
import { structuralType } from "./connect";
import { getAnalysis } from "./graphStore";

/** User-level reroute / portal actions (the only place they live; commands, menus, gestures and tests call these). */

export function addReroute(at: Vec2): string | null {
  const id = newNodeId("r");
  return commit(
    "Add reroute",
    ops.addNode(createNode(id, DEF_REROUTE, { position: { x: Math.round(at.x), y: Math.round(at.y) } })),
    { select: [id] },
  )
    ? id
    : null;
}

/** Double-click a wire: split it with a reroute centred on `world`. */
export function insertRerouteOnWire(edgeId: string, world: Vec2): string | null {
  const id = newNodeId("r");
  const list = insertRerouteOps(getGraph(), edgeId, id, { x: Math.round(world.x - 12), y: Math.round(world.y - 12) });
  return list && commit("Insert reroute", list, { select: [id] }) ? id : null;
}

export function addPortal(kind: "in" | "out", at: Vec2, channel?: string): string | null {
  const g = getGraph();
  const id = newNodeId("p");
  const name =
    channel ?? (kind === "in" ? uniqueChannelName(g) : (listChannels(g).find((c) => c.inId)?.name ?? "Portal"));
  const def = kind === "in" ? DEF_PORTAL_IN : DEF_PORTAL_OUT;
  return commit(
    kind === "in" ? "Add portal in" : "Add portal out",
    ops.addNode(
      createNode(id, def, {
        position: { x: Math.round(at.x), y: Math.round(at.y) },
        params: { [PORTAL_CHANNEL_PARAM]: name },
      }),
    ),
    { select: [id] },
  )
    ? id
    : null;
}

/** Rename a channel everywhere (In + every Out) as one undo step. Returns false when the name is empty or taken. */
export function renameChannel(from: string, to: string): boolean {
  const list = renameChannelOps(getGraph(), from, to);
  if (!list) return false;
  return list.length === 0 || commit("Rename channel", list);
}

/** Point a Portal Out at another channel. */
export const setPortalChannel = (outId: string, channel: string): boolean =>
  commit("Set portal channel", ops.setParam(outId, PORTAL_CHANNEL_PARAM, channel));

/** "Convert wire to portal pair": the wire is replaced by a Portal In near its source and a Portal Out near its target. */
export function convertWireToPortals(edgeId: string): { inId: string; outId: string } | null {
  const g = getGraph();
  const e = g.edges[edgeId];
  if (!e) return null;
  const scene = getScene();
  const a = scene.portPos(e.from.node, "out", e.from.port),
    b = scene.portPos(e.to.node, "in", e.to.port);
  if (!a || !b) return null;
  const ids = { inId: newNodeId("p"), outId: newNodeId("p") };
  const channel = uniqueChannelName(g);
  const list = wireToPortalPairOps(g, edgeId, ids, channel, {
    inPos: { x: Math.round(a.x + 30), y: Math.round(a.y - 14) },
    outPos: { x: Math.round(b.x - 150), y: Math.round(b.y - 14) },
  });
  return list && commit("Convert wire to portal pair", list, { select: [ids.inId, ids.outId] }) ? ids : null;
}

/** Reroute → Portal (a reroute becomes the In and a new Out takes over its wires). */
export function convertRerouteToPortal(id: string): string | null {
  const g = getGraph();
  const n = g.nodes[id];
  if (!n) return null;
  const outId = newNodeId("p");
  const list = rerouteToPortalOps(g, id, outId, uniqueChannelName(g), { x: n.position.x + 160, y: n.position.y - 2 });
  return list && commit("Convert reroute to portal", list, { select: [id, outId] }) ? outId : null;
}

/** Portal → Reroute for the whole channel of `id`. */
export function convertPortalToReroute(id: string): boolean {
  const list = portalChannelToReroutesOps(getGraph(), id);
  return !!list && commit("Convert portal to reroute", list);
}

/** Select every portal of the channel of `id`. */
export function selectChannel(id: string): string[] {
  const members = channelMembers(getGraph(), id);
  if (members.length) setSelection(members);
  return members;
}

/** Type a structural node currently carries (for labels / colours), from the live analysis. */
export function structuralTypeOf(nodeId: string) {
  return structuralType({ graph: getGraph(), scene: getScene(), analysis: getAnalysis() }, nodeId);
}
