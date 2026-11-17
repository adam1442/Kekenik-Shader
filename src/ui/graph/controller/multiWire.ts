import { ops } from "@/core";
import { setStatus } from "@/app/state";
import { type EndPoint, checkConnection, outputType } from "../connect";
import { commit, getAnalysis, getGraph, getScene } from "../graphStore";
import { portStyle } from "../portStyles";
import type { CanvasController } from "./CanvasController";

/**
 * Multi-wire drag (Shift + drag from a CONNECTED output port): picks up every wire of the port at once.
 * Dropping on another output port re-routes all the wires that port can legally feed (one undo step); anything else cancels.
 * Returns false when the port has no wires (the caller then starts the normal single-wire drag).
 */
export function startMultiWireDrag(c: CanvasController, e: PointerEvent, port: EndPoint): boolean {
  if (port.dir !== "out") return false;
  const graph = getGraph();
  const scene = getScene();
  const ctx = { graph, scene, analysis: getAnalysis() };
  const edges = Object.values(graph.edges).filter((ed) => ed.from.node === port.node && ed.from.port === port.port);
  if (edges.length === 0) return false;
  const color = portStyle(outputType(ctx, port)).color;
  const first = scene.portPos(edges[0]!.to.node, "in", edges[0]!.to.port);
  let candidate: (EndPoint & { ok: number }) | null = null;

  const legal = (to: EndPoint) =>
    edges.filter((ed) => checkConnection(ctx, to, { node: ed.to.node, port: ed.to.port, dir: "in" }).ok);
  const update = (clientX: number, clientY: number): void => {
    const world = c.toWorld(clientX, clientY);
    const hit = scene.portAt(world, 18 / c.view.zoom, undefined, "out");
    candidate =
      hit && !(hit.node === port.node && hit.port === port.port) ? { ...hit, ok: legal({ ...hit }).length } : null;
    const end = (candidate && candidate.ok > 0 ? scene.portPos(candidate.node, "out", candidate.port) : null) ?? world;
    if (first)
      c.temp = {
        a: end,
        b: first,
        from: color,
        to: color,
        gradient: false,
        valid: candidate ? candidate.ok > 0 : null,
      };
    c.showTip(
      candidate && candidate.ok === 0
        ? "None of the wires can connect to this port"
        : `Moving ${edges.length} wire${edges.length === 1 ? "" : "s"}`,
      c.toLocal(clientX, clientY),
    );
    c.invalidate(true);
  };
  const cleanup = (): void => {
    c.temp = null;
    c.showTip(null);
    c.invalidate(true);
  };
  update(e.clientX, e.clientY);
  c.begin({
    move: (m) => update(m.clientX, m.clientY),
    up: (m) => {
      update(m.clientX, m.clientY);
      const cand = candidate;
      cleanup();
      if (!cand) return;
      const moving = legal({ node: cand.node, port: cand.port, dir: "out" });
      if (moving.length === 0) return void setStatus("None of the wires can connect to that port", 3500);
      commit(`Move ${moving.length} wire${moving.length === 1 ? "" : "s"}`, [
        ...moving.map((ed) => ops.disconnect(ed.id)),
        ...moving.map((ed) => ops.connect({ node: cand.node, port: cand.port }, ed.to)),
      ]);
    },
    cancel: cleanup,
  });
  return true;
}
