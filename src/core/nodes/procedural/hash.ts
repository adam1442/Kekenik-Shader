import type { M, V } from "./irm";

/**
 * Float-only, sine-free hashes (the "hash without sine" family by D. Hoskins, public domain) written in portable IR.
 * With `M.intHash` (node parameter Hash = Integer) every function below uses the portable integer hash `ihash` instead (O8).
 * All return values in [0, 1) (they end in `fract`), are pure functions of their inputs, and are finite for every finite input.
 * Quality is best for |input| below ~1e4; beyond ~1e6 float32 inputs have no fractional bits left and the hash degrades to a
 * few distinct values (never NaN / Inf). Noise nodes therefore wrap lattice coordinates with `LATTICE_PERIOD`.
 */
export const LATTICE_PERIOD = 4096;
export const TAU = 6.283185307179586;

/** float → float */
export function hash11(m: M, p: V): V {
  if (m.intHash) return m.fn("ihash", p);
  const a = p.mul(0.1031).fract();
  const b = a.mul(a.add(33.33));
  return b.mul(b.add(b)).fract();
}

/** vec2 → float */
export function hash21(m: M, p: V): V {
  if (m.intHash) return m.fn("ihash", p);
  const p3 = m.v3(p.x, p.y, p.x).mul(0.1031).fract();
  const q = p3.add(p3.dot(p3.sw("yzx").add(33.33)));
  return q.x.add(q.y).mul(q.z).fract();
}

/** vec2 → vec2 */
export function hash22(m: M, p: V): V {
  if (m.intHash) return m.v2(m.fn("ihash", m.v3(p.x, p.y, 1)), m.fn("ihash", m.v3(p.x, p.y, 2)));
  const p3 = m
    .v3(p.x, p.y, p.x)
    .mul(m.k("vec3", 0.1031, 0.103, 0.0973))
    .fract();
  const q = p3.add(p3.dot(p3.sw("yzx").add(33.33)));
  return q.sw("xx").add(q.sw("yz")).mul(q.sw("zy")).fract();
}

/** vec3 → float */
export function hash31(m: M, p: V): V {
  if (m.intHash) return m.fn("ihash", p);
  const p3 = p.mul(0.1031).fract();
  const q = p3.add(p3.dot(p3.sw("zyx").add(31.32)));
  return q.x.add(q.y).mul(q.z).fract();
}

/** vec3 → vec3 */
export function hash33(m: M, p: V): V {
  if (m.intHash)
    return m.v3(
      m.fn("ihash", m.v4(p.x, p.y, p.z, 1)),
      m.fn("ihash", m.v4(p.x, p.y, p.z, 2)),
      m.fn("ihash", m.v4(p.x, p.y, p.z, 3)),
    );
  const p3 = p.mul(m.k("vec3", 0.1031, 0.103, 0.0973)).fract();
  const q = p3.add(p3.dot(p3.sw("yxz").add(33.33)));
  return q.sw("xxy").add(q.sw("yxx")).mul(q.sw("zyx")).fract();
}

/** Hash of the right arity for a float / vec2 / vec3 lattice point → float. */
export function hashN(m: M, p: V): V {
  return p.ty === "float" ? hash11(m, p) : p.ty === "vec2" ? hash21(m, p) : hash31(m, p);
}

/** Lattice coordinates are reduced modulo `LATTICE_PERIOD` (floor-mod: correct for negative cells). */
export const wrapCell = (v: V): V => v.mod(LATTICE_PERIOD);

/** Seed → per-dimension offset added to wrapped lattice coordinates (seed is reduced modulo 1024). */
export function seedOffset(m: M, seed: V, dim: 1 | 2 | 3): V {
  const s = seed.mod(1024);
  if (dim === 1) return s.mul(1.37);
  if (dim === 2) return m.v2(s.mul(1.37), s.mul(2.71));
  return m.v3(s.mul(1.37), s.mul(2.71), s.mul(0.93));
}
