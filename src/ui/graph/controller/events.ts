import { addNodeAt, insertNodeOnEdge, planInsertOnEdge } from "../actions";
import { getScene, getSelection, setSelection } from "../graphStore";
import { screenToWorld, wheelZoomFactor } from "../viewport";
import type { CanvasController } from "./CanvasController";
import { startBoxSelect, startNodeDrag, startPan, startWireDrag } from "./gestures";
import { startFrameGesture } from "./frameGestures";
import { startMultiWireDrag } from "./multiWire";
import { useFrameSel } from "../frameActions";
import { isOverlayTarget } from "@/ui/overlay/overlayLayer";

/** Elements that own their pointer / keyboard input (number fields, popovers…) — the canvas must not hijack them. */
const isControl = (t: Element | null): boolean => !!t?.closest("[data-no-pan]");
const targetOf = (e: Event): Element | null => (e.target instanceof Element ? e.target : null);

const onPointerDown = (c: CanvasController, e: PointerEvent): void => {
  if (c.gesture) return;
  const t = targetOf(e);
  if (!t || (isControl(t) && !t.closest("[data-port-id]"))) return;
  if (e.button === 1 || (e.button === 0 && c.spaceDown)) {
    e.preventDefault();
    c.spaceUsed = true;
    c.root.focus({ preventScroll: true });
    return startPan(c, e);
  }
  if (e.button !== 0) return;
  c.root.focus({ preventScroll: true });
  const port = t.closest<HTMLElement>("[data-port-id]");
  if (port?.dataset.portNode) {
    const ep = {
      node: port.dataset.portNode,
      port: port.dataset.portId!,
      dir: port.dataset.portDir === "out" ? "out" : "in",
    } as const;
    if (e.shiftKey && startMultiWireDrag(c, e, ep)) return;
    return startWireDrag(c, e, ep);
  }
  const nodeEl = t.closest<HTMLElement>("[data-node-id]");
  if (nodeEl) {
    if (t.closest("[data-no-drag]")) return;
    useFrameSel.getState().set(null);
    // U4: Alt-drag from the centre of a reroute / portal starts a wire from its output (the centre otherwise moves the knob).
    if (e.altKey && (nodeEl.dataset.def === "reroute" || nodeEl.dataset.def === "portalOut"))
      return startWireDrag(c, e, { node: nodeEl.dataset.nodeId!, port: "out", dir: "out" });
    return startNodeDrag(c, e, nodeEl.dataset.nodeId!);
  }
  const frame = t.closest<HTMLElement>("[data-frame-id]");
  if (frame) {
    const onHead = !!t.closest(".kk-group__head") || frame.dataset.frameKind === "comment";
    const resize = !!t.closest("[data-frame-handle]");
    if (t.closest("[data-no-drag]")) return;
    if (resize || onHead)
      return startFrameGesture(
        c,
        e,
        { kind: frame.dataset.frameKind === "comment" ? "comment" : "group", id: frame.dataset.frameId! },
        resize ? "resize" : "move",
      );
  }
  useFrameSel.getState().set(null);
  startBoxSelect(c, e);
};

const onPointerMove = (c: CanvasController, e: PointerEvent): void => {
  c.cursor = c.toLocal(e.clientX, e.clientY);
  c.cursorInside = true;
  if (c.gesture || c.hoverQueued) return;
  c.hoverQueued = true;
  requestAnimationFrame(() => {
    c.hoverQueued = false;
    if (c.gesture || !c.cursorInside) return;
    const hit = getScene().wireAt(screenToWorld(c.view, c.cursor), 7 / c.view.zoom);
    c.setHover(hit?.edge.id ?? null);
  });
};

const onWheel = (c: CanvasController, e: WheelEvent): void => {
  // U2: only events whose target is inside the canvas element and NOT inside an overlay (search popup, menus, dropdown lists…) zoom the graph.
  const t = targetOf(e);
  if (!t || !c.root.contains(t) || isOverlayTarget(t)) return;
  if (e.ctrlKey && isControl(targetOf(e))) return; // Ctrl+wheel belongs to the focused number field
  e.preventDefault();
  c.spaceUsed = true;
  c.cancelAnimation();
  const trackpadPan = !e.ctrlKey && e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY));
  if (trackpadPan) c.panBy(-e.deltaX, -e.deltaY);
  else c.zoomBy(wheelZoomFactor(e.deltaY, e.deltaMode, e.ctrlKey), c.toLocal(e.clientX, e.clientY));
  c.persistView();
};

const onDblClick = (c: CanvasController, e: MouseEvent): void => {
  const t = targetOf(e);
  if (!t || isControl(t) || t.closest("[data-node-id]")) return;
  const local = c.toLocal(e.clientX, e.clientY);
  const world = screenToWorld(c.view, local);
  const hit = getScene().wireAt(world, 8 / c.view.zoom);
  // U1: double-click on empty canvas no longer opens the search (Space does); double-click on a wire still inserts a reroute.
  if (hit) c.onWireDoubleClick?.(hit.edge, world);
};

const KK_NODE_MIME = "application/x-kk-node";

