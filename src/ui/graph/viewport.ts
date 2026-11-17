/** Pure viewport math (no DOM). `screen = world * zoom + (x, y)`; screen coordinates are relative to the canvas element. */
export interface View {
  x: number;
  y: number;
  zoom: number;
}
export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Size {
  w: number;
  h: number;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 4;
export const DEFAULT_VIEW: View = { x: 0, y: 0, zoom: 1 };

export const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export const screenToWorld = (v: View, p: Pt): Pt => ({ x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom });
export const worldToScreen = (v: View, p: Pt): Pt => ({ x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y });

/** Change zoom while keeping the world point under `cursor` fixed on screen. */
export function zoomAt(v: View, cursor: Pt, nextZoom: number): View {
  const zoom = clampZoom(nextZoom);
  const w = screenToWorld(v, cursor);
  return { zoom, x: cursor.x - w.x * zoom, y: cursor.y - w.y * zoom };
}

/** Multiplicative zoom factor for a wheel event (pixel-normalised; Ctrl/pinch zooms faster than a mouse wheel notch). */
export function wheelZoomFactor(deltaY: number, deltaMode = 0, pinch = false): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const clamped = Math.max(-240, Math.min(240, px));
  return Math.exp(-clamped * (pinch ? 0.01 : 0.0016));
}

export const panBy = (v: View, dx: number, dy: number): View => ({ ...v, x: v.x + dx, y: v.y + dy });

/** World rectangle visible in a canvas of `size`, grown by `margin` screen pixels. */
export function visibleWorldRect(v: View, size: Size, margin = 0): Rect {
  return {
    x: (-v.x - margin) / v.zoom,
    y: (-v.y - margin) / v.zoom,
    w: (size.w + margin * 2) / v.zoom,
    h: (size.h + margin * 2) / v.zoom,
  };
}

export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
export const rectContainsPoint = (r: Rect, p: Pt): boolean =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** Normalised rectangle from two corner points. */
export function rectFromPoints(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function boundsOf(rects: Iterable<Rect>): Rect | null {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** View that centres `rect` in `size` with padding; zoom never exceeds `maxZoom` (default 1.25) so small selections are not blown up. */
export function frameRect(rect: Rect, size: Size, padding = 72, maxZoom = 1.25): View {
  const aw = Math.max(1, size.w - padding * 2);
  const ah = Math.max(1, size.h - padding * 2);
  const zoom = clampZoom(Math.min(maxZoom, aw / Math.max(1, rect.w), ah / Math.max(1, rect.h)));
  return { zoom, x: size.w / 2 - (rect.x + rect.w / 2) * zoom, y: size.h / 2 - (rect.y + rect.h / 2) * zoom };
}

const snapValue = (v: number, grid: number): number => Math.round(v / grid) * grid;
export const snapPoint = (p: Pt, grid: number): Pt => ({ x: snapValue(p.x, grid), y: snapValue(p.y, grid) });

/** Zoom level of detail: `full` ≥ 40 %, `low` (labels + editors hidden) 18–40 %, `min` (boxes only) below. */
export type Lod = "full" | "low" | "min";
export const lodFor = (zoom: number): Lod => (zoom >= 0.4 ? "full" : zoom >= 0.18 ? "low" : "min");
