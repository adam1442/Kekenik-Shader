import { type Edge } from "@/core";
import { getAnalysis, getGraph, getScene, getSelection, useGraphs } from "../graphStore";
import type { EndPoint } from "../connect";
import { useCanvasPrefs } from "../prefs";
import { WireRenderer, type DrawnWire, type TempWire } from "../render/wireRenderer";
import type { PortFilter } from "../searchRanking";
import {
  DEFAULT_VIEW,
  type Lod,
  type Pt,
  type Rect,
  type Size,
  type View,
  clampZoom,
  frameRect,
  lodFor,
  panBy,
  screenToWorld,
  visibleWorldRect,
  zoomAt,
} from "../viewport";
import { handleKeyDown, handleKeyUp } from "./keyboard";
import { bindCanvasEvents } from "./events";
import { syncPortalLinks } from "../portalUi";

export interface Gesture {
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
  cancel(): void;
}

export interface SearchRequest {
  /** Screen position inside the canvas (for the popup) and world position (for the new node). */
  screen: Pt;
  world: Pt;
  filter?: PortFilter;
  anchor?: EndPoint;
  insertEdge?: string;
}

/** Hook for (reroute nodes): double-click on a wire. */
export type WireHook = (edge: Edge, world: Pt) => void;

const MARGIN_PX = 260;

/**
 * Imperative canvas engine (no React in the hot path): pan / zoom / culling / wire canvas / gestures.
 * React renders the nodes; this class moves them (transforms) during drags and commits ONE graph operation on release.
 */
export class CanvasController {
  root!: HTMLElement;
  world!: HTMLElement;
  boxEl: HTMLElement | null = null;
  tipEl: HTMLElement | null = null;
  wires!: WireRenderer;
  view: View = { ...DEFAULT_VIEW };
  size: Size = { w: 800, h: 600 };
  dpr = 1;
  docId = "";
  overrides = new Map<string, Pt>();
  nodeEls = new Map<string, HTMLElement>();
  hoverEdge: string | null = null;
  insertEdge: string | null = null;
  hideEdge: string | null = null;
  temp: TempWire | null = null;
  cursor: Pt = { x: 0, y: 0 };
  cursorInside = false;
  spaceDown = false;
  spaceUsed = false;
  /** `performance.now()` of the Space keydown (tap-vs-hold, U1). */
  spaceAt = 0;
  /** Clears the Space state (no stuck "space-down" after blur / popup close). Bound variant for window listeners. */
  resetSpace(): void {
    this.spaceDown = false;
    this.spaceUsed = false;
    this.root?.classList.remove("is-space");
  }
  readonly resetSpaceBound = (): void => this.resetSpace();
  /** World position of the last context-menu request (for "Add Node here" / "Paste here"). */
  ctxWorld: Pt = { x: 0, y: 0 };
  gesture: Gesture | null = null;
  visible = new Set<string>();
  onVisible: (ids: string[]) => void = () => undefined;
  onSearch: (r: SearchRequest) => void = () => undefined;
  onWireDoubleClick: WireHook | null = null;
  /** True while a hover hit-test is queued for the next frame (see events.ts). */
  hoverQueued = false;

  private listeners = new Set<() => void>();
  private raf = 0;
  private dirty = { wires: false, cull: false };
  private anim = 0;
  private cleanup: Array<() => void> = [];

  /* ── lifecycle ───────────────────────────────────────────────────────────────────────────────── */
  attach(els: {
    root: HTMLElement;
    world: HTMLElement;
    canvas: HTMLCanvasElement;
    box: HTMLElement;
    tip: HTMLElement;
  }): void {
    this.root = els.root;
    this.world = els.world;
    this.boxEl = els.box;
    this.tipEl = els.tip;
    this.wires = new WireRenderer(els.canvas);
    this.cleanup.push(bindCanvasEvents(this, { down: (e) => handleKeyDown(this, e), up: (e) => handleKeyUp(this, e) }));
    const ro = new ResizeObserver(() => this.measure());
    ro.observe(this.root);
    this.cleanup.push(() => ro.disconnect());
    let lastGraph = getGraph(),
      lastSel = getSelection();
    const unsub = useGraphs.subscribe(() => {
      const g = getGraph(),
        s = getSelection();
      if (g !== lastGraph || s !== lastSel) {
        lastGraph = g;
        lastSel = s;
        this.invalidate(true, true);
      }
    });
    const unPrefs = useCanvasPrefs.subscribe(() => this.applyView(this.view));
    this.cleanup.push(unsub, unPrefs);
    this.measure();
    this.applyView(this.view);
  }

