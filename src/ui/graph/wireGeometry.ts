import type { Pt, Rect } from "./viewport";

/** Cubic bezier of a wire: p0 = output port, p3 = input port. Pure geometry (no DOM). */
export interface Bezier {
  p0: Pt;
  p1: Pt;
  p2: Pt;
  p3: Pt;
}

/**
 * Adaptive tension: handles scale with the horizontal distance (long wires get long, gentle handles),
 * but never collapse (short wires keep a visible S-curve) and grow when the wire has to loop backwards.
 */
function handleLength(dx: number, dy: number): number {
  if (dx >= 0) return Math.min(220, Math.max(36, dx * 0.5));
  return Math.min(300, 80 + -dx * 0.35 + Math.abs(dy) * 0.12);
}

export type WireMode = "bezier" | "orthogonal" | "straight";
let wireMode: WireMode = "bezier";
/** Preferences → wire style. "orthogonal" is a rounded stepped curve (a cubic cannot make true right angles). */
export const setWireMode = (m: WireMode): void => {
  wireMode = m;
};
export const getWireMode = (): WireMode => wireMode;

export function wireBezier(a: Pt, b: Pt): Bezier {
  if (wireMode === "straight")
    return {
      p0: a,
      p1: { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
      p2: { x: a.x + ((b.x - a.x) * 2) / 3, y: a.y + ((b.y - a.y) * 2) / 3 },
      p3: b,
    };
  if (wireMode === "orthogonal" && b.x - a.x > 24) {
    const k = (b.x - a.x) * 0.92;
    return { p0: a, p1: { x: a.x + k, y: a.y }, p2: { x: b.x - k, y: b.y }, p3: b };
  }
  const h = handleLength(b.x - a.x, b.y - a.y);
  return { p0: a, p1: { x: a.x + h, y: a.y }, p2: { x: b.x - h, y: b.y }, p3: b };
}

function bezierAt(z: Bezier, t: number): Pt {
  const u = 1 - t;
  const w0 = u * u * u,
    w1 = 3 * u * u * t,
    w2 = 3 * u * t * t,
    w3 = t * t * t;
  return {
    x: w0 * z.p0.x + w1 * z.p1.x + w2 * z.p2.x + w3 * z.p3.x,
    y: w0 * z.p0.y + w1 * z.p1.y + w2 * z.p2.y + w3 * z.p3.y,
  };
}

const r2 = (n: number): string => (Math.round(n * 100) / 100).toString();
/** SVG / Path2D string. */
export const bezierPathD = (z: Bezier): string =>
  `M${r2(z.p0.x)} ${r2(z.p0.y)}C${r2(z.p1.x)} ${r2(z.p1.y)} ${r2(z.p2.x)} ${r2(z.p2.y)} ${r2(z.p3.x)} ${r2(z.p3.y)}`;

/** Conservative bounds (control-point hull; cheap, used for culling and as a hit-test pre-filter). */
export function bezierBounds(z: Bezier): Rect {
  const xs = [z.p0.x, z.p1.x, z.p2.x, z.p3.x],
    ys = [z.p0.y, z.p1.y, z.p2.y, z.p3.y];
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Distance from `p` to the curve (sampled) and the parameter of the closest sample. */
export function distanceToBezier(z: Bezier, p: Pt, steps = 28): { dist: number; t: number } {
  let best = Infinity,
    bt = 0;
  let prev = z.p0;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const cur = bezierAt(z, t);
    const d = distToSegment(p, prev, cur);
    if (d.dist < best) {
      best = d.dist;
      bt = (i - 1 + d.u) / steps;
    }
    prev = cur;
  }
  return { dist: best, t: bt };
}

function distToSegment(p: Pt, a: Pt, b: Pt): { dist: number; u: number } {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { dist: Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy)), u };
}

/** Rough arc length (for dash animation / label placement). */
export function bezierLength(z: Bezier, steps = 16): number {
  let len = 0,
    prev = z.p0;
  for (let i = 1; i <= steps; i++) {
    const c = bezierAt(z, i / steps);
    len += Math.hypot(c.x - prev.x, c.y - prev.y);
    prev = c;
  }
  return len;
}

export const bezierMid = (z: Bezier): Pt => bezierAt(z, 0.5);
