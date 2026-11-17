import type { NodeDef, PortDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { baseNode, enumParam } from "../kit";
import { M, type V } from "../procedural/irm";
import { floatPort, outPort } from "../procedural/ports";
import { SAMPLING_PARAM, TEX_NOTES, fetch, lodPort, safeNormalize, texPort } from "./common";
import { NORMAL_FORMATS, type NormalFormat, flatNormal, normalStrength, unpackNormal } from "./normalMath";

/**
 * Triplanar mapping. The surface is projected along the three world (or object) axes:
 *   X-projection samples (P.z, P.y), Y-projection samples (P.x, P.z), Z-projection samples (P.x, P.y), all multiplied by Tile.
 * Projections are NOT mirrored on back faces (a texture reads mirrored on the −X / −Y / −Z side); use symmetric textures or a Tile sign flip.
 */

/** Blend weights (sum = 1): w_i = |n_i|^k / Σ|n_j|^k, evaluated as (|n_i| / max|n|)^k so the result is scale invariant and never overflows. Zero normal → (0, 1, 0). */
function triplanarWeights(m: M, n: V, sharpness: V): V {
  const a = n.abs();
  const mx = a.x.max(a.y).max(a.z);
  const ok = mx.gt(0);
  const rel = a.mul(m.sel(ok, m.f(1).div(m.sel(ok, mx, 1)), 0)); // 0…1, max component = 1
  const k = sharpness.max(0);
  const w = m.fn("exp2", m.fn("log2", rel.max(1e-6)).mul(k));
  const sum = w.x.add(w.y).add(w.z);
  return m.sel(ok, w.div(sum), m.k("vec3", 0, 1, 0));
}

/** U17: Space switch. World (default) = the texture stays put while the object moves; Object = it sticks to the mesh (uses the object-space Position / Normal inputs, i.e. the object matrix). */
const SPACE_PARAM = enumParam(
  "space",
  "Space",
  [
    ["world", "World"],
    ["object", "Object"],
  ],
  "world",
);
type TriSpace = "world" | "object";
const spaceOf = (v: unknown): TriSpace => (v === "object" ? "object" : "world");

const triPorts = (space: TriSpace = "world"): PortDef[] => [
  {
    id: "pos",
    name: "Position",
    type: T("vec3"),
    defaultInput: { input: "position", space },
    tooltip: `Projection position (defaults to ${space}-space Position; the Space parameter switches World / Object).`,
  },
  {
    id: "normal",
    name: "Normal",
    type: T("vec3"),
    defaultInput: { input: "normal", space },
    tooltip: "Surface normal in the SAME space as Position.",
  },
  floatPort("tile", "Tile", 1, "Texture repeats per unit of Position."),
  floatPort(
    "blend",
    "Blend Sharpness",
    4,
    "Exponent of the blend weights: 1 = soft, 8+ = nearly hard transitions. Negative values are treated as 0 (equal weights).",
  ),
  lodPort(),
];

/** The three projected UVs. */
function projections(m: M, p: V, tile: V): [V, V, V] {
  const q = p.mul(tile);
  return [m.v2(q.z, q.y), m.v2(q.x, q.z), m.v2(q.x, q.y)];
}

const triplanarWeightsNode: NodeDef = baseNode({
  id: "uvTriplanarWeights",
  category: "UV/Triplanar",
  name: "Triplanar Blend Weights",
  synonyms: ["triplanar weights", "axis blend", "box mapping weights"],
  description:
    "Per-axis blend weights (X, Y, Z projection) from a normal: w = |n|^Sharpness normalised to SUM = 1 (computed as (|n|/max|n|)^k, scale invariant). A normal along one axis gives weight 1 on that axis; a diagonal normal gives equal weights; a zero normal returns (0, 1, 0). Output range: each weight in [0, 1].",
  inputs: [
    { id: "normal", name: "Normal", type: T("vec3"), defaultInput: { input: "normal", space: "world" } },
    floatPort("blend", "Blend Sharpness", 4),
  ],
  outputs: [outPort("out", "Weights", "vec3")],
  params: [SPACE_PARAM],
  dynamicPorts: (node) => ({
    inputs: [
      {
        id: "normal",
        name: "Normal",
        type: T("vec3"),
        defaultInput: { input: "normal", space: spaceOf(node.params.space) },
      },
      floatPort("blend", "Blend Sharpness", 4),
    ],
    outputs: [outPort("out", "Weights", "vec3")],
  }),
  targetNotes: { all: "Portable IR maths (exp2 / log2), identical on every target." },
  build: (c) => {
    const m = new M(c.b);
    return { out: triplanarWeights(m, m.w(c.in("normal")), m.w(c.in("blend"))).id };
  },
});

const triplanarTextureNode: NodeDef = baseNode({
  id: "uvTriplanarTexture",
  category: "UV/Triplanar",
  name: "Triplanar Texture",
  synonyms: ["triplanar", "box projection", "world space texture", "tri-planar sampling"],
  description:
    "Samples a texture along the three axes and blends the results with the Triplanar Blend Weights (sum = 1): RGBA = Σ wᵢ·sample(UVᵢ). X uses (P.z, P.y), Y uses (P.x, P.z), Z uses (P.x, P.y), each × Tile. Colour data is returned as stored (sRGB textures are decoded by the sampler). Output range: the texture's range (weights are convex).",
  inputs: [texPort("tex", "Texture"), ...triPorts()],
  outputs: [
    { id: "rgba", name: "RGBA", type: T("color4") },
    { id: "rgb", name: "RGB", type: T("color") },
    outPort("weights", "Weights", "vec3"),
  ],
  params: [SAMPLING_PARAM, SPACE_PARAM],
  targetNotes: TEX_NOTES,
  dynamicPorts: (node) => ({
    inputs: [texPort("tex", "Texture"), ...triPorts(spaceOf(node.params.space))],
    outputs: [
      { id: "rgba", name: "RGBA", type: T("color4") },
      { id: "rgb", name: "RGB", type: T("color") },
      outPort("weights", "Weights", "vec3"),
    ],
  }),
  build: (c) => {
    const m = new M(c.b);
    const w = triplanarWeights(m, m.w(c.in("normal")), m.w(c.in("blend")));
    const [ux, uy, uz] = projections(m, m.w(c.in("pos")), m.w(c.in("tile")));
    const tex = c.in("tex");
    const s = fetch(c, m, tex, ux)
      .mul(w.x)
      .add(fetch(c, m, tex, uy).mul(w.y))
      .add(fetch(c, m, tex, uz).mul(w.z));
    return { rgba: s.id, rgb: s.sw("xyz").id, weights: w.id };
  },
});

const triplanarNormalNode: NodeDef = baseNode({
  id: "uvTriplanarNormal",
  category: "UV/Triplanar",
  name: "Triplanar Normal",
  synonyms: ["triplanar normal map", "whiteout triplanar", "world normal triplanar"],
  description:
    "Triplanar normal mapping with the Whiteout blend (Ben Golus): each projection's tangent-space normal gets the surface normal added in the matching swizzle (X: n.zy, Y: n.xz, Z: n.xy; z scaled by the SIGNED surface normal component, so the orientation follows the face direction), then the three are swizzled to world axes and blended by the weights. Output is a UNIT vector in the space of Normal (world by default); a zero surface normal is replaced by (0, 0, 1) first. Strength scales each tangent-space slope first (1 = as authored).",
  inputs: [texPort("tex", "Normal Map"), ...triPorts(), floatPort("strength", "Strength", 1)],
  outputs: [outPort("out", "Normal", "vec3"), outPort("weights", "Weights", "vec3")],
  dynamicPorts: (node) => ({
    inputs: [
      texPort("tex", "Normal Map"),
      ...triPorts(spaceOf(node.params.space)),
      floatPort("strength", "Strength", 1),
    ],
    outputs: [outPort("out", "Normal", "vec3"), outPort("weights", "Weights", "vec3")],
  }),
  params: [
    SAMPLING_PARAM,
    SPACE_PARAM,
    {
      id: "format",
      label: "Format",
      control: "enum",
      default: "rgb",
      options: NORMAL_FORMATS.map(([value, label]) => ({ value, label })),
    },
    { id: "flipGreen", label: "Flip green (DirectX)", control: "bool", default: false },
  ],
  targetNotes: TEX_NOTES,
  build: (c) => {
    const m = new M(c.b);
    const n = m.w(c.in("normal"));
    const w = triplanarWeights(m, n, m.w(c.in("blend")));
    const [ux, uy, uz] = projections(m, m.w(c.in("pos")), m.w(c.in("tile")));
    const tex = c.in("tex"),
      fmt = c.param<NormalFormat>("format"),
      flip = c.param("flipGreen") === true;
    const tn = (uv: V): V => normalStrength(m, unpackNormal(m, fetch(c, m, tex, uv), fmt, flip), m.w(c.in("strength")));
    const sn = safeNormalize(m, n, flatNormal(m));
    const tx = tn(ux),
      ty = tn(uy),
      tz = tn(uz);
    // Whiteout: add the surface normal's matching components to xy, scale z by the signed normal component.
    const wx = m.v3(tx.x.add(sn.z), tx.y.add(sn.y), tx.z.abs().mul(sn.x));
    const wy = m.v3(ty.x.add(sn.x), ty.y.add(sn.z), ty.z.abs().mul(sn.y));
    const wz = m.v3(tz.x.add(sn.x), tz.y.add(sn.y), tz.z.abs().mul(sn.z));
    const mix = m
      .v3(wx.z, wx.y, wx.x)
      .mul(w.x)
      .add(m.v3(wy.x, wy.z, wy.y).mul(w.y))
      .add(wz.mul(w.z));
    return { out: safeNormalize(m, mix, sn).id, weights: w.id };
  },
});
export const UV_TRIPLANAR_DEFS: NodeDef[] = [triplanarWeightsNode, triplanarTextureNode, triplanarNormalNode];
