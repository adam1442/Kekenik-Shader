import type { SceneIndex } from "../sceneIndex";
import { type Pt, type Rect, type Size, boundsOf } from "../viewport";

/** Minimap mapping: the world bounds of all nodes ∪ the current viewport, fitted into `size` (pure, tested). */
export interface MinimapMap {
  world: Rect;
  scale: number;
  ox: number;
  oy: number;
}

function minimapMap(nodeRects: Iterable<Rect>, viewport: Rect, size: Size, pad = 160): MinimapMap {
  const b = boundsOf([...nodeRects, viewport]) ?? viewport;
  const world: Rect = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
  const scale = Math.min(size.w / world.w, size.h / world.h);
  return { world, scale, ox: (size.w - world.w * scale) / 2, oy: (size.h - world.h * scale) / 2 };
}

export const minimapToWorld = (m: MinimapMap, p: Pt): Pt => ({
  x: (p.x - m.ox) / m.scale + m.world.x,
  y: (p.y - m.oy) / m.scale + m.world.y,
});

export function drawMinimap(
  canvas: HTMLCanvasElement,
  scene: SceneIndex,
  viewport: Rect,
  selection: ReadonlySet<string>,
  dpr: number,
): MinimapMap {
  const size = { w: canvas.clientWidth || 180, h: canvas.clientHeight || 120 };
  if (canvas.width !== size.w * dpr) canvas.width = size.w * dpr;
  if (canvas.height !== size.h * dpr) canvas.height = size.h * dpr;
  const rects: Rect[] = [];
  for (const id of scene.nodes.keys()) rects.push(scene.rect(id)!);
  const m = minimapMap(rects, viewport, size);
  const c = canvas.getContext("2d");
  if (!c) return m;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, size.w, size.h);
  const sx = (x: number) => (x - m.world.x) * m.scale + m.ox;
  const sy = (y: number) => (y - m.world.y) * m.scale + m.oy;
  for (const [id, s] of scene.nodes) {
    const r = scene.rect(id)!;
    c.fillStyle = selection.has(id) ? "#9b86ff" : "rgba(168,178,200,0.55)";
    c.fillRect(sx(r.x), sy(r.y), Math.max(2, r.w * m.scale), Math.max(2, r.h * m.scale));
    void s;
  }
  c.strokeStyle = "rgba(155,134,255,0.95)";
  c.fillStyle = "rgba(124,92,255,0.12)";
  c.lineWidth = 1.5;
  c.fillRect(sx(viewport.x), sy(viewport.y), viewport.w * m.scale, viewport.h * m.scale);
  c.strokeRect(sx(viewport.x), sy(viewport.y), viewport.w * m.scale, viewport.h * m.scale);
  return m;
}
