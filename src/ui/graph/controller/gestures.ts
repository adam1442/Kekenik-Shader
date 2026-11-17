import { applyOperation, ops } from "@/core";
import { adoptionOps } from "../frames";
import { setStatus } from "@/app/state";
import { type EndPoint, checkConnection, inputType, outputType } from "../connect";
import { commit, getActiveDoc, getAnalysis, getGraph, getScene, getSelection, setSelection } from "../graphStore";
import { planInsertOnEdge } from "../actions";
import { useCanvasPrefs } from "../prefs";
import { portStyle } from "../portStyles";
import { wireStyleFor } from "../wireStyle";
import { type Pt, rectFromPoints, snapPoint } from "../viewport";
import type { CanvasController } from "./CanvasController";

const DRAG_THRESHOLD = 3;
const tr = (p: Pt) => `translate(${p.x}px, ${p.y}px)`;
const dist = (e: PointerEvent, x: number, y: number) => Math.hypot(e.clientX - x, e.clientY - y);

/* ── pan ─────────────────────────────────────────────────────────────────────────────────────────── */
export function startPan(c: CanvasController, e: PointerEvent): void {
  const sx = e.clientX,
    sy = e.clientY,
    v0 = { ...c.view };
  c.root.classList.add("is-panning");
  const done = () => {
    c.root.classList.remove("is-panning");
    c.persistView();
  };
  c.begin({
    move: (m) => c.setView({ ...v0, x: v0.x + m.clientX - sx, y: v0.y + m.clientY - sy }),
    up: done,
    cancel: () => {
      c.setView(v0);
      done();
    },
  });
}