  detach(): void {
    this.cancelGesture();
    this.persistView();
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.anim);
    this.cleanup.splice(0).forEach((f) => f());
    this.listeners.clear();
  }

  /** Bind to a document (tab) and restore its view. */
  bind(docId: string, view: View): void {
    if (this.docId && this.docId !== docId) this.persistView();
    this.docId = docId;
    this.hoverEdge = null;
    this.overrides.clear();
    this.setView(view, false);
    this.invalidate(true, true);
  }

  persistView(): void {
    const id = this.docId;
    if (!id) return;
    const v = this.view;
    useGraphs.setState((s) => ({
      docs: s.docs.map((d) =>
        d.id === id && (d.view.x !== v.x || d.view.y !== v.y || d.view.zoom !== v.zoom) ? { ...d, view: v } : d,
      ),
    }));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    this.listeners.forEach((f) => f());
  }

  /* ── geometry helpers ────────────────────────────────────────────────────────────────────────── */
  measure(): void {
    const r = this.root.getBoundingClientRect();
    this.size = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.wires.resize(this.size, this.dpr);
    this.invalidate(true, true);
    this.emit();
  }
  toLocal(clientX: number, clientY: number): Pt {
    const r = this.root.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }
  toWorld(clientX: number, clientY: number): Pt {
    return screenToWorld(this.view, this.toLocal(clientX, clientY));
  }
  cursorWorld(): Pt {
    return this.cursorInside ? screenToWorld(this.view, this.cursor) : this.centerWorld();
  }
  centerWorld(): Pt {
    return screenToWorld(this.view, { x: this.size.w / 2, y: this.size.h / 2 });
  }
  get lod(): Lod {
    return lodFor(this.view.zoom);
  }
  visibleRect(margin = 0): Rect {
    return visibleWorldRect(this.view, this.size, margin);
  }
  getDrawn(): DrawnWire[] {
    return this.wires.lastDrawn;
  }

  /* ── view ────────────────────────────────────────────────────────────────────────────────────── */
  private applyView(v: View): void {
    this.view = v;
    this.world.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.zoom})`;
    const prefs = useCanvasPrefs.getState();
    const s = prefs.gridSize * v.zoom;
    this.root.style.setProperty("--kk-g-size", `${s}px`);
    this.root.style.setProperty("--kk-g-major", `${s * 8}px`);
    this.root.style.setProperty("--kk-g-x", `${v.x}px`);
    this.root.style.setProperty("--kk-g-y", `${v.y}px`);
    this.root.dataset.grid = prefs.showGrid ? (s >= 7 ? "dots" : "major") : "off";
    this.root.dataset.gridStyle = prefs.gridStyle;
    this.root.dataset.lod = lodFor(v.zoom);
    this.root.dataset.zoom = v.zoom.toFixed(3);
    this.invalidate(true, true);
    this.emit();
  }

  setView(v: View, animate = false): void {
    cancelAnimationFrame(this.anim);
    const to = { x: v.x, y: v.y, zoom: clampZoom(v.zoom) };
    if (!animate) return this.applyView(to);
    const from = this.view,
      t0 = performance.now(),
      D = 170;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / D),
        e = 1 - Math.pow(1 - k, 3);
      this.applyView({
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        zoom: from.zoom + (to.zoom - from.zoom) * e,
      });
      if (k < 1) this.anim = requestAnimationFrame(tick);
      else this.persistView();
    };
    this.anim = requestAnimationFrame(tick);
  }

  panBy(dx: number, dy: number): void {
    this.setView(panBy(this.view, dx, dy));
  }
  zoomTo(zoom: number, cursor: Pt = { x: this.size.w / 2, y: this.size.h / 2 }, animate = false): void {
    this.setView(zoomAt(this.view, cursor, zoom), animate);
    if (!animate) this.persistView();
  }
  zoomBy(factor: number, cursor?: Pt, animate = false): void {
    this.zoomTo(this.view.zoom * factor, cursor, animate);
  }
  frameRect(r: Rect, animate = true): void {
    this.setView(frameRect(r, this.size), animate);
  }

  /* ── scheduling ──────────────────────────────────────────────────────────────────────────────── */
  invalidate(wires = true, cull = false): void {
    this.dirty.wires ||= wires;
    this.dirty.cull ||= cull;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.frame());
  }

  /** Synchronous redraw (tests and gestures that need pixel-exact state). */
  flush(): void {
    cancelAnimationFrame(this.raf);
    this.frame();
  }

  private frame(): void {
    this.raf = 0;
    if (!this.root.isConnected) return;
    const { wires, cull } = this.dirty;
    this.dirty = { wires: false, cull: false };
    if (cull) this.updateVisible();
    if (wires) {
      const graph = getGraph();
      this.wires.draw(this.view, this.size, this.dpr, {
        graph,
        scene: getScene(),
        analysis: getAnalysis(),
        selection: new Set(getSelection()),
        hoverEdge: this.hoverEdge,
        overrides: this.overrides,
        temp: this.temp,
        insertEdge: this.insertEdge,
        hideEdge: this.hideEdge,
      });
      if (this.overrides.size) syncPortalLinks(this.root, getScene(), this.overrides);
    }
  }

  private updateVisible(): void {
    const scene = getScene();
    const ids = new Set(scene.nodesIn(visibleWorldRect(this.view, this.size, MARGIN_PX), this.overrides));
    for (const id of getSelection()) if (scene.get(id) && !scene.isHidden(id)) ids.add(id);
    for (const id of this.overrides.keys()) ids.add(id);
    if (ids.size === this.visible.size && [...ids].every((i) => this.visible.has(i))) return;
    this.visible = ids;
    this.onVisible([...ids]);
  }

  registerNode(id: string, el: HTMLElement | null): void {
    if (el) this.nodeEls.set(id, el);
    else this.nodeEls.delete(id);
  }

  /* ── gestures ────────────────────────────────────────────────────────────────────────────────── */
  begin(g: Gesture): void {
    this.cancelGesture();
    this.gesture = g;
    const move = (e: PointerEvent) => this.gesture?.move(e);
    const up = (e: PointerEvent) => {
      const cur = this.gesture;
      this.endGesture();
      cur?.up(e);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.cancelGesture();
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", key, true);
    this.gestureCleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", key, true);
    };
  }
  private gestureCleanup: (() => void) | null = null;
  private endGesture(): void {
    this.gestureCleanup?.();
    this.gestureCleanup = null;
    this.gesture = null;
  }
  cancelGesture(): void {
    const g = this.gesture;
    this.endGesture();
    g?.cancel();
  }

  cancelAnimation(): void {
    cancelAnimationFrame(this.anim);
  }

  setHover(id: string | null): void {
    if (this.hoverEdge === id) return;
    this.hoverEdge = id;
    this.root.classList.toggle("is-wire-hover", id !== null);
    this.invalidate(true);
  }

  showTip(text: string | null, at?: Pt): void {
    const t = this.tipEl;
    if (!t) return;
    if (!text || !at) {
      t.style.display = "none";
      return;
    }
    t.textContent = text;
    t.style.display = "block";
    t.style.transform = `translate(${Math.round(at.x + 14)}px, ${Math.round(at.y + 16)}px)`;
  }

  openSearch(r: Omit<SearchRequest, "screen" | "world"> & { world?: Pt; screen?: Pt }): void {
    const screen = r.screen ?? (this.cursorInside ? this.cursor : { x: this.size.w / 2 - 160, y: this.size.h / 3 });
    const world = r.world ?? screenToWorld(this.view, screen);
    this.resetSpace();
    this.onSearch({ ...r, screen, world });
  }
}