/** Other features (Blackboard…) make the canvas a drop target for their own payloads. Handler gets the payload + the world position. */
type CanvasDrop = (payload: string, world: { x: number; y: number }) => void;
const extraDrops = new Map<string, CanvasDrop>();
export function registerCanvasDrop(mime: string, handler: CanvasDrop): () => void {
  extraDrops.set(mime, handler);
  return () => {
    if (extraDrops.get(mime) === handler) extraDrops.delete(mime);
  };
}

const acceptedMime = (e: DragEvent): string | undefined =>
  [KK_NODE_MIME, ...extraDrops.keys()].find((m) => e.dataTransfer?.types.includes(m));

const onDragOver = (e: DragEvent): void => {
  if (acceptedMime(e)) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "copy";
  }
};

const onDrop = (c: CanvasController, e: DragEvent): void => {
  const extra = [...extraDrops.keys()].find((m) => e.dataTransfer?.types.includes(m));
  if (extra) {
    e.preventDefault();
    extraDrops.get(extra)!(e.dataTransfer!.getData(extra), c.toWorld(e.clientX, e.clientY));
    return;
  }
  const defId = e.dataTransfer?.getData(KK_NODE_MIME);
  if (!defId) return;
  e.preventDefault();
  const world = c.toWorld(e.clientX, e.clientY);
  const id = addNodeAt(defId, { x: world.x - 20, y: world.y - 14 });
  if (!id) return;
  const hit = getScene().wireAt(world, 12 / c.view.zoom);
  if (hit && planInsertOnEdge(id, hit.edge)) insertNodeOnEdge(id, hit.edge.id);
};

/** Runs in the window capture phase BEFORE the global context-menu host: decides which scope the click belongs to. */
const prepareContextMenu = (c: CanvasController, e: MouseEvent): void => {
  const t = targetOf(e);
  if (!t || !c.root.contains(t)) return;
  c.ctxWorld = c.toWorld(e.clientX, e.clientY);
  const nodeEl = t.closest<HTMLElement>("[data-node-id]");
  if (nodeEl && !t.closest("[data-port-id]")) {
    const id = nodeEl.dataset.nodeId!;
    if (!getSelection().includes(id)) setSelection([id]);
    const defId = nodeEl.dataset.def ?? "";
    const structural =
      defId === "reroute"
        ? "graph.reroute"
        : defId === "portalIn" || defId === "portalOut"
          ? "graph.portal"
          : "graph.node";
    nodeEl.setAttribute("data-ctx-scope", getSelection().length > 1 ? "graph.selection" : structural);
    return;
  }
  const frameEl = t.closest<HTMLElement>("[data-frame-id]");
  if (frameEl) {
    useFrameSel
      .getState()
      .set({ kind: frameEl.dataset.frameKind === "comment" ? "comment" : "group", id: frameEl.dataset.frameId! });
    return;
  }
  if (t.closest("[data-port-id]") || isControl(t)) return;
  const hit = getScene().wireAt(c.ctxWorld, 9 / c.view.zoom);
  c.root.setAttribute("data-ctx-scope", hit ? "graph.wire" : "graph.canvas");
  if (hit) c.root.setAttribute("data-ctx-id", hit.edge.id);
  else c.root.removeAttribute("data-ctx-id");
};

/** Wires every DOM event of the canvas to the controller. Returns one cleanup function. */
export function bindCanvasEvents(
  c: CanvasController,
  keys: { down: (e: KeyboardEvent) => void; up: (e: KeyboardEvent) => void },
): () => void {
  const off: Array<() => void> = [];
  const on = <K extends keyof HTMLElementEventMap>(
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
    o?: AddEventListenerOptions,
  ) => {
    c.root.addEventListener(type, fn as EventListener, o);
    off.push(() => c.root.removeEventListener(type, fn as EventListener, o));
  };
  on("pointerdown", (e) => onPointerDown(c, e));
  on("pointermove", (e) => onPointerMove(c, e));
  on("pointerleave", () => {
    c.cursorInside = false;
    if (c.hoverEdge) c.setHover(null);
  });
  on("wheel", (e) => onWheel(c, e), { passive: false });
  on("dblclick", (e) => onDblClick(c, e));
  on("keydown", keys.down);
  on("keyup", keys.up);
  on("dragover", onDragOver);
  on("drop", (e) => onDrop(c, e));
  on("blur", () => c.resetSpace());
  // Space also works when the pointer is over the canvas but focus sits on <body> (e.g. right after clicking a panel's background).
  const winKey = (e: KeyboardEvent) => {
    if (e.key !== " " || !c.cursorInside || (e.target !== document.body && e.target !== document.documentElement))
      return;
    (e.type === "keydown" ? keys.down : keys.up)(e);
  };
  window.addEventListener("keydown", winKey);
  window.addEventListener("keyup", winKey);
  window.addEventListener("blur", c.resetSpaceBound);
  off.push(() => {
    window.removeEventListener("keydown", winKey);
    window.removeEventListener("keyup", winKey);
    window.removeEventListener("blur", c.resetSpaceBound);
  });
  const ctxPrep = (e: MouseEvent) => prepareContextMenu(c, e);
  window.addEventListener("contextmenu", ctxPrep, true);
  off.push(() => window.removeEventListener("contextmenu", ctxPrep, true));
  return () => off.splice(0).forEach((f) => f());
}
