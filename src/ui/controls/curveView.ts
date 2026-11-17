/** Pure view math for the curve editor (screen ↔ curve space, adaptive grid, framing, hit-testing). No DOM. */
import { evaluate, sideOf, type Curve } from "@/core/values/curve";

export interface View {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
export interface Size {
  w: number;
  h: number;
}

export const toScreen = (v: View, s: Size, t: number, val: number): [number, number] => [
  ((t - v.x0) / (v.x1 - v.x0)) * s.w,
  s.h - ((val - v.y0) / (v.y1 - v.y0)) * s.h,
];
export const toCurve = (v: View, s: Size, x: number, y: number): [number, number] => [
  v.x0 + (x / s.w) * (v.x1 - v.x0),
  v.y0 + ((s.h - y) / s.h) * (v.y1 - v.y0),
];

/** A "nice" grid step (1, 2 or 5 × 10^n) so that ≈ `target` lines fit in `span`. */
export function niceStep(span: number, target: number): number {
  const raw = span / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/** Grid tick values in [lo, hi] spaced ≥ `minPx` apart on a `px`-long axis. */
export function gridTicks(lo: number, hi: number, px: number, minPx = 48): number[] {
  const step = niceStep(hi - lo, Math.max(1, px / minPx));
  const first = Math.ceil(lo / step - 1e-9);
  const out: number[] = [];
  for (let i = first; i * step <= hi + 1e-9 && out.length < 400; i++) out.push(Number((i * step).toFixed(10)));
  return out;
}

/** Fit all points with padding; `unit` frames the 0..1 box instead. Degenerate extents are widened. */
export function frameView(points: Array<{ t: number; v: number }>, opts: { pad?: number; unit?: boolean } = {}): View {
  const pad = opts.pad ?? 0.12;
  if (opts.unit || points.length === 0) return { x0: -pad, x1: 1 + pad, y0: -pad, y1: 1 + pad };
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.t);
    x1 = Math.max(x1, p.t);
    y0 = Math.min(y0, p.v);
    y1 = Math.max(y1, p.v);
  }
  if (x1 - x0 < 1e-6) {
    x0 -= 0.5;
    x1 += 0.5;
  }
  if (y1 - y0 < 1e-6) {
    y0 -= 0.5;
    y1 += 0.5;
  }
  const dx = (x1 - x0) * pad;
  const dy = (y1 - y0) * pad;
  return { x0: x0 - dx, x1: x1 + dx, y0: y0 - dy, y1: y1 + dy };
}

export function zoomView(
  v: View,
  s: Size,
  px: number,
  py: number,
  factor: number,
  axes: "both" | "x" | "y" = "both",
): View {
  const [ct, cv] = toCurve(v, s, px, py);
  const f = Math.min(Math.max(factor, 0.05), 20);
  const zx = axes !== "y";
  const zy = axes !== "x";
  const nx0 = zx ? ct - (ct - v.x0) * f : v.x0;
  const nx1 = zx ? ct + (v.x1 - ct) * f : v.x1;
  const ny0 = zy ? cv - (cv - v.y0) * f : v.y0;
  const ny1 = zy ? cv + (v.y1 - cv) * f : v.y1;
  // keep a sane extent
  if (nx1 - nx0 < 1e-5 || ny1 - ny0 < 1e-5 || nx1 - nx0 > 1e7 || ny1 - ny0 > 1e7) return v;
  return { x0: nx0, x1: nx1, y0: ny0, y1: ny1 };
}

export function panView(v: View, s: Size, dxPx: number, dyPx: number): View {
  const dt = (dxPx / s.w) * (v.x1 - v.x0);
  const dv = (dyPx / s.h) * (v.y1 - v.y0);
  return { x0: v.x0 - dt, x1: v.x1 - dt, y0: v.y0 + dv, y1: v.y1 + dv };
}

const HANDLE_LEN = 38;

