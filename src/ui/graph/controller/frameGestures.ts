import { applyOperation, ops, type GraphOp } from "@/core";
import { type FrameRef, nodeRectOf, resizeMin, useFrameSel } from "../frameActions";
import { adoptionOps, groupContents, groupRect, moveGroupOps } from "../frames";
import { commit, getGraph, getScene, setSelection } from "../graphStore";
import { useCanvasPrefs } from "../prefs";
import { snapPoint } from "../viewport";
import type { CanvasController } from "./CanvasController";

const THRESHOLD = 3;

/** Move or resize a group / comment. Nodes that travel with a group are displaced imperatively (same path as node drags); ONE transaction on release. */
export function startFrameGesture(c: CanvasController, e: PointerEvent, ref: FrameRef, mode: "move" | "resize"): void {
  const graph = getGraph();
  const scene = getScene();
  const rectOf = nodeRectOf();
  useFrameSel.getState().set(ref);
  setSelection([]);
  const frameEl = (id: string) => c.root.querySelector<HTMLElement>(`[data-frame-id="${id}"]`);
  const grp = ref.kind === "group" ? graph.groups.find((g) => g.id === ref.id) : undefined;
  const cmt = ref.kind === "comment" ? graph.comments.find((x) => x.id === ref.id) : undefined;
  if (!grp && !cmt) return;
  const contents =
    grp && mode === "move" ? groupContents(graph, grp.id, rectOf) : { nodeIds: [], groupIds: [], commentIds: [] };
  const start = grp
    ? groupRect(grp, rectOf)
    : { x: cmt!.position.x, y: cmt!.position.y, w: cmt!.size.w, h: cmt!.size.h };
  const frames: Array<{ id: string; x: number; y: number }> = [
    { id: ref.id, x: start.x, y: start.y },
    ...contents.groupIds.map((id) => ({
      id,
      ...groupRect(
        graph.groups.find((g) => g.id === id)!,
        rectOf,
      ),
    })),
    ...contents.commentIds.map((id) => ({ id, ...graph.comments.find((x) => x.id === id)!.position })),
  ];
  const nodeStart = new Map(contents.nodeIds.map((id) => [id, { ...scene.get(id)!.node.position }]));
  let started = false;
  let d = { x: 0, y: 0 };
  let size = { w: start.w, h: start.h };
  const min = resizeMin(ref.kind);

  const restore = () => {
    for (const f of frames) {
      const el = frameEl(f.id);
      if (el) el.style.transform = `translate(${f.x}px, ${f.y}px)`;
    }
    const el = frameEl(ref.id);
    if (el) {
      el.style.width = `${start.w}px`;
      el.style.height = `${start.h}px`;
    }
    for (const [id, p] of nodeStart) {
      const n = c.nodeEls.get(id);
      if (n) n.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
    c.overrides.clear();
    c.invalidate(true, true);
  };

  c.begin({
    move: (m) => {
      if (!started && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < THRESHOLD) return;
      started = true;
      c.root.setAttribute("data-dragging", "frame");
      let dx = (m.clientX - e.clientX) / c.view.zoom,
        dy = (m.clientY - e.clientY) / c.view.zoom;
      const prefs = useCanvasPrefs.getState();
      if (mode === "move") {
        if (prefs.snap && !m.altKey) {
          const s = snapPoint({ x: start.x + dx, y: start.y + dy }, prefs.gridSize);
          dx = s.x - start.x;
          dy = s.y - start.y;
        }
        d = { x: Math.round(dx), y: Math.round(dy) };
        for (const f of frames) {
          const el = frameEl(f.id);
          if (el) el.style.transform = `translate(${f.x + d.x}px, ${f.y + d.y}px)`;
        }
        for (const [id, p] of nodeStart) {
          const pos = { x: p.x + d.x, y: p.y + d.y };
          c.overrides.set(id, pos);
          const n = c.nodeEls.get(id);
          if (n) n.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
        }
      } else {
        size = { w: Math.max(min.w, Math.round(start.w + dx)), h: Math.max(min.h, Math.round(start.h + dy)) };
        const el = frameEl(ref.id);
        if (el) {
          el.style.width = `${size.w}px`;
          el.style.height = `${size.h}px`;
        }
      }
      c.invalidate(true, false);
    },
    up: () => {
      c.root.removeAttribute("data-dragging");
      if (!started) return restore();
      let list: GraphOp[] = [];
      if (mode === "move") {
        if (d.x === 0 && d.y === 0) return restore();
        list = grp
          ? moveGroupOps(graph, grp.id, d.x, d.y, rectOf, (id) => scene.get(id)?.node.position ?? null)
          : [ops.updateComment(ref.id, { position: { x: start.x + d.x, y: start.y + d.y } })];
      } else if (grp) {
        list = [ops.updateGroup(grp.id, { rect: { x: start.x, y: start.y, w: size.w, h: size.h } })];
        // the new frame may have swallowed / released nodes
        const after = applyOperation(graph, list[0]!).graph;
        list.push(
          ...adoptionOps(
            after,
            [...scene.nodes.keys()],
            (id) => {
              const r = rectOf(id);
              return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null;
            },
            rectOf,
          ),
        );
      } else list = [ops.updateComment(ref.id, { size })];
      commit(mode === "move" ? "Move frame" : "Resize frame", list);
      restore();
    },
    cancel: () => {
      c.root.removeAttribute("data-dragging");
      restore();
    },
  });
}
