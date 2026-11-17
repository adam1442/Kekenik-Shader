import { TAU, hash11, hash21, hash31, hash33, wrapCell } from "./hash";
import type { M, V } from "./irm";

/**
 * Lattice noise bases in portable IR. `p` is a float (1D), vec2 (2D) or vec3 (3D) ALREADY multiplied by the frequency;
 * `so` is the seed offset (same type as `p`, see `seedOffset`). Lattice corner coordinates are wrapped modulo
 * LATTICE_PERIOD *per corner*, so the field is continuous everywhere and repeats every LATTICE_PERIOD cells.
 *
 * Output ranges (guaranteed bounds, verified by 08a.noise.range-*):
 *   valueNoise   [0, 1)
 *   perlin       [-1, 1]   (raw classic range ±√N/2, rescaled by 2/√N)
 *   simplex      [-1, 1]   (rescaled by a constant measured to make the supremum ≤ 1, see SIMPLEX_SCALE)
 */
export type BasisKind = "value" | "perlin" | "simplex";

/** Simplex normalisation constants (sup |raw| over a dense sample is divided out; verified ≤ 1 by tests). */
const SIMPLEX_SCALE = { 1: 3.16, 2: 98.5, 3: 40 } as const;

const quintic = (f: V): V =>
  f
    .mul(f)
    .mul(f)
    .mul(f.mul(f.mul(6).sub(15)).add(10));

type Dim = 1 | 2 | 3;
export const dimOf = (p: V): Dim => (p.ty === "float" ? 1 : p.ty === "vec2" ? 2 : 3);

const corners = (m: M, dim: Dim): V[] => {
  const list: number[][] =
    dim === 1
      ? [[0], [1]]
      : dim === 2
        ? [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ]
        : [
            [0, 0, 0],
            [1, 0, 0],
            [0, 1, 0],
            [1, 1, 0],
            [0, 0, 1],
            [1, 0, 1],
            [0, 1, 1],
            [1, 1, 1],
          ];
  return list.map((c) => (dim === 1 ? m.f(c[0]!) : m.k(dim === 2 ? "vec2" : "vec3", ...c)));
};

/** Multilinear blend of 2^dim corner values (ordered x fastest) with per-axis weights `u`. */
function blend(vals: V[], u: V, dim: Dim): V {
  const ux = dim === 1 ? u : u.x;
  if (dim === 1) return vals[0]!.mix(vals[1]!, ux);
  const row = (a: V, b: V) => a.mix(b, ux);
  if (dim === 2) return row(vals[0]!, vals[1]!).mix(row(vals[2]!, vals[3]!), u.y);
  const z0 = row(vals[0]!, vals[1]!).mix(row(vals[2]!, vals[3]!), u.y);
  const z1 = row(vals[4]!, vals[5]!).mix(row(vals[6]!, vals[7]!), u.y);
  return z0.mix(z1, u.z);
}

/** Value noise: smooth (quintic) interpolation of hashed lattice values. Range [0, 1). */
export function valueNoise(m: M, p: V, so: V): V {
  const dim = dimOf(p);
  const i = p.floor();
  const u = quintic(p.sub(i));
  const vals = corners(m, dim).map((c) => {
    const cell = wrapCell(i.add(c)).add(so);
    return dim === 1 ? hash11(m, cell) : dim === 2 ? hash21(m, cell) : hash31(m, cell);
  });
  return blend(vals, u, dim);
}

/** Unit gradient of a lattice point (random angle in 2D, uniform on the sphere in 3D, ±1 in 1D). */
function gradient(m: M, cell: V, dim: Dim): V {
  if (dim === 1) return hash11(m, cell).mul(2).sub(1);
  if (dim === 2) {
    const a = hash21(m, cell).mul(TAU);
    return m.v2(a.cos(), a.sin());
  }
  const h = hash33(m, cell);
  const z = h.x.mul(2).sub(1);
  const phi = h.y.mul(TAU);
  const r = m.fn("max", m.f(1).sub(z.mul(z)), 0).sqrt();
  return m.v3(r.mul(phi.cos()), r.mul(phi.sin()), z);
}

