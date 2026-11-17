import { type M, type V } from "./irm";
import { type BasisKind, basisSigned, dimOf } from "./noise";

/**
 * Fractal sums over a signed [-1, 1] basis . Octaves are unrolled at build time (1…MAX_OCTAVES, a node parameter);
 * lacunarity / gain are runtime inputs. Amplitudes are normalised by Σ|amp| (computed in IR), so every result keeps the
 * documented range for ANY lacunarity / gain, including 0 and negative values (Σ|amp| ≥ 1: no division by zero).
 * Each octave samples the basis at p·freq + a fixed non-integer offset so octaves are decorrelated and the origin is not special.
 */
export const MAX_OCTAVES = 8;

export interface FractalCfg {
  kind: BasisKind;
  p: V;
  octaves: number;
  lacunarity: V;
  gain: V;
  so: V;
}

const octaveOffset = (m: M, i: number, dim: number): V =>
  dim === 1
    ? m.f(i * 17.13)
    : dim === 2
      ? m.k("vec2", i * 17.13, i * 31.77)
      : m.k("vec3", i * 17.13, i * 31.77, i * 7.31);

/** Octaves below this share of the total amplitude cannot change an 8-bit channel (half an LSB). */
const ADAPTIVE_CUTOFF = 0.5 / 255;

/**
 * FBM early-out ("Quality = Adaptive"): when Gain is a build-time constant, octaves whose amplitude share |gain^i| / Σ|gain^j|
 * is below half an 8-bit LSB are not emitted (the normalisation uses the kept octaves, so the range is unchanged).
 * A runtime (non-constant) gain keeps every octave — the amplitudes are unknown at build time. Always keeps ≥ 1 octave.
 */
export function adaptiveOctaves(m: M, octaves: number, gain: V): number {
  const e = m.b.body.exprs[gain.id];
  if (!e || e.op !== "const" || e.value.length !== 1 || !Number.isFinite(e.value[0]!)) return octaves;
  const g = Math.abs(e.value[0]!);
  const amps = Array.from({ length: octaves }, (_, i) => g ** i);
  const total = amps.reduce((a, b) => a + b, 0);
  let keep = 1;
  for (let i = 0; i < octaves; i++) if (amps[i]! / total >= ADAPTIVE_CUTOFF) keep = i + 1;
  return keep;
}

/** Core loop: `term(sample, weightState)` returns the octave's contribution BEFORE multiplication by amp. */
function accumulate(m: M, c: FractalCfg, term: (s: V, state: { weight: V }) => { value: V; weight: V }): V {
  const dim = dimOf(c.p);
  let freq: V = m.f(1);
  let amp: V = m.f(1);
  let sum: V | null = null;
  let norm: V | null = null;
  let weight: V = m.f(1);
  for (let i = 0; i < c.octaves; i++) {
    const s = basisSigned(c.kind, m, c.p.mul(freq).add(octaveOffset(m, i, dim)), c.so);
    const t = term(s, { weight });
    weight = t.weight;
    const contribution = t.value.mul(amp);
    sum = sum ? sum.add(contribution) : contribution;
    norm = norm ? norm.add(amp.abs()) : amp.abs();
    freq = freq.mul(c.lacunarity);
    amp = amp.mul(c.gain);
  }
  return sum!.div(norm!);
}

/** fBm: Σ amp·n. Range [-1, 1]. */
export const fbm = (m: M, c: FractalCfg): V => accumulate(m, c, (s, st) => ({ value: s, weight: st.weight }));

/** Turbulence: Σ amp·|n|. Range [0, 1]. */
export const turbulence = (m: M, c: FractalCfg): V =>
  accumulate(m, c, (s, st) => ({ value: s.abs(), weight: st.weight }));

/** Ridged multifractal (Musgrave): signal = (offset − |n|)²·weight, weight = clamp(signal·sharpness, 0, 1). Range [0, 1] for offset ∈ [0, 1]. */
export const ridged = (m: M, c: FractalCfg, offset: V, sharpness: V): V =>
  accumulate(m, c, (s, st) => {
    const d = offset.sub(s.abs());
    const signal = d.mul(d).mul(st.weight);
    return { value: signal, weight: signal.mul(sharpness).clamp(0, 1) };
  });

/** Decorrelation offsets for the warp axes (fixed constants). */
const WARP_OFFSETS = [
  [5.2, 1.3, 7.7],
  [1.7, 9.2, 3.1],
  [8.3, 2.8, 4.9],
];

/** Domain warp: q ← p + strength · (n(q·scale + o₀), n(q·scale + o₁)[, n(·+ o₂)]), repeated `iterations` times from the ORIGINAL p. */
export function warp(m: M, p: V, kind: BasisKind, scale: V, strength: V, so: V, iterations: number): V {
  const dim = dimOf(p);
  if (dim === 1) throw new Error("Domain warp needs a 2D or 3D coordinate");
  let q = p;
  for (let it = 0; it < iterations; it++) {
    const base = q.mul(scale);
    const comps = WARP_OFFSETS.slice(0, dim).map((o) =>
      basisSigned(kind, m, base.add(dim === 2 ? m.k("vec2", o[0]!, o[1]!) : m.k("vec3", o[0]!, o[1]!, o[2]!)), so),
    );
    q = p.add((dim === 2 ? m.v2(comps[0]!, comps[1]!) : m.v3(comps[0]!, comps[1]!, comps[2]!)).mul(strength));
  }
  return q;
}

/** 2D curl of the scalar potential ψ(p) = basis(p·scale): (∂ψ/∂y, −∂ψ/∂x) by central differences with step max(eps, 1e-6). Divergence-free by construction (up to FD error). */
export function curl2D(m: M, p: V, kind: BasisKind, scale: V, eps: V, so: V): V {
  const e = eps.max(1e-6);
  const psi = (pp: V) => basisSigned(kind, m, pp.mul(scale), so);
  const ex = m.v2(e, 0);
  const ey = m.v2(0, e);
  const inv = m.f(0.5).div(e);
  const dx = psi(p.add(ex))
    .sub(psi(p.sub(ex)))
    .mul(inv);
  const dy = psi(p.add(ey))
    .sub(psi(p.sub(ey)))
    .mul(inv);
  return m.v2(dy, dx.neg());
}
