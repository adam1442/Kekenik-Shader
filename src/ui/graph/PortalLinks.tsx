import { useMemo } from "react";
import { ArrowUp } from "lucide-react";
import type { CanvasController } from "./controller/CanvasController";
import { useCanvasView } from "./CanvasChrome";
import { activeLinks, channelColor, edgeIndicator, portalLinkPath, usePortalUi } from "./portalUi";
import { getScene, setSelection, useGraphs } from "./graphStore";

/** Portals whose partners should be drawn: the selected ones and the hovered one. */
function useActivePortals(): string[] {
  const hover = usePortalUi((s) => s.hover);
  const sel = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.selection);
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  return useMemo(() => {
    const ids = [...(sel ?? []), ...(hover ? [hover] : [])];
    return [...new Set(ids)].filter((id) => graph?.nodes[id] && /^portal(In|Out)$/.test(graph.nodes[id]!.defId));
  }, [sel, hover, graph]);
}

/**
 * Dashed, animated (marching ants) lines between a selected / hovered portal and its counterparts — drawn in the world layer ABOVE
 * all nodes (pointer-events: none). Rendered as SVG so tests and users can inspect `path[data-portal-link]`.
 */
export function PortalLinkLayer() {
  const active = useActivePortals();
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  const links = useMemo(() => (graph ? activeLinks(graph, active) : []), [graph, active]);
  if (!graph || links.length === 0) return null;
  const scene = getScene();
  return (
    <svg className="kk-portal-links" data-testid="portal-links" width={1} height={1} aria-hidden="true">
      {links.map((l) => {
        const a = scene.rect(l.fromId),
          b = scene.rect(l.toId);
        if (!a || !b || scene.isHidden(l.fromId) || scene.isHidden(l.toId)) return null;
        const color =
          graph.nodes[l.toId]?.defId === "portalOut" && !graph.nodes[l.fromId] ? "#f87171" : channelColor(l.channel);
        return (
          <path
            key={`${l.fromId}>${l.toId}`}
            className="kk-portal-link"
            data-portal-link=""
            data-from={l.fromId}
            data-to={l.toId}
            data-channel={l.channel}
            d={portalLinkPath(a, b)}
            style={{ stroke: color }}
          />
        );
      })}
    </svg>
  );
}

/** Arrows at the viewport edge pointing to off-screen partners; double-click jumps there. Screen-space overlay. */
export function PortalIndicators({ ctl }: { ctl: CanvasController }) {
  const view = useCanvasView(ctl);
  const active = useActivePortals();
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  if (!graph || active.length === 0) return null;
  const scene = getScene();
  const seen = new Set<string>();
  const items: Array<{ id: string; x: number; y: number; angle: number; channel: string }> = [];
  for (const l of activeLinks(graph, active)) {
    for (const id of [l.fromId, l.toId]) {
      if (active.includes(id) || seen.has(id)) continue;
      const r = scene.rect(id);
      const ind = r && edgeIndicator(r, view, ctl.size);
      if (ind) {
        seen.add(id);
        items.push({ id, ...ind, channel: l.channel });
      }
    }
  }
  return (
    <>
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          className="kk-portal-indicator"
          data-portal-indicator={i.id}
          data-no-pan=""
          title={`Portal "${i.channel}" is off-screen — double-click to jump`}
          style={{ left: i.x, top: i.y, color: channelColor(i.channel) }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            jumpToNode(ctl, i.id);
          }}
        >
          <ArrowUp size={14} style={{ transform: `rotate(${i.angle + Math.PI / 2}rad)` }} />
        </button>
      ))}
    </>
  );
}

/** Centre the view on a node and select it. */
function jumpToNode(ctl: CanvasController, id: string): void {
  const r = getScene().rect(id);
  if (!r) return;
  setSelection([id]);
  ctl.frameRect({ x: r.x - 200, y: r.y - 120, w: r.w + 400, h: r.h + 240 }, true);
}
