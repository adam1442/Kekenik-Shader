import type { HelperDef } from "./helpers";

/**
 * On-demand helpers of the portable integer hash (`ihash` intrinsic, O8; specification + CPU reference in `ir/ihash.ts`).
 * One non-overloaded helper per arity (`ks_ihash1…4`) because WGSL and Godot have no function overloading.
 */
interface CLang {
  u: string;
  f: string;
  bits: string;
  vec: (n: 2 | 3 | 4) => string;
  comment: string;
}

function cHelpers(l: CLang): HelperDef[] {
  const sig = (n: 1 | 2 | 3 | 4): string => (n === 1 ? "float x" : `${l.vec(n)} p`);
  const comp = (n: number, i: number): string => (n === 1 ? "x" : `p.${"xyzw"[i]}`);
  const body = (n: 1 | 2 | 3 | 4): string => {
    const lines = [`${l.u} h = ks_pcg(ks_fbits(${comp(n, 0)}));`];
    for (let i = 1; i < n; i++) lines.push(`h = ks_pcg(h ^ ks_fbits(${comp(n, i)}));`);
    return `${l.f} ks_ihash${n}(${sig(n)}) { ${lines.join(" ")} return ks_hfin(h); }`;
  };
  return [
    {
      id: "ks_pcg",
      code: [
        `${l.comment} Portable integer hash (PCG-RXS-M-XS on the float bit pattern, Kekenik Shader): uint-only arithmetic => bit-identical on every GPU.`,
        `${l.u} ks_pcg(${l.u} v) { ${l.u} s = v * 747796405u + 2891336453u; ${l.u} w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }`,
        `${l.u} ks_fbits(float x) { return x == 0.0 ? 0u : ${l.bits}(x); }`,
        `${l.f} ks_hfin(${l.u} h) { return float(h >> 8u) * 5.9604644775390625e-8; }`,
      ].join("\n"),
    },
    ...([1, 2, 3, 4] as const).map((n): HelperDef => ({ id: `ks_ihash${n}`, deps: ["ks_pcg"], code: body(n) })),
  ];
}

export const GLSL_IHASH_HELPERS: readonly HelperDef[] = cHelpers({
  u: "highp uint",
  f: "highp float",
  bits: "floatBitsToUint",
  vec: (n) => `vec${n}`,
  comment: "//",
});
export const GODOT_IHASH_HELPERS: readonly HelperDef[] = cHelpers({
  u: "uint",
  f: "float",
  bits: "floatBitsToUint",
  vec: (n) => `vec${n}`,
  comment: "//",
});
export const HLSL_IHASH_HELPERS: readonly HelperDef[] = cHelpers({
  u: "uint",
  f: "float",
  bits: "asuint",
  vec: (n) => `float${n}`,
  comment: "//",
});

const W = { 1: "f32", 2: "vec2<f32>", 3: "vec3<f32>", 4: "vec4<f32>" } as const;
const wgslBody = (n: 1 | 2 | 3 | 4): string => {
  const c = (i: number): string => (n === 1 ? "x" : `p.${"xyzw"[i]}`);
  const lines = [`var h = ks_pcg(ks_fbits(${c(0)}));`];
  for (let i = 1; i < n; i++) lines.push(`h = ks_pcg(h ^ ks_fbits(${c(i)}));`);
  return `fn ks_ihash_${n === 1 ? "f32" : `vec${n}`}(${n === 1 ? "x" : "p"}: ${W[n]}) -> f32 { ${lines.join(" ")} return ks_hfin(h); }`;
};
/** WGSL spelling: ids `ks_ihash_f32` / `ks_ihash_vec2…4` (see wgsl/dialect.ts). */
export const WGSL_IHASH_HELPERS: readonly HelperDef[] = [
  {
    id: "ks_pcg",
    code: [
      "// Portable integer hash (PCG-RXS-M-XS on the float bit pattern, Kekenik Shader): u32-only arithmetic => bit-identical on every GPU.",
      "fn ks_pcg(v: u32) -> u32 { let s = v * 747796405u + 2891336453u; let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }",
      "fn ks_fbits(x: f32) -> u32 { return select(bitcast<u32>(x), 0u, x == 0.0); }",
      "fn ks_hfin(h: u32) -> f32 { return f32(h >> 8u) * 5.9604644775390625e-8; }",
    ].join("\n"),
  },
  ...([1, 2, 3, 4] as const).map((n): HelperDef => ({
    id: `ks_ihash_${n === 1 ? "f32" : `vec${n}`}`,
    deps: ["ks_pcg"],
    code: wgslBody(n),
  })),
];
