import type { M, V } from "./irm";

/**
 * 2D signed-distance functions in portable IR .
 * Conventions (all shape nodes): coordinates are in the units of P (UV by default); the shape is defined in a LOCAL frame
 * centred at `center` and rotated COUNTER-CLOCKWISE by `rotation` degrees (V up). Signed distance: NEGATIVE inside, 0 on the
 * boundary, POSITIVE outside. Rect / Rounded Rect / Ring / Segment / Polygon / Star return the exact Euclidean distance
 * (Polygon / Star: exact up to IQ's analytic formulation); Ellipse is a first-order approximation whose zero set is exact.
 */
const DEG2RAD = Math.PI / 180;
const MIN_SIZE = 1e-6;

/** p → local frame (translate to `center`, rotate the point by −rotation so the shape appears rotated by +rotation). */
export function localSpace(m: M, p: V, center: V, rotationDeg: V): V {
  const d = p.sub(center);
  const a = rotationDeg.mul(DEG2RAD);
  const c = a.cos();
  const s = a.sin();
  return m.v2(c.mul(d.x).add(s.mul(d.y)), c.mul(d.y).sub(s.mul(d.x)));
}

export function sdRect(m: M, q: V, half: V): V {
  const d = q.abs().sub(half);
  return m
    .max(d, 0)
    .length()
    .add(m.min(m.max(d.x, d.y), 0));
}

/** Corner radii order: (top-right, bottom-right, top-left, bottom-left), V up. Radii are clamped to [0, min(half)] (documented semantics). */
export function sdRoundRect(m: M, q: V, half: V, radii: V): V {
  const rr = radii.clamp(0, m.min(half.x, half.y));
  const rxy = m.sel(q.x.gt(0), rr.sw("xy"), rr.sw("zw"));
  const r = m.sel(q.y.gt(0), rxy.x, rxy.y);
  const d = q.abs().sub(half).add(r);
  return m.min(m.max(d.x, d.y), 0).add(m.max(d, 0).length()).sub(r);
}

/** Ellipse: k0(k0−1)/k1 (I. Quilez). Exact zero set, inside < 0; radii below MIN_SIZE are raised to MIN_SIZE. */
export function sdEllipse(m: M, q: V, radii: V): V {
  const r = radii.abs().max(MIN_SIZE);
  const k0 = q.div(r).length();
  const k1 = q.div(r.mul(r)).length();
  const centre = m.f(0).sub(m.min(r.x, r.y));
  return m.sel(k1.gt(1e-12), k0.mul(k0.sub(1)).div(m.max(k1, 1e-12)), centre);
}

export function sdRing(_m: M, q: V, radius: V, thickness: V): V {
  return q.length().sub(radius).abs().sub(thickness.mul(0.5));
}

/** Capsule: distance to segment a→b minus thickness/2. a == b is a circle (no division by zero). */
export function sdSegment(m: M, p: V, a: V, b: V, thickness: V): V {
  const pa = p.sub(a);
  const ba = b.sub(a);
  const h = pa
    .dot(ba)
    .div(m.max(ba.dot(ba), 1e-20))
    .clamp(0, 1);
  return pa.sub(ba.mul(h)).length().sub(thickness.mul(0.5));
}

/** Folds the plane into one polygon wedge: returns the local point (x along the apothem, y ≥ 0). Vertex 0 points +Y. */
function fold(m: M, q: V, an: number): V {
  const bn = m
    .atan2(q.x, q.y)
    .mod(2 * an)
    .sub(an);
  return m.v2(bn.cos(), bn.sin().abs()).mul(q.length());
}

/** Regular n-gon with circumradius `r` (n ≥ 3 integer). Vertex 0 points up (+Y). */
export function sdPolygon(m: M, q: V, r: V, n: number): V {
  const an = Math.PI / n;
  const acs = m.k("vec2", Math.cos(an), Math.sin(an));
  let pp = fold(m, q, an).sub(acs.mul(r));
  pp = m.v2(pp.x, pp.y.add(m.fn("clamp", pp.y.neg(), 0, r.mul(Math.sin(an)))));
  return pp.length().mul(m.fn("sign", pp.x));
}

/** n-pointed star, circumradius `r`; `mm` ∈ [2, n] is the sharpness (2 = regular polygon, n = thinnest points). Vertex 0 points up. */
export function sdStar(m: M, q: V, r: V, n: number, mm: V): V {
  const an = Math.PI / n;
  const en = m.f(Math.PI).div(mm.clamp(2, n));
  const acs = m.k("vec2", Math.cos(an), Math.sin(an));
  const ecs = m.v2(en.cos(), en.sin());
  let pp = fold(m, q, an).sub(acs.mul(r));
  pp = pp.add(ecs.mul(m.fn("clamp", ecs.dot(pp).neg(), 0, r.mul(Math.sin(an)).div(ecs.y))));
  return pp.length().mul(m.fn("sign", pp.x));
}

/** Polynomial smooth minimum (k = blend width in distance units; k < 1e-6 behaves as a hard min). */
export function smoothMin(m: M, a: V, b: V, k: V): V {
  const kk = k.max(1e-6);
  const h = b.sub(a).div(kk).mul(0.5).add(0.5).saturate();
  return b.mix(a, h).sub(kk.mul(h).mul(m.f(1).sub(h)));
}

/** Polynomial smooth maximum = −smoothMin(−a, −b): the smooth counterpart of `max` (intersection / subtraction). */
export function smoothMax(m: M, a: V, b: V, k: V): V {
  return smoothMin(m, a.neg(), b.neg(), k).neg();
}
