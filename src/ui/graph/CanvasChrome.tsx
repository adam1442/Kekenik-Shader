import { useEffect, useRef, useSyncExternalStore } from "react";
import { Grid3x3, Magnet, Map as MapIcon, Maximize, Minus, Plus, ScanSearch, X } from "lucide-react";
import { IconButton } from "@/ui";
import { frameAll, frameSelected } from "./actions";
import type { CanvasController } from "./controller/CanvasController";
import { activateDoc, closeDoc, newShaderGraph, openDoc, useGraphs } from "./graphStore";
import { useCanvasPrefs } from "./prefs";
import { drawMinimap, minimapToWorld, type MinimapMap } from "./render/minimapRenderer";
import { getScene, getSelection } from "./graphStore";

/** Tab strip: one tab per open graph (multi-graph editing). */
export function GraphTabs() {
  const docs = useGraphs((s) => s.docs);
  const activeId = useGraphs((s) => s.activeId);
  return (
    <div className="kk-gtabs" role="tablist" aria-label="Open graphs" data-testid="graph-tabs">
      {docs.map((d) => (
        <div
          key={d.id}
          role="tab"
          aria-selected={d.id === activeId}
          data-tab-id={d.id}
          className={`kk-gtab${d.id === activeId ? " is-active" : ""}${d.scope ? " is-sub" : ""}`}
          data-scope={d.scope}
          title={d.scope && d.path ? d.path.map((id) => d.graph.subgraphDefs[id]?.name ?? id).join(" › ") : undefined}
          onClick={() => activateDoc(d.id)}
          onAuxClick={(e) => e.button === 1 && closeDoc(d.id)}
        >
          <span className="kk-gtab__name">
            {d.scope ? (d.graph.subgraphDefs[d.scope]?.name ?? d.scope) : d.graph.name || "Untitled"}
          </span>
          {d.dirty && <span className="kk-gtab__dirty" title="Unsaved changes" />}
          <button
            type="button"
            className="kk-gtab__close"
            aria-label={`Close ${d.graph.name}`}
            onClick={(e) => (e.stopPropagation(), closeDoc(d.id))}
          >
            <X size={11} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="kk-gtabs__add"
        aria-label="New graph"
        title="New graph"
        onClick={() => openDoc(newShaderGraph())}
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

export function useCanvasView(ctl: CanvasController) {
  return useSyncExternalStore(
    (cb) => ctl.subscribe(cb),
    () => ctl.view,
  );
}

/** Bottom-left toolbar: zoom, frame, grid, snap, minimap. */
export function ZoomControls({ ctl }: { ctl: CanvasController }) {
  const view = useCanvasView(ctl);
  const prefs = useCanvasPrefs();
  return (
    <div className="kk-zoombar" data-no-pan="" data-testid="zoom-controls" onPointerDown={(e) => e.stopPropagation()}>
      <IconButton icon={Minus} size="sm" label="Zoom out" onClick={() => ctl.zoomBy(1 / 1.25, undefined, true)} />
      <button
        type="button"
        className="kk-zoombar__pct"
        title="Reset zoom to 100%"
        onClick={() => ctl.zoomTo(1, undefined, true)}
      >
        {Math.round(view.zoom * 100)}%
      </button>
      <IconButton icon={Plus} size="sm" label="Zoom in" onClick={() => ctl.zoomBy(1.25, undefined, true)} />
      <span className="kk-zoombar__sep" />
      <IconButton icon={Maximize} size="sm" label="Frame all (A)" onClick={() => frameAll()} />
      <IconButton icon={ScanSearch} size="sm" label="Frame selected (F)" onClick={() => frameSelected()} />
      <span className="kk-zoombar__sep" />
      <IconButton
        icon={Grid3x3}
        size="sm"
        label="Show grid"
        active={prefs.showGrid}
        onClick={() => prefs.set({ showGrid: !prefs.showGrid })}
      />
      <IconButton
        icon={Magnet}
        size="sm"
        label="Snap to grid"
        active={prefs.snap}
        onClick={() => prefs.set({ snap: !prefs.snap })}
      />
      <IconButton
        icon={MapIcon}
        size="sm"
        label="Minimap"
        active={prefs.minimap}
        onClick={() => prefs.set({ minimap: !prefs.minimap })}
      />
    </div>
  );
}

/** Minimap: all nodes + the viewport rectangle; click / drag to move the view. */
export function Minimap({ ctl }: { ctl: CanvasController }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const map = useRef<MinimapMap | null>(null);
  const visible = useCanvasPrefs((s) => s.minimap);
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  const selection = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.selection);
  const view = useCanvasView(ctl);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !visible) return;
    map.current = drawMinimap(
      c,
      getScene(),
      ctl.visibleRect(),
      new Set(getSelection()),
      Math.min(2, window.devicePixelRatio || 1),
    );
  }, [ctl, visible, graph, selection, view]);

  if (!visible) return null;
  const move = (e: React.PointerEvent) => {
    const c = canvas.current,
      m = map.current;
    if (!c || !m) return;
    const r = c.getBoundingClientRect();
    const w = minimapToWorld(m, { x: e.clientX - r.left, y: e.clientY - r.top });
    const z = ctl.view.zoom;
    ctl.setView({ zoom: z, x: ctl.size.w / 2 - w.x * z, y: ctl.size.h / 2 - w.y * z });
  };
  return (
    <div
      className="kk-minimap"
      data-no-pan=""
      data-testid="minimap"
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        move(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && move(e)}
      onPointerUp={() => ctl.persistView()}
    >
      <canvas ref={canvas} />
    </div>
  );
}
