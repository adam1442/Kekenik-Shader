import type { BuildContext, NodeDef, ParamSchema, PortDef, ResolvedPorts } from "../../registry/nodeDef";
import { baseNode, enumParam } from "../kit";
import { type FractalCfg, MAX_OCTAVES, adaptiveOctaves, curl2D, fbm, ridged, turbulence, warp } from "./fractal";
import { seedOffset } from "./hash";
import { HASH_PARAM, hashM } from "./hashMode";
import type { M, V } from "./irm";
import type { BasisKind } from "./noise";
import { DIM_OPTIONS_23, type Dim, coordPort, floatPort, outPort, parseDim, ports } from "./ports";
import { RANGE_PARAM } from "./noiseNodes";

const CAT = "Procedural/Noise";
const BASIS_PARAM = enumParam(
  "basis",
  "Basis noise",
  [
    ["value", "Value"],
    ["perlin", "Gradient (Perlin)"],
    ["simplex", "Simplex"],
  ],
  "perlin",
);
const DIM_PARAM = enumParam("dimension", "Dimension", DIM_OPTIONS_23, "2");
const OCT_PARAM: ParamSchema = {
  id: "octaves",
  label: "Octaves",
  control: "int",
  default: 4,
  min: 1,
  max: MAX_OCTAVES,
  step: 1,
  tooltip: `1 … ${MAX_OCTAVES} (unrolled at build time).`,
};
const QUALITY_PARAM: ParamSchema = {
  ...enumParam(
    "quality",
    "Quality",
    [
      ["full", "Full (all octaves)"],
      ["adaptive", "Adaptive (early-out)"],
    ],
    "full",
  ),
  tooltip:
    "Adaptive: when Gain is a constant, octaves too weak to change an 8-bit channel are not generated (cheaper, visually identical at 8 bit). Full keeps every octave.",
};
const NOTE = {
  all: "Portable IR; octaves are unrolled (code size grows linearly with Octaves). Basis lattice repeats every 4096 cells.",
};
const dimOfNode = (v: unknown): Dim => parseDim(v, 2);
const basisOf = (c: BuildContext): BasisKind => c.param<string>("basis") as BasisKind;

function octaves(c: BuildContext): number {
  const n = Number(c.param("octaves"));
  if (!Number.isInteger(n) || n < 1 || n > MAX_OCTAVES)
    c.fail(`Octaves must be an integer from 1 to ${MAX_OCTAVES} (got ${String(c.param("octaves"))}).`);
  return n;
}
const effectiveOctaves = (c: BuildContext, m: M, gain: V): number =>
  c.param("quality") === "adaptive" ? adaptiveOctaves(m, octaves(c), gain) : octaves(c);

const fractalInputs = (d: Dim, extra: PortDef[]): PortDef[] => [
  coordPort(d),
  floatPort("scale", "Scale", 4, "Base frequency."),
  floatPort("lacunarity", "Lacunarity", 2, "Frequency multiplier per octave."),
  floatPort("gain", "Gain", 0.5, "Amplitude multiplier per octave (persistence)."),
  ...extra,
  floatPort("seed", "Seed", 0, "Any float; reduced modulo 1024."),
];

function cfgOf(c: BuildContext, m: M): { cfg: FractalCfg; dim: Dim } {
  const dim = dimOfNode(c.param("dimension"));
  const so = seedOffset(m, m.w(c.in("seed")), dim);
  const gain = m.w(c.in("gain"));
  return {
    dim,
    cfg: {
      kind: basisOf(c),
      p: m.w(c.in("p")).mul(m.w(c.in("scale"))),
      octaves: effectiveOctaves(c, m, gain),
      lacunarity: m.w(c.in("lacunarity")),
      gain,
      so,
    },
  };
}

function fractalNode(
  id: string,
  name: string,
  synonyms: string[],
  description: string,
  extra: PortDef[],
  params: ParamSchema[],
  run: (m: M, cfg: FractalCfg, c: BuildContext) => V,
): NodeDef {
  const portsFor = (d: Dim): ResolvedPorts => ports(fractalInputs(d, extra), [outPort("out", "Out", "float")]);
  const base = portsFor(2);
  return baseNode({
    id,
    category: CAT,
    name,
    synonyms,
    description,
    inputs: base.inputs,
    outputs: base.outputs,
    params: [DIM_PARAM, BASIS_PARAM, OCT_PARAM, QUALITY_PARAM, ...params, HASH_PARAM],
    dynamicPorts: (node) => portsFor(dimOfNode(node.params.dimension)),
    targetNotes: NOTE,
    build: (c) => {
      const m = hashM(c);
      return { out: run(m, cfgOf(c, m).cfg, c).id };
    },
  });
}

export const fbmNode = fractalNode(
  "noiseFbm",
  "FBM",
  ["fbm", "fractal brownian motion", "fractal noise", "octaves"],
  "Fractional Brownian motion: Σ gainⁱ · noise(p · lacunarityⁱ), normalised by Σ|gainⁱ| so the result stays inside the basis range for any gain / lacunarity. Range: 0 … 1 (default) or −1 … 1 (Range = signed). Octaves 1 … 8.",
  [],
  [RANGE_PARAM],
  (m, cfg, c) => {
    const s = fbm(m, cfg);
    return c.param("range") === "signed" ? s : s.mul(0.5).add(0.5);
  },
);

