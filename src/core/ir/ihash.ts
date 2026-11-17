/**
 * Portable INTEGER hash — the CPU reference of the `ihash` intrinsic and the specification every backend helper follows.
 *
 * Why: the legacy float hashes ("hash without sine") depend on how a GPU rounds `fract(x * 0.1031)`; patterns differ between vendors.
 * `ihash` only uses 32-bit unsigned integer arithmetic (wrapping multiply / add, xor, shifts) and a bit-cast of the float operands, all of
 * which are exactly specified by GLSL ES 3.00, HLSL, WGSL and Godot ⇒ BIT-IDENTICAL results on every target and GPU.
 *
 *   pcg(v)    = { s = v·747796405 + 2891336453;  w = ((s >> ((s >> 28) + 4)) ^ s) · 277803737;  return (w >> 22) ^ w }   (PCG-RXS-M-XS, O'Neill)
 *   bits(x)   = x == 0 ? 0 : floatBitsToUint(x)                       (−0 and +0 hash alike)
 *   ihash(c₀…cₙ) = float(pcg(…pcg(pcg(bits(c₀)) ^ bits(c₁))… ^ bits(cₙ)) >> 8) · 2⁻²⁴        ∈ [0, 1), exactly representable
 */
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** `floatBitsToUint` of the float32 nearest to `x`, with ±0 collapsed to 0. */
function floatBits(x: number): number {
  f32[0] = x;
  return x === 0 || u32[0] === 0x80000000 ? 0 : u32[0]!;
}

/** One PCG-RXS-M-XS round on a uint32 (wrapping arithmetic through Math.imul). */
function pcg(v: number): number {
  const s = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return ((w >>> 22) ^ w) >>> 0;
}

/** Raw 32-bit hash of 1–4 float components. */
function ihashBits(comps: readonly number[]): number {
  let h = pcg(floatBits(comps[0]!));
  for (let i = 1; i < comps.length; i++) h = pcg((h ^ floatBits(comps[i]!)) >>> 0);
  return h;
}

/** The `ihash` intrinsic: float / vec2 / vec3 / vec4 → float in [0, 1). */
export const ihash = (comps: readonly number[]): number => (ihashBits(comps) >>> 8) * 5.9604644775390625e-8;

/** Largest value `ihash` can return (2²⁴−1)·2⁻²⁴. */
export const IHASH_MAX = 16777215 * 5.9604644775390625e-8;