/** Gradient ("Perlin") noise with quintic fade. Range [-1, 1] (raw bound ±√N/2 rescaled by 2/√N). */
function perlin(m: M, p: V, so: V): V {
  const dim = dimOf(p);
  const i = p.floor();
  const f = p.sub(i);
  const u = quintic(f);
  const vals = corners(m, dim).map((c) => {
    const g = gradient(m, wrapCell(i.add(c)).add(so), dim);
    const d = f.sub(c);
    return dim === 1 ? g.mul(d) : g.dot(d);
  });
  return blend(vals, u, dim).mul(2 / Math.sqrt(dim));
}

/**
 * 1D simplex: the "simplex" of a line is a segment, two lattice points with the radial kernel (1 − x²)⁴ and unit gradients.
 * sup |raw| = 0.31640625 (exhaustive scan over x and the four gradient sign combinations), SIMPLEX_SCALE[1] = 3.16 keeps the supremum ≤ 1.
 */
function simplex1D(m: M, p: V, so: V): V {
  const i = p.floor();
  const x0 = p.sub(i);
  const term = (cell: V, x: V): V => {
    const t = m.max(m.f(1).sub(x.mul(x)), 0);
    const t2 = t.mul(t);
    return t2
      .mul(t2)
      .mul(gradient(m, wrapCell(cell).add(so), 1))
      .mul(x);
  };
  return term(i, x0)
    .add(term(i.add(1), x0.sub(1)))
    .mul(SIMPLEX_SCALE[1]);
}

/** Simplex noise (1D, 2D and 3D). Range [-1, 1]. */
function simplex(m: M, p: V, so: V): V {
  const dim = dimOf(p);
  if (dim === 1) return simplex1D(m, p, so);
  const F = dim === 2 ? 0.3660254037844386 : 1 / 3;
  const G = dim === 2 ? 0.21132486540518713 : 1 / 6;
  const ty = dim === 2 ? "vec2" : "vec3";
  const sum = dim === 2 ? p.x.add(p.y) : p.x.add(p.y).add(p.z);
  const i = p.add(sum.mul(F)).floor();
  const isum = dim === 2 ? i.x.add(i.y) : i.x.add(i.y).add(i.z);
  const x0 = p.sub(i).add(isum.mul(G));
  let offs: V[];
  if (dim === 2) {
    const i1x = m.step(x0.y, x0.x);
    offs = [m.k(ty, 0, 0), m.v2(i1x, m.f(1).sub(i1x)), m.k(ty, 1, 1)];
  } else {
    const g = m.step(x0.sw("yzx"), x0);
    const l = m.f(1).sub(g);
    offs = [m.k(ty, 0, 0, 0), m.min(g, l.sw("zxy")), m.max(g, l.sw("zxy")), m.k(ty, 1, 1, 1)];
  }
  const radius = dim === 2 ? 0.5 : 0.6;
  let acc: V | null = null;
  offs.forEach((o, k) => {
    const x = x0.sub(o).add(k * G);
    const g = gradient(m, wrapCell(i.add(o)).add(so), dim);
    const t = m.max(m.f(radius).sub(x.dot(x)), 0);
    const t2 = t.mul(t);
    const term = t2.mul(t2).mul(g.dot(x));
    acc = acc ? acc.add(term) : term;
  });
  return acc!.mul(SIMPLEX_SCALE[dim]);
}

/** Any basis mapped to the signed range [-1, 1] (value noise: 2v − 1). */
export function basisSigned(kind: BasisKind, m: M, p: V, so: V): V {
  if (kind === "value") return valueNoise(m, p, so).mul(2).sub(1);
  return kind === "perlin" ? perlin(m, p, so) : simplex(m, p, so);
}
