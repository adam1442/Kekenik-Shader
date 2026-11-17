import { create } from "zustand";
import { type Graph, type PortRef, type Rect4, channelMembers, portalPartners } from "@/core";
import { type Pt, type Rect, type Size, type View, worldToScreen } from "./viewport";

/** Transient UI state of portals: which one is hovered (the selection comes from the document). */
export const usePortalUi = create<{ hover: string | null; setHover: (id: string | null) => void }>((set) => ({
  hover: null,
  setHover: (hover) => set((s) => (s.hover === hover ? s : { hover })),
}));

/** Stable colour of a channel (hash → hue). Orphans are drawn red by the view, not by this function. */
export function channelColor(name: string): string {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return `hsl(${(h >>> 0) % 360} 72% 62%)`;
}

export interface PortalLink {
  /** Portal In (always the start of the dashed path) and the Out it reaches. */
  fromId: string;
  toId: string;
  channel: string;
}

/** The dashed links to draw for the "active" portals (selected or hovered): In → each Out of the channel. */
export function activeLinks(graph: Graph, active: readonly string[]): PortalLink[] {
  const out = new Map<string, PortalLink>();
  for (const id of active) {
    const n = graph.nodes[id];
    if (!n) continue;
    for (const p of portalPartners(graph, id)) {
      const [a, b] = n.defId === "portalIn" ? [id, p] : [p, id];
      out.set(`${a}>${b}`, { fromId: a, toId: b, channel: String(n.params.channel ?? "") });
    }
    // an active portal also lights up the siblings of its channel (the other Outs), so the whole channel reads at a glance
    if (n.defId === "portalOut")
      for (const m of channelMembers(graph, id))
        if (m !== id && graph.nodes[m]?.defId === "portalOut") {
          const inn = portalPartners(graph, m)[0];
          if (inn) out.set(`${inn}>${m}`, { fromId: inn, toId: m, channel: String(n.params.channel ?? "") });
        }
  }
  return [...out.values()];
}

export interface EdgeIndicator {
  /** Screen position (clamped inside the viewport, `margin` from the edge) and arrow angle in radians pointing at the target. */
  x: number;
  y: number;
  angle: number;
}

/**
 * Where to draw the "partner is off-screen" arrow. Returns null when the target rectangle is (even partly) visible.
 * The arrow sits where the ray from the viewport centre to the target crosses the viewport inset by `margin`.
 */
export function edgeIndicator(target: Rect4 | Rect, view: View, size: Size, margin = 22): EdgeIndicator | null {
  const tl = worldToScreen(view, { x: target.x, y: target.y });
  const br = worldToScreen(view, { x: target.x + target.w, y: target.y + target.h });
  if (br.x >= 0 && tl.x <= size.w && br.y >= 0 && tl.y <= size.h) return null;
  const c: Pt = { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2 };
  const o: Pt = { x: size.w / 2, y: size.h / 2 };
  const dx = c.x - o.x,
    dy = c.y - o.y;
  const hx = Math.max(1, size.w / 2 - margin),
    hy = Math.max(1, size.h / 2 - margin);
  const t = Math.min(dx === 0 ? Infinity : hx / Math.abs(dx), dy === 0 ? Infinity : hy / Math.abs(dy));
  return { x: o.x + dx * t, y: o.y + dy * t, angle: Math.atan2(dy, dx) };
}

export const portRefOf = (node: string, port: string): PortRef => ({ node, port });

/** SVG path of a dashed portal link between two node rects (Portal In output side → Portal Out input side). */
export function portalLinkPath(a: Rect, b: Rect): string {
  const p = { x: a.x + a.w, y: a.y + a.h / 2 },
    q = { x: b.x, y: b.y + b.h / 2 };
  const dx = Math.max(60, Math.abs(q.x - p.x) * 0.5);
  return `M ${p.x} ${p.y} C ${p.x + dx} ${p.y}, ${q.x - dx} ${q.y}, ${q.x} ${q.y}`;
}

/** Minimal scene surface needed to lay out links (a `SceneIndex` satisfies it). */
export interface RectSource {
  rect(id: string, at?: Pt): Rect | null;
}

/**
 * U10: re-lay-out the rendered dashed links from the controller's TRANSIENT geometry (nodes being dragged) so they follow portals / nodes live
 * instead of catching up on release. Imperative (no React in the drag hot path).
 */
export function syncPortalLinks(root: ParentNode, scene: RectSource, overrides: ReadonlyMap<string, Pt>): number {
  let n = 0;
  for (const el of root.querySelectorAll<SVGPathElement>("path[data-portal-link]")) {
    const from = el.dataset.from,
      to = el.dataset.to;
    const a = from ? scene.rect(from, overrides.get(from)) : null,
      b = to ? scene.rect(to, overrides.get(to)) : null;
    if (!a || !b) continue;
    el.setAttribute("d", portalLinkPath(a, b));
    n++;
  }
  return n;
}
