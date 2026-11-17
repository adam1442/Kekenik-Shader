import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { baseNode, enumParam } from "../kit";
import { hash11, hash21, hash22, hash31, hash33, seedOffset } from "./hash";
import { HASH_PARAM, hashM } from "./hashMode";
import { M } from "./irm";
import { type BasisKind, basisSigned, valueNoise } from "./noise";
import { DIM_OPTIONS_123, type Dim, coordPort, floatPort, outPort, parseDim, ports } from "./ports";

const CAT = "Procedural/Noise";
export const RANGE_PARAM = enumParam(
  "range",
  "Range",
  [
    ["unit", "0 … 1"],
    ["signed", "−1 … 1"],
  ],
  "unit",
);

interface Spec {
  id: string;
  name: string;
  synonyms: string[];
  description: string;
  kind: BasisKind;
  dims: Array<[string, string]>;
  defaultDim: string;
}

function noiseNode(s: Spec): NodeDef {
  const portsFor = (d: Dim) =>
    ports(
      [
        coordPort(d),
        floatPort("scale", "Scale", 5, "Frequency: lattice cells per unit of P."),
        floatPort("seed", "Seed", 0, "Any float; reduced modulo 1024."),
      ],
      [outPort("out", "Out", "float")],
    );
  const base = portsFor(parseDim(s.defaultDim));
  return baseNode({
    id: s.id,
    category: CAT,
    name: s.name,
    synonyms: s.synonyms,
    description: s.description,
    inputs: base.inputs,
    outputs: base.outputs,
    params: [enumParam("dimension", "Dimension", s.dims, s.defaultDim), RANGE_PARAM, HASH_PARAM],
    dynamicPorts: (node) => portsFor(parseDim(node.params.dimension, parseDim(s.defaultDim))),
    targetNotes: {
      all: "Portable IR math only (floor / fract / mix / mod); identical algorithm on every target. Lattice repeats every 4096 cells.",
    },
    build: (c) => {
      const m = hashM(c);
      const dim = parseDim(c.param("dimension"), parseDim(s.defaultDim));
      const q = m.w(c.in("p")).mul(m.w(c.in("scale")));
      const so = seedOffset(m, m.w(c.in("seed")), dim);
      const unit = c.param("range") !== "signed";
      if (s.kind === "value" && unit) return { out: valueNoise(m, q, so).id };
      const v = basisSigned(s.kind, m, q, so);
      return { out: (unit ? v.mul(0.5).add(0.5) : v).id };
    },
  });
}

export const valueNoiseNode = noiseNode({
  id: "noiseValue",
  name: "Value Noise",
  kind: "value",
  dims: DIM_OPTIONS_123,
  defaultDim: "2",
  synonyms: ["value noise", "lattice noise", "blocky noise"],
  description:
    "Smoothly interpolated hashed lattice values (quintic fade, C2-continuous). Range: 0 … 1 (exclusive of 1), or −1 … 1 with Range = signed. 1D / 2D / 3D. Deterministic; negative and huge coordinates are wrapped per lattice corner (period 4096 cells).",
});
export const gradientNoiseNode = noiseNode({
  id: "noiseGradient",
  name: "Gradient Noise",
  kind: "perlin",
  dims: DIM_OPTIONS_123,
  defaultDim: "2",
  synonyms: ["perlin", "perlin noise", "classic noise", "gradient noise"],
  description:
    "Classic gradient (Perlin) noise with quintic fade and random unit gradients. Guaranteed range −1 … 1 (raw ±√N/2 rescaled), mapped to 0 … 1 by default (Range = unit). 1D / 2D / 3D.",
});
export const simplexNoiseNode = noiseNode({
  id: "noiseSimplex",
  name: "Simplex Noise",
  kind: "simplex",
  dims: DIM_OPTIONS_123,
  defaultDim: "2",
  synonyms: ["simplex", "simplex noise", "open simplex"],
  description:
    "Simplex-grid gradient noise (radial kernel (r²−|x|²)⁴, unit gradients). Range −1 … 1 (normalisation constant verified so the supremum stays ≤ 1), 0 … 1 by default. 1D / 2D / 3D (1D: two-point simplex segment with the (1 − x²)⁴ kernel).",
});

/* ── hashes ───────────────────────────────────────────────────────────────────────────────────── */
type HashFn = (m: M, p: import("./irm").V) => import("./irm").V;
function hashNode(
  id: string,
  name: string,
  inT: "float" | "vec2" | "vec3",
  outT: "float" | "vec2" | "vec3",
  fn: HashFn,
  synonyms: string[],
  def: number,
): NodeDef {
  return baseNode({
    id,
    category: CAT,
    name,
    synonyms,
    description: `Deterministic sine-free hash ${inT} → ${outT}. Output components are in [0, 1). Pure function of the input (no time, no hidden state); finite for every finite input. Input precision: best for |x| < 1e4, degrades gracefully (never NaN/Inf) for huge values.`,
    inputs: [{ id: "in", name: "In", type: T(inT), default: def }],
    outputs: [outPort("out", "Out", outT)],
    targetNotes: {
      all: "Hash = Legacy: float-only arithmetic (fract / dot / mul), no integer bit operations. Hash = Integer: PCG on uint (GLSL ES 3.00 uint, HLSL uint, WGSL u32, Godot uint) — bit-identical on every GPU.",
    },
    params: [HASH_PARAM],
    build: (c) => {
      const m = hashM(c);
      return { out: fn(m, m.w(c.in("in"))).id };
    },
  });
}
export const hashNodes: NodeDef[] = [
  hashNode("hash1to1", "Hash 1 → 1", "float", "float", hash11, ["random", "rand", "white noise", "hash float"], 1.5),
  hashNode("hash2to1", "Hash 2 → 1", "vec2", "float", hash21, ["random vec2", "hash2d", "white noise 2d"], 1.5),
  hashNode(
    "hash2to2",
    "Hash 2 → 2",
    "vec2",
    "vec2",
    hash22,
    ["random vec2 to vec2", "random direction", "hash vec2"],
    1.5,
  ),
  hashNode("hash3to1", "Hash 3 → 1", "vec3", "float", hash31, ["random vec3", "hash3d", "white noise 3d"], 1.5),
  hashNode("hash3to3", "Hash 3 → 3", "vec3", "vec3", hash33, ["random vec3 to vec3", "hash vec3", "random color"], 1.5),
];
