import { isEditableTarget } from "@/app/commands/keybindings";
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  frameAll,
  frameSelected,
  moveNodes,
  pasteClipboard,
} from "../actions";
import { getGraph, getScene, getSelection, redo, selectAll, setSelection, undo } from "../graphStore";
import { useCanvasPrefs } from "../prefs";
import { addCommentAt, groupSelection } from "../frameActions";
import type { Rect } from "../viewport";
import { isSpaceTap } from "./spaceTap";
import { type Direction, pickNeighbor } from "./navigation";
import type { CanvasController } from "./CanvasController";

const ARROWS: Record<string, Direction> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

/** Keys typed into a text field / control must never drive the canvas. */
function fromControl(e: KeyboardEvent): boolean {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return false;
  return !!t.closest("[data-no-pan]") || isEditableTarget(t);
}

/**
 * Canvas shortcuts. Commands also bound globally (undo, copy, …) call the same actions; the global handler stops
 * propagation first, so a shortcut never runs twice, and the canvas still works when no global handler is installed.
 */
export function handleKeyDown(c: CanvasController, e: KeyboardEvent): void {
  if (fromControl(e) || e.isComposing) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const stop = () => {
    e.preventDefault();
    e.stopPropagation();
  };
  if (mod) {
    if (k === "z") (stop(), e.shiftKey ? redo() : undo());
    else if (k === "y") (stop(), redo());
    else if (k === "c") (stop(), void copySelection());
    else if (k === "x") (stop(), void cutSelection());
    else if (k === "v") (stop(), void pasteClipboard(c.cursorWorld()));
    else if (k === "d") (stop(), duplicateSelection());
    else if (k === "a") (stop(), selectAll());
    else if (k === "g") (stop(), groupSelection());
    return;
  }
  if (k === " ") {
    // U1: Space is the ONLY default trigger of the add-node search (tap = open on keyup; hold + drag = pan).
    stop();
    if (!e.repeat) {
      c.spaceDown = true;
      c.spaceUsed = false;
      c.spaceAt = performance.now();
      c.root.classList.add("is-space");
    }
    return;
  }
  if (k === "Delete" || k === "Backspace") return void (stop(), deleteSelection());
  if (k === "Escape") {
    if (getSelection().length) (stop(), setSelection([]));
    return;
  }
  if (k === "F2" && getSelection().length === 1)
    return void (stop(), window.dispatchEvent(new CustomEvent("kk-node-rename", { detail: getSelection()[0] })));
  if (k === "c") return void (stop(), addCommentAt(c.cursorWorld()));
  if (k === "f") return void (stop(), frameSelected());
  if (k === "a" || k === "Home") return void (stop(), frameAll());
  const dir = ARROWS[k];
  if (!dir) return;
  stop();
  if (e.altKey) return nudge(dir, e.shiftKey);
  // U4: a selection made only of reroutes / portals is nudged by the arrow keys (1 px, Shift = ×10) instead of navigating.
  const sel = getSelection(),
    g = getGraph();
  if (sel.length && sel.every((id) => ["reroute", "portalIn", "portalOut"].includes(g.nodes[id]?.defId ?? "")))
    return nudgePx(dir, e.shiftKey ? 10 : 1);
  navigate(c, dir, e.shiftKey);
}

export function handleKeyUp(c: CanvasController, e: KeyboardEvent): void {
  if (e.key !== " " || !c.spaceDown) return;
  const tap = isSpaceTap(c.spaceUsed, c.spaceAt, performance.now());
  c.resetSpace();
  if (tap && !fromControl(e)) c.openSearch({});
}

/** Move the selection by `px` world units as one undo step (reroute / portal arrow-key nudge). */
function nudgePx(dir: Direction, px: number): void {
  const d = { left: [-px, 0], right: [px, 0], up: [0, -px], down: [0, px] }[dir];
  const g = getGraph();
  moveNodes(
    getSelection()
      .filter((id) => g.nodes[id])
      .map((id) => ({ id, position: { x: g.nodes[id]!.position.x + d[0]!, y: g.nodes[id]!.position.y + d[1]! } })),
  );
}

/** Alt+Arrow: move the selection by one grid step (Shift: ×4) as one undo step. */
function nudge(dir: Direction, big: boolean): void {
  const step = useCanvasPrefs.getState().gridSize * (big ? 4 : 1);
  const d = { left: [-step, 0], right: [step, 0], up: [0, -step], down: [0, step] }[dir];
  const g = getGraph();
  moveNodes(
    getSelection()
      .filter((id) => g.nodes[id])
      .map((id) => ({ id, position: { x: g.nodes[id]!.position.x + d[0]!, y: g.nodes[id]!.position.y + d[1]! } })),
  );
}

/** Arrow keys: select the neighbouring node in that direction (Shift extends) and keep it in view. */
function navigate(c: CanvasController, dir: Direction, extend: boolean): void {
  const scene = getScene();
  const sel = getSelection();
  const rects = new Map<string, Rect>();
  for (const id of scene.nodes.keys()) rects.set(id, scene.rect(id)!);
  const from = sel[sel.length - 1] ?? [...rects.keys()][0];
  if (!from) return;
  const next = sel.length === 0 ? from : pickNeighbor(rects, from, dir);
  if (!next) return;
  setSelection(extend ? [...sel.filter((i) => i !== next), next] : [next]);
  const r = rects.get(next)!;
  const vis = c.visibleRect(-24);
  if (r.x < vis.x || r.y < vis.y || r.x + r.w > vis.x + vis.w || r.y + r.h > vis.y + vis.h) {
    const z = c.view.zoom;
    c.setView({ zoom: z, x: c.size.w / 2 - (r.x + r.w / 2) * z, y: c.size.h / 2 - (r.y + r.h / 2) * z }, true);
  }
}