/** Screen position of a key's tangent handle (fixed pixel length along the slope direction). */
export function handleScreenPos(v: View, s: Size, c: Curve, i: number, side: "in" | "out"): [number, number] {
  const k = c.keys[i]!;
  const [kx, ky] = toScreen(v, s, k.t, k.v);
  const ppT = s.w / (v.x1 - v.x0);
  const ppV = s.h / (v.y1 - v.y0);
  const slope = side === "in" ? k.inTan : k.outTan;
  let vx = ppT;
  let vy = -slope * ppV;
  const len = Math.hypot(vx, vy) || 1;
  vx = (vx / len) * HANDLE_LEN;
  vy = (vy / len) * HANDLE_LEN;
  const dir = side === "out" ? 1 : -1;
  return [kx + dir * vx, ky + dir * vy];
}

/** Slope implied by dragging a handle to screen point (px,py) for key i. */
export function slopeFromHandle(
  v: View,
  s: Size,
  c: Curve,
  i: number,
  side: "in" | "out",
  px: number,
  py: number,
): number {
  const k = c.keys[i]!;
  const [kx, ky] = toScreen(v, s, k.t, k.v);
  const ppT = s.w / (v.x1 - v.x0);
  const ppV = s.h / (v.y1 - v.y0);
  let dx = px - kx;
  const dy = ky - py;
  // keep the handle on its own side of the key
  if (side === "out") dx = Math.max(dx, 1e-3);
  else dx = Math.min(dx, -1e-3);
  return Math.max(-1e5, Math.min(1e5, dy / ppV / (dx / ppT)));
}

export type Hit = { kind: "key"; index: number } | { kind: "handle"; index: number; side: "in" | "out" } | null;

/** Hit-test keys and (for selected keys) draggable handles. Handles win over keys. */
export function hitTest(
  c: Curve,
  v: View,
  s: Size,
  selected: ReadonlySet<number>,
  px: number,
  py: number,
  radius = 8,
): Hit {
  for (const i of selected) {
    const k = c.keys[i];
    if (!k) continue;
    for (const side of ["in", "out"] as const) {
      const m = sideOf(k, side);
      if (m === "constant" || m === "linear" || m === "flat" || m === "auto") continue; // only free handles are draggable
      const [hx, hy] = handleScreenPos(v, s, c, i, side);
      if (Math.hypot(hx - px, hy - py) <= radius) return { kind: "handle", index: i, side };
    }
  }
  let best = -1;
  let bd = radius;
  c.keys.forEach((k, i) => {
    const [x, y] = toScreen(v, s, k.t, k.v);
    const d = Math.hypot(x - px, y - py);
    if (d <= bd) {
      bd = d;
      best = i;
    }
  });
  return best >= 0 ? { kind: "key", index: best } : null;
}

/** Keys inside a screen-space rectangle. */
export function keysInRect(c: Curve, v: View, s: Size, x0: number, y0: number, x1: number, y1: number): number[] {
  const lx = Math.min(x0, x1);
  const hx = Math.max(x0, x1);
  const ly = Math.min(y0, y1);
  const hy = Math.max(y0, y1);
  const out: number[] = [];
  c.keys.forEach((k, i) => {
    const [x, y] = toScreen(v, s, k.t, k.v);
    if (x >= lx && x <= hx && y >= ly && y <= hy) out.push(i);
  });
  return out;
}

/** Sample the curve for drawing: screen polyline over [xStart, xEnd] px with a fixed pixel step. */
export function samplePolyline(
  c: Curve,
  v: View,
  s: Size,
  xStart: number,
  xEnd: number,
  stepPx = 2,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let x = xStart; x <= xEnd + 0.001; x += stepPx) {
    const [t] = toCurve(v, s, x, 0);
    const [, y] = toScreen(v, s, t, evaluate(c, t));
    pts.push([x, y]);
  }
  return pts;
}