/* ── box select ──────────────────────────────────────────────────────────────────────────────────── */
export function startBoxSelect(c: CanvasController, e: PointerEvent): void {
  const start = c.toLocal(e.clientX, e.clientY);
  const base = getSelection();
  const mode = e.shiftKey ? "add" : e.ctrlKey || e.metaKey || e.altKey ? "sub" : "replace";
  let started = false;
  const box = c.boxEl;
  const hide = () => {
    if (box) box.style.display = "none";
  };
  c.begin({
    move: (m) => {
      if (!started && dist(m, e.clientX, e.clientY) < DRAG_THRESHOLD) return;
      started = true;
      const cur = c.toLocal(m.clientX, m.clientY);
      const r = rectFromPoints(start, cur);
      if (box) {
        box.style.display = "block";
        box.dataset.mode = mode;
        Object.assign(box.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
      }
      const a = c.toWorld(m.clientX, m.clientY),
        b = c.toWorld(e.clientX, e.clientY);
      const hit = getScene().nodesIn(rectFromPoints(a, b));
      if (mode === "replace") setSelection(hit);
      else if (mode === "add") setSelection([...base, ...hit.filter((i) => !base.includes(i))]);
      else setSelection(base.filter((i) => !hit.includes(i)));
    },
    up: () => {
      if (!started && mode === "replace") setSelection([]);
      hide();
    },
    cancel: () => {
      setSelection(base);
      hide();
    },
  });
}

/* ── node drag (+ drop on wire = insert) ─────────────────────────────────────────────────────────── */
export function startNodeDrag(c: CanvasController, e: PointerEvent, id: string): void {
  const scene = getScene();
  const toggle = e.shiftKey || e.ctrlKey || e.metaKey;
  const wasSelected = getSelection().includes(id);
  if (!wasSelected) setSelection(toggle ? [...getSelection(), id] : [id]);
  const moving = getSelection().filter((i) => scene.get(i));
  if (!moving.includes(id)) moving.push(id);
  const starts = new Map(moving.map((i) => [i, { ...scene.get(i)!.node.position }]));
  const primary = starts.get(id)!;
  const graph = getGraph();
  const attached = new Set<string>();
  for (const ed of Object.values(graph.edges)) {
    attached.add(ed.from.node);
    attached.add(ed.to.node);
  }
  const insertable = moving.length === 1 && !attached.has(id);
  let started = false;
  let insertPlan: ReturnType<typeof planInsertOnEdge> = null;

  const restore = () => {
    const sc = getScene();
    for (const i of moving) {
      const el = c.nodeEls.get(i);
      const n = sc.get(i);
      if (el && n) el.style.transform = tr(n.node.position);
      el?.classList.remove("is-dragging");
    }
    c.overrides.clear();
    c.insertEdge = null;
    c.root.removeAttribute("data-dragging");
    c.invalidate(true, true);
  };

  c.begin({
    move: (m) => {
      if (!started && dist(m, e.clientX, e.clientY) < DRAG_THRESHOLD) return;
      if (!started) {
        started = true;
        c.root.setAttribute("data-dragging", "node");
        for (const i of moving) c.nodeEls.get(i)?.classList.add("is-dragging");
      }
      let dx = (m.clientX - e.clientX) / c.view.zoom,
        dy = (m.clientY - e.clientY) / c.view.zoom;
      const prefs = useCanvasPrefs.getState();
      if (prefs.snap && !m.altKey) {
        const s = snapPoint({ x: primary.x + dx, y: primary.y + dy }, prefs.gridSize);
        dx = s.x - primary.x;
        dy = s.y - primary.y;
      }
      for (const [i, p0] of starts) {
        const p = { x: Math.round(p0.x + dx), y: Math.round(p0.y + dy) };
        c.overrides.set(i, p);
        const el = c.nodeEls.get(i);
        if (el) el.style.transform = tr(p);
      }
      if (insertable) {
        const n = scene.get(id)!;
        const p = c.overrides.get(id)!;
        const center = { x: p.x + n.layout.width / 2, y: p.y + 16 };
        const hit = scene.wireAt(center, 16 / c.view.zoom, c.overrides);
        insertPlan =
          hit && hit.edge.from.node !== id && hit.edge.to.node !== id ? planInsertOnEdge(id, hit.edge) : null;
        c.insertEdge = insertPlan && hit ? hit.edge.id : null;
      }
      c.invalidate(true, true);
    },
    up: () => {
      if (!started) {
        if (wasSelected && toggle) setSelection(getSelection().filter((i) => i !== id));
        else if (wasSelected && !toggle && getSelection().length > 1) setSelection([id]);
        return;
      }
      const moves = [...c.overrides].map(([i, position]) => ({ id: i, position }));
      const list = [ops.moveNodes(moves), ...(insertPlan ?? [])];
      if (graph.groups.length) {
        // dropping a node inside a group adopts it, dragging it out releases it
        const sizes = (i: string) => scene.get(i)!.layout;
        const after = applyOperation(graph, list[0]!).graph;
        list.push(
          ...adoptionOps(
            after,
            moves.map((mv) => mv.id),
            (i) => {
              const m = moves.find((q) => q.id === i)!;
              return { x: m.position.x + sizes(i).width / 2, y: m.position.y + sizes(i).height / 2 };
            },
            (i) => scene.rect(i, c.overrides.get(i)),
          ),
        );
      }
      const real = moves.some((mv) => {
        const p = starts.get(mv.id)!;
        return p.x !== mv.position.x || p.y !== mv.position.y;
      });
      if (real)
        commit(
          insertPlan ? "Move and insert node" : moves.length > 1 ? `Move ${moves.length} nodes` : "Move node",
          list,
          insertPlan ? { select: [id] } : {},
        );
      restore();
    },
    cancel: restore,
  });
}

/* ── wire drag ───────────────────────────────────────────────────────────────────────────────────── */
export function startWireDrag(c: CanvasController, e: PointerEvent, port: EndPoint): void {
  const graph = getGraph();
  const scene = getScene();
  const analysis = getAnalysis();
  const ctx = { graph, scene, analysis };
  let anchor: EndPoint = port;
  let picked = null as (typeof graph.edges)[string] | null;
  if (port.dir === "in") {
    const ex = Object.values(graph.edges).find((ed) => ed.to.node === port.node && ed.to.port === port.port);
    if (ex) {
      // Pick the existing wire up: the loose end follows the cursor (dropping it on nothing removes the wire).
      picked = ex;
      anchor = { node: ex.from.node, port: ex.from.port, dir: "out" };
    }
  }
  const anchorType = anchor.dir === "out" ? outputType(ctx, anchor) : inputType(ctx, anchor);
  const anchorPos = scene.portPos(anchor.node, anchor.dir, anchor.port)!;
  const spec = anchor.dir === "in" ? scene.get(anchor.node)?.inputs.find((p) => p.id === anchor.port)?.type : undefined;
  const filter = { dir: anchor.dir, type: anchorType ?? "float", ...(spec ? { spec } : {}) } as const;
  let moved = false;
  let candidate: (EndPoint & { ok: boolean; reason?: string }) | null = null;

  // Glow compatible ports, dim the others.
  c.root.setAttribute("data-wiring", anchor.dir);
  c.hideEdge = picked?.id ?? null;
  const portEls = c.root.querySelectorAll<HTMLElement>("[data-port-id]");
  portEls.forEach((el) => {
    const ep: EndPoint = {
      node: el.dataset.portNode!,
      port: el.dataset.portId!,
      dir: el.dataset.portDir === "out" ? "out" : "in",
    };
    el.dataset.compat =
      ep.node === anchor.node && ep.port === anchor.port && ep.dir === anchor.dir
        ? "self"
        : ep.dir === anchor.dir
          ? "no"
          : checkConnection(ctx, anchor, ep).ok
            ? "yes"
            : "no";
  });

  const update = (clientX: number, clientY: number) => {
    const local = c.toLocal(clientX, clientY);
    const world = c.toWorld(clientX, clientY);
    const hit = scene.portAt(world, 18 / c.view.zoom, undefined, anchor.dir === "out" ? "in" : "out");
    let end = world;
    let valid: boolean | null = null;
    let dstType = anchorType;
    candidate = null;
    if (hit) {
      const r = checkConnection(ctx, anchor, { ...hit });
      candidate = { ...hit, ok: r.ok, ...(r.ok ? {} : { reason: r.reason }) };
      valid = r.ok;
      if (r.ok) {
        end = scene.portPos(hit.node, hit.dir, hit.port) ?? world;
        dstType = anchor.dir === "out" ? inputType(ctx, hit) : outputType(ctx, hit);
      }
    }
    const [srcT, dstT] = anchor.dir === "out" ? [anchorType, dstType] : [dstType, anchorType];
    const st = wireStyleFor(srcT, dstT);
    const live = anchor.dir === "out" ? { a: anchorPos, b: end } : { a: end, b: anchorPos };
    c.temp = {
      ...live,
      from: portStyle(srcT).color,
      to: valid ? st.to : portStyle(srcT).color,
      gradient: !!valid && st.gradient,
      valid,
    };
    c.showTip(candidate && !candidate.ok ? (candidate.reason ?? "") : null, local);
    c.invalidate(true);
  };

  const cleanup = () => {
    c.root.removeAttribute("data-wiring");
    portEls.forEach((el) => el.removeAttribute("data-compat"));
    c.temp = null;
    c.hideEdge = null;
    c.showTip(null);
    c.invalidate(true);
  };

  update(e.clientX, e.clientY);
  c.begin({
    move: (m) => {
      if (dist(m, e.clientX, e.clientY) >= DRAG_THRESHOLD) moved = true;
      update(m.clientX, m.clientY);
    },
    up: (m) => {
      update(m.clientX, m.clientY);
      const cand = candidate as (EndPoint & { ok: boolean; reason?: string }) | null;
      const world = c.toWorld(m.clientX, m.clientY);
      const local = c.toLocal(m.clientX, m.clientY);
      cleanup();
      // A plain click on a port (the "+" chip shown on hover) opens the add-node search already linked to that port.
      if (!moved && !picked) return void c.openSearch({ screen: local, world, filter, anchor });
      if (cand) {
        if (!cand.ok) return void setStatus(cand.reason ?? "Cannot connect", 3500);
        const r = checkConnection(ctx, anchor, cand);
        if (!r.ok) return;
        if (
          picked &&
          picked.to.node === r.to.node &&
          picked.to.port === r.to.port &&
          picked.from.node === r.from.node &&
          picked.from.port === r.from.port
        )
          return;
        commit("Connect", [...(picked ? [ops.disconnect(picked.id)] : []), ops.connect(r.from, r.to)]);
        return;
      }
      if (picked) {
        if (moved) commit("Disconnect", ops.disconnect(picked.id));
        return;
      }
      c.openSearch({ screen: local, world, filter, anchor });
    },
    cancel: cleanup,
  });
  void getActiveDoc;
}
