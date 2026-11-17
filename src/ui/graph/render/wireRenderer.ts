import type { Graph, GraphAnalysis } from "@/core";
import { edgeStyle, type WireStyle } from "../wireStyle";
import type { SceneIndex } from "../sceneIndex";
import { type Bezier, bezierBounds, wireBezier } from "../wireGeometry";
import { type Pt, type Size, type View, rectsIntersect, visibleWorldRect } from "../viewport";

/** A wire being dragged by the user (not part of the graph yet). */
export interface TempWire {
  a: Pt;
  b: Pt;
  /** Colours at the anchor / at the cursor end. */
  from: string;
  to: string;
  gradient: boolean;
  /** null = not over a port, true = valid target, false = forbidden target (drawn red). */
  valid: boolean | null;
}

export interface WireFrame {
  graph: Graph;
  scene: SceneIndex;
  analysis: GraphAnalysis | null;
  selection: ReadonlySet<string>;
  hoverEdge: string | null;
  overrides: ReadonlyMap<string, Pt>;
  temp: TempWire | null;
  /** Edge highlighted as the insertion target of a dragged node. */
  insertEdge: string | null;
  /** Edge temporarily hidden (its end is being re-dragged). */
  hideEdge?: string | null;
}

/** What the renderer actually painted last frame (the tests inspects this: gradient iff implicit conversion). */
export interface DrawnWire {
  id: string;
  style: WireStyle;
  emphasis: "normal" | "selected" | "hover" | "dim" | "insert";
}

/**
 * Single-canvas wire layer. Only wires whose bounds intersect the viewport are drawn; colours come from the source port
 * type and become a source→target gradient exactly for implicit conversions.
 */
export class WireRenderer {
  private ctx: CanvasRenderingContext2D | null;
  private styleCache = new Map<string, WireStyle>();
  private cacheKey: { graph: Graph | null; analysis: GraphAnalysis | null } = { graph: null, analysis: null };
  /** Wires painted in the last `draw()` (ids + resolved style). */
  lastDrawn: DrawnWire[] = [];
  lastCulled = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d");
  }

  resize(size: Size, dpr: number): void {
    const w = Math.max(1, Math.round(size.w * dpr)),
      h = Math.max(1, Math.round(size.h * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  private style(f: WireFrame, id: string): WireStyle {
    if (this.cacheKey.graph !== f.graph || this.cacheKey.analysis !== f.analysis) {
      this.styleCache.clear();
      this.cacheKey = { graph: f.graph, analysis: f.analysis };
    }
    let s = this.styleCache.get(id);
    if (!s) {
      s = edgeStyle(f.graph, f.scene, f.analysis, f.graph.edges[id]!);
      this.styleCache.set(id, s);
    }
    return s;
  }

  draw(view: View, size: Size, dpr: number, f: WireFrame): void {
    const c = this.ctx;
    if (!c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y);
    c.lineCap = "round";
    const vis = visibleWorldRect(view, size, 30);
    const hasSel = f.selection.size > 0;
    const drawn: DrawnWire[] = [];
    let culled = 0;
    const px = (n: number) => (n * Math.max(0.75, Math.min(1.5, view.zoom))) / view.zoom;
    const order: Array<{ id: string; z: Bezier; emphasis: DrawnWire["emphasis"] }> = [];
    for (const e of Object.values(f.graph.edges)) {
      if (e.id === f.hideEdge) continue;
      const z = f.scene.edgeBezier(e, f.overrides);
      if (!z || !rectsIntersect(bezierBounds(z), vis)) {
        culled++;
        continue;
      }
      const touching = f.selection.has(e.from.node) || f.selection.has(e.to.node);
      const emphasis: DrawnWire["emphasis"] =
        e.id === f.insertEdge
          ? "insert"
          : e.id === f.hoverEdge
            ? "hover"
            : touching
              ? "selected"
              : hasSel
                ? "dim"
                : "normal";
      order.push({ id: e.id, z, emphasis });
    }
    const rank = { dim: 0, normal: 1, selected: 2, hover: 3, insert: 4 } as const;
    order.sort((a, b) => rank[a.emphasis] - rank[b.emphasis]);
    for (const { id, z, emphasis } of order) {
      const st = this.style(f, id);
      drawn.push({ id, style: st, emphasis });
      const width = emphasis === "hover" || emphasis === "insert" ? 3.4 : emphasis === "selected" ? 2.6 : 2;
      const alpha = emphasis === "dim" ? 0.32 : emphasis === "normal" ? 0.86 : 1;
      this.stroke(
        c,
        z,
        st.from,
        st.to,
        st.gradient,
        px(width),
        alpha,
        emphasis === "hover" || emphasis === "insert" || emphasis === "selected" ? px(width + 5) : 0,
      );
    }
    if (f.temp) {
      const t = f.temp;
      const z = wireBezier(t.a, t.b);
      const bad = t.valid === false;
      this.stroke(c, z, bad ? "#f87171" : t.from, bad ? "#f87171" : t.to, !bad && t.gradient, px(2.6), 0.95, px(7));
    }
    this.lastDrawn = drawn;
    this.lastCulled = culled;
  }

  private stroke(
    c: CanvasRenderingContext2D,
    z: Bezier,
    from: string,
    to: string,
    gradient: boolean,
    width: number,
    alpha: number,
    glow: number,
  ): void {
    const path = new Path2D();
    path.moveTo(z.p0.x, z.p0.y);
    path.bezierCurveTo(z.p1.x, z.p1.y, z.p2.x, z.p2.y, z.p3.x, z.p3.y);
    let paint: string | CanvasGradient = from;
    if (gradient) {
      const g = c.createLinearGradient(z.p0.x, z.p0.y, z.p3.x, z.p3.y);
      g.addColorStop(0, from);
      g.addColorStop(1, to);
      paint = g;
    }
    if (glow > 0) {
      c.globalAlpha = alpha * 0.18;
      c.strokeStyle = paint;
      c.lineWidth = glow;
      c.stroke(path);
    }
    c.globalAlpha = alpha;
    c.strokeStyle = paint;
    c.lineWidth = width;
    c.stroke(path);
    c.globalAlpha = 1;
  }
}