export const turbulenceNode = fractalNode(
  "noiseTurbulence",
  "Turbulence",
  ["turbulent", "billowy", "abs noise", "cloud billows"],
  "Σ gainⁱ · |noise(p · lacunarityⁱ)| normalised by Σ|gainⁱ|. Range 0 … 1 (creases at 0).",
  [],
  [],
  (m, cfg) => turbulence(m, cfg),
);

export const ridgedNode = fractalNode(
  "noiseRidged",
  "Ridged Multifractal",
  ["ridged", "ridge noise", "mountains", "musgrave ridged", "ridged fbm"],
  "Musgrave ridged multifractal: signal = (Offset − |n|)² · weight with weight = clamp(signal · Sharpness, 0, 1), summed over octaves and normalised by Σ|gainⁱ|. Range 0 … 1 for Offset in 0 … 1 (default 1: bright ridges where the basis crosses 0).",
  [
    floatPort("offset", "Offset", 1, "Ridge offset; keep within 0…1 for a guaranteed 0…1 range."),
    floatPort("sharpness", "Sharpness", 2, "Feedback of each octave's signal into the next octave's weight."),
  ],
  [],
  (m, cfg, c) => ridged(m, cfg, m.w(c.in("offset")), m.w(c.in("sharpness"))),
);

/* ── domain warp ──────────────────────────────────────────────────────────────────────────────── */
const warpPorts = (d: Dim): ResolvedPorts =>
  ports(
    [
      coordPort(d),
      floatPort("scale", "Noise Scale", 3, "Frequency of the warp field."),
      floatPort("strength", "Strength", 0.1, "Displacement in units of P."),
      floatPort("seed", "Seed", 0),
    ],
    [outPort("out", "Warped P", d === 3 ? "vec3" : "vec2"), outPort("offset", "Offset", d === 3 ? "vec3" : "vec2")],
  );

export const domainWarpNode: NodeDef = baseNode({
  id: "noiseDomainWarp",
  category: CAT,
  name: "Domain Warp",
  synonyms: ["warp", "distort", "turbulent distortion", "coordinate warp"],
  description:
    "Displaces P by a vector of decorrelated signed noise samples: Warped = P + Strength · (n₀, n₁[, n₂])(Warped·Scale), re-evaluated Iterations times from the original P (Iterations 1 = single warp). Output: warped coordinates and the displacement (|offset| ≤ Strength·√N). Feed the result into any noise / shape node.",
  inputs: warpPorts(2).inputs,
  outputs: warpPorts(2).outputs,
  params: [
    DIM_PARAM,
    BASIS_PARAM,
    { id: "iterations", label: "Iterations", control: "int", default: 1, min: 1, max: 4, step: 1 },
    HASH_PARAM,
  ],
  dynamicPorts: (node) => warpPorts(dimOfNode(node.params.dimension)),
  targetNotes: NOTE,
  build: (c) => {
    const m = hashM(c);
    const dim = dimOfNode(c.param("dimension"));
    const it = Number(c.param("iterations"));
    if (!Number.isInteger(it) || it < 1 || it > 4) c.fail("Iterations must be an integer from 1 to 4.");
    const p = m.w(c.in("p"));
    const out = warp(
      m,
      p,
      basisOf(c),
      m.w(c.in("scale")),
      m.w(c.in("strength")),
      seedOffset(m, m.w(c.in("seed")), dim),
      it,
    );
    return { out: out.id, offset: out.sub(p).id };
  },
});

export const curlNoiseNode: NodeDef = baseNode({
  id: "noiseCurl2D",
  category: CAT,
  name: "Curl Noise 2D",
  synonyms: ["curl", "flow noise", "divergence free", "vector field noise"],
  description:
    "Divergence-free 2D vector field: curl of the scalar potential ψ(P) = basis(P · Scale) = (∂ψ/∂y, −∂ψ/∂x), by central differences with step Epsilon (clamped to ≥ 1e-6). Not normalised: magnitude ≈ Scale · O(1) (units of ψ per unit of P).",
  inputs: [
    coordPort(2),
    floatPort("scale", "Scale", 3),
    floatPort("epsilon", "Epsilon", 0.001, "Finite-difference step in units of P (clamped to ≥ 1e-6)."),
    floatPort("seed", "Seed", 0),
  ],
  outputs: [outPort("out", "Out", "vec2")],
  params: [BASIS_PARAM, HASH_PARAM],
  targetNotes: {
    all: "Portable IR; evaluates the basis 4 times. Float32 targets: keep Epsilon ≥ 1e-4 for stable differences.",
  },
  build: (c) => {
    const m = hashM(c);
    return {
      out: curl2D(
        m,
        m.w(c.in("p")),
        basisOf(c),
        m.w(c.in("scale")),
        m.w(c.in("epsilon")),
        seedOffset(m, m.w(c.in("seed")), 2),
      ).id,
    };
  },
});
