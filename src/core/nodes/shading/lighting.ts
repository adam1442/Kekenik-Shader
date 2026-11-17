import type { NodeDef, PortDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { enumParam } from "../kit";
import { M, type V } from "../procedural/irm";
import { floatPort, outPort } from "../procedural/ports";
import { SAMPLING_PARAM, fetch, lodPort, rgbPort, texPort, uvPort } from "../visual/common";
import { edge, noteAll, normalPort, shNode, unit, viewDirPort } from "./common";

/** Artistic / lighting-lite nodes that need NO engine data: pure functions of ports. Conventions: see common.ts. */

/** N·V with both vectors re-normalised (never NaN), clamped to 0..1: 1 = facing the camera, 0 = silhouette (or back-facing). */
function nDotV(m: M, n: V, v: V): V {
  const nn = unit(m, n, m.k("vec3", 0, 0, 1));
  const vv = unit(m, v, m.k("vec3", 0, 0, 1));
  return nn.dot(vv).saturate();
}

const fresnelNode: NodeDef = shNode({
  id: "fresnel",
  category: "Lighting/Artistic",
  name: "Fresnel",
  synonyms: ["fresnel effect", "edge glow", "schlick", "silhouette falloff"],
  description:
    "Angle-dependent edge factor, output 0…1. Power mode: pow(1 − N·V, Power) (Unity Fresnel Effect; 0 facing the camera, 1 at the silhouette; Power ≥ 0, a Power of 0 gives 1). Schlick mode: F0 + (1 − F0)·(1 − N·V)^5 (physically based reflectance, F0 in 0…1). N·V is clamped to 0…1 and both vectors are re-normalised. Normal and View Dir must be in the SAME space (World by default).",
  inputs: [
    normalPort(),
    viewDirPort(),
    floatPort("power", "Power", 5, "Exponent of the falloff (Power mode)."),
    floatPort("f0", "F0", 0.04, "Reflectance at normal incidence (Schlick mode)."),
  ],
  outputs: [outPort("out", "Fresnel", "float")],
  params: [
    enumParam(
      "mode",
      "Mode",
      [
        ["power", "Power"],
        ["schlick", "Schlick"],
      ],
      "power",
    ),
  ],
  targetNotes: noteAll(
    "Both vectors must be in the same space; the defaults are world-space normal and view direction.",
  ),
  build: (c) => {
    const m = new M(c.b);
    const k = m.f(1).sub(nDotV(m, m.w(c.in("normal")), m.w(c.in("viewDir"))));
    if (c.param<string>("mode") === "schlick") {
      const f0 = m.w(c.in("f0")).saturate();
      return { out: f0.add(m.f(1).sub(f0).mul(k.pow(5))).id };
    }
    return { out: k.pow(m.w(c.in("power")).max(0)).id };
  },
});

const rimLightNode: NodeDef = shNode({
  id: "rimLight",
  category: "Lighting/Artistic",
  name: "Rim Lighting",
  synonyms: ["rim light", "rim glow", "backlight edge", "outline glow"],
  description:
    "Coloured rim on silhouettes. Mask = smoothstep(Threshold − Softness, Threshold + Softness, 1 − N·V)^Power, 0…1 (Softness 0 = hard edge, ≥ goes to 1). Color = Rim Color · Intensity · Mask (linear RGB, may exceed 1). The optional Light Dir (towards the light, same space as Normal) restricts the rim to the lit side: Mask is multiplied by saturate(N·L). Outputs the Mask (0…1) and the Color.",
  inputs: [
    normalPort(),
    viewDirPort(),
    rgbPort("color", "Rim Color", [1, 1, 1]),
    floatPort("power", "Power", 2),
    floatPort("intensity", "Intensity", 1),
    floatPort("threshold", "Threshold", 0.5),
    floatPort("softness", "Softness", 0.25),
    {
      id: "lightDir",
      name: "Light Dir",
      type: T("vec3"),
      optional: true,
      tag: { semantic: "direction" },
      tooltip: "Optional direction towards the light (same space as Normal). Unconnected = rim all around.",
    },
  ],
  outputs: [outPort("mask", "Mask", "float"), outPort("color", "Color", "color")],
  targetNotes: noteAll(
    "The light direction is an input: wire the Main Light Direction node (Unity URP) or a Vector 3 property for a portable shader.",
  ),
  build: (c) => {
    const m = new M(c.b);
    const n = unit(m, m.w(c.in("normal")), m.k("vec3", 0, 0, 1));
    const k = m.f(1).sub(nDotV(m, n, m.w(c.in("viewDir"))));
    const th = m.w(c.in("threshold"));
    const so = m.w(c.in("softness")).max(0);
    let mask = edge(m, th.sub(so), th.add(so), k).pow(m.w(c.in("power")).max(0));
    if (c.connected("lightDir"))
      mask = mask.mul(n.dot(unit(m, m.w(c.in("lightDir")), m.k("vec3", 0, 1, 0))).saturate());
    return {
      mask: mask.id,
      color: m
        .w(c.in("color"))
        .mul(m.w(c.in("intensity")))
        .mul(mask).id,
    };
  },
});

/** Matcap lookup coordinates from a VIEW-space normal: uv = N.xy · 0.5 + 0.5 (bottom-left origin, +Y up). */
const matcapUv = (m: M, nView: V): V =>
  unit(m, nView, m.k("vec3", 0, 0, 1))
    .sw("xy")
    .mul(0.5)
    .add(0.5);

const matcapNode: NodeDef = shNode({
  id: "matcap",
  category: "Lighting/Artistic",
  name: "Matcap",
  synonyms: ["material capture", "lit sphere", "sphere map lookup", "matcap texture"],
  description:
    "Material-capture shading: looks the texture up at UV = N_view.xy · 0.5 + 0.5 (N_view = unit VIEW-space normal, +X right, +Y up; a sphere image with origin at the bottom-left, the centre pixel = normal facing the camera). Never use a world / object normal: the lookup would rotate with the camera incorrectly. Output Color = texel · Intensity (rgb + alpha of the texture, UV exposed). Normals in the range ±1 always map inside the texture; back-facing normals (z < 0) sample the same disc mirrored. The texture should be a square sphere capture, filtering Linear, wrap Clamp.",
  inputs: [
    normalPort("normal", "view", "Normal (view)"),
    texPort("tex", "Matcap"),
    floatPort("intensity", "Intensity", 1),
    lodPort(0),
  ],
  outputs: [
    outPort("color", "Color", "color"),
    { id: "rgba", name: "RGBA", type: T("color4") },
    outPort("uv", "UV", "vec2"),
  ],
  params: [SAMPLING_PARAM],
  targetNotes: {
    ...noteAll("Texture sampling: implicit LOD in the fragment stage, Explicit LOD (Sampling param) in any stage."),
    glsl: "texture() on a sampler2D; set Clamp + Linear on the texture in the host.",
  },
  build: (c) => {
    const m = new M(c.b);
    const uv = matcapUv(m, m.w(c.in("normal")));
    const texel = fetch(c, m, c.in("tex"), uv);
    const k = m.w(c.in("intensity"));
    return { color: texel.sw("xyz").mul(k).id, rgba: m.vec("vec4", texel.sw("xyz").mul(k), texel.w).id, uv: uv.id };
  },
});

const MAX_TOON_THRESHOLDS = 4;
/** Level (0…1) of the staircase: Σ edge(t_i, x) / count. */
function toonLevel(m: M, x: V, thresholds: V[], softness: V): V {
  let sum: V = m.f(0);
  for (const t of thresholds) sum = sum.add(edge(m, t.sub(softness.mul(0.5)), t.add(softness.mul(0.5)), x));
  return sum.div(thresholds.length);
}

const TOON_INPUTS: PortDef[] = [
  floatPort("value", "Value", 0.5, "Lighting value, nominally 0…1 (e.g. N·L · 0.5 + 0.5)."),
  floatPort("softness", "Softness", 0, "Width of the band edge in Value units (0 = hard)."),
  floatPort("t1", "T1", 0.3),
  floatPort("t2", "T2", 0.6),
  floatPort("t3", "T3", 0.85),
  floatPort("t4", "T4", 0.95),
  rgbPort("shadow", "Shadow", [0.15, 0.15, 0.25]),
  rgbPort("lit", "Lit", [1, 1, 1]),
  texPort("ramp", "Ramp Texture"),
  lodPort(0),
];
const TOON_OUTPUTS: PortDef[] = [outPort("level", "Level", "float"), outPort("color", "Color", "color")];

const toonRampNode: NodeDef = shNode({
  id: "toonRamp",
  category: "Lighting/Artistic",
  name: "Toon Ramp",
  synonyms: ["cel shading", "cel shade", "toon shading", "light ramp", "light bands"],
  description:
    "Quantises a lighting value (typically N·L remapped to 0…1) into hard bands. Level = Σ edge(Tᵢ, Value) / count, 0…1, where edge is a step (Value ≥ Tᵢ → 1) or, with Softness > 0, a smoothstep of width Softness centred on Tᵢ (exactly 0.5 at Tᵢ). Modes: Bands = N equal bands (thresholds i/N); Thresholds = 1–4 explicit ascending thresholds (T1…T4); Texture = samples the ramp texture at (saturate(Value), 0.5). Color = mix(Shadow, Lit, Level) (Texture mode: the texel). Value is not clamped in the maths; the Texture mode clamps it to 0…1.",
  inputs: TOON_INPUTS.filter((p) => ["value", "softness", "shadow", "lit"].includes(p.id)),
  outputs: TOON_OUTPUTS,
  params: [
    enumParam(
      "mode",
      "Mode",
      [
        ["bands", "Bands"],
        ["thresholds", "Thresholds"],
        ["texture", "Ramp texture"],
      ],
      "bands",
    ),
    {
      id: "bands",
      label: "Bands",
      control: "int",
      default: 3,
      min: 2,
      max: 8,
      step: 1,
      tooltip: "Number of bands (Bands mode), 2–8.",
    },
    {
      id: "count",
      label: "Thresholds",
      control: "int",
      default: 2,
      min: 1,
      max: MAX_TOON_THRESHOLDS,
      step: 1,
      tooltip: "How many of T1…T4 are used (Thresholds mode).",
    },
    SAMPLING_PARAM,
  ],
  targetNotes: noteAll(
    "Ramp texture mode needs a texture (Clamp wrap). The portable representation of a ramp is the Bands / Thresholds mode: no texture required.",
  ),
  dynamicPorts: (node) => {
    const mode = String(node.params.mode ?? "bands");
    const n = Math.round(Math.min(MAX_TOON_THRESHOLDS, Math.max(1, Number(node.params.count ?? 2))));
    const keep =
      mode === "texture"
        ? ["value", "ramp", "lod"]
        : mode === "thresholds"
          ? ["value", "softness", ...["t1", "t2", "t3", "t4"].slice(0, n), "shadow", "lit"]
          : ["value", "softness", "shadow", "lit"];
    return { inputs: TOON_INPUTS.filter((p) => keep.includes(p.id)), outputs: TOON_OUTPUTS };
  },
  build: (c) => {
    const m = new M(c.b);
    const x = m.w(c.in("value"));
    const mode = c.param<string>("mode");
    if (mode === "texture") {
      const texel = fetch(c, m, c.in("ramp"), m.v2(x.saturate(), 0.5));
      return { level: texel.x.id, color: texel.sw("xyz").id };
    }
    let ts: V[];
    if (mode === "bands") {
      const n = Math.round(Math.min(8, Math.max(2, c.param<number>("bands"))));
      ts = Array.from({ length: n - 1 }, (_, i) => m.f((i + 1) / n));
    } else {
      const n = Math.round(Math.min(MAX_TOON_THRESHOLDS, Math.max(1, c.param<number>("count"))));
      ts = (["t1", "t2", "t3", "t4"] as const).slice(0, n).map((id) => m.w(c.in(id)));
    }
    const level = toonLevel(m, x, ts, m.w(c.in("softness")).max(0));
    return { level: level.id, color: m.w(c.in("shadow")).mix(m.w(c.in("lit")), level).id };
  },
});

/** Hatching ink coverage 0…1 of ONE layer. `coord` = position along the line normal (in line periods). */
function hatchInk(coord: V, darkness: V, density: V, contrast: V): V {
  const tri = coord.fract().sub(0.5).abs().mul(2); // 0 at the line centre … 1 between lines
  const width = darkness.mul(density).clamp(0, 1);
  return width.sub(tri).mul(contrast.mul(50).add(1)).saturate();
}

const hatchingNode: NodeDef = shNode({
  id: "hatching",
  category: "Lighting/Artistic",
  name: "Hatching",
  synonyms: ["crosshatch", "pencil shading", "engraving", "line shading"],
  description:
    "Procedural line hatching driven by a light value. Output 0…1 where 1 = paper and 0 = full ink: Π(1 − ink_k) over Layers. Layer k uses lines at Angle + k·45°, period 1/Scale UV units (Scale = lines per UV unit; the pattern repeats exactly every 1/Scale along the line normal), and appears only when darkness (1 − Intensity) · Layers > k. Line width = saturate(darkness_k · Density); Contrast 0 = soft triangular profile, higher = harder edges. Intensity 1 gives exactly 1 everywhere. UV defaults to UV0; Angle is in degrees, counter-clockwise: the lines run along the direction (cos Angle, sin Angle), so 0 = lines along +U.",
  inputs: [
    uvPort(),
    floatPort("intensity", "Intensity", 0.4, "Light value 0…1 (1 = bright / paper)."),
    floatPort("scale", "Scale", 20, "Lines per UV unit."),
    floatPort("angle", "Angle", 45, "Degrees."),
    floatPort("density", "Density", 1.5, "Ink width multiplier."),
    floatPort("contrast", "Contrast", 0.5),
  ],
  outputs: [outPort("out", "Paper", "float")],
  params: [
    {
      id: "layers",
      label: "Layers",
      control: "int",
      default: 2,
      min: 1,
      max: 4,
      step: 1,
      tooltip: "1–4 hatching directions (cross-hatching).",
    },
  ],
  targetNotes: noteAll(
    "Screen-space or object-space hatching: wire any UV (e.g. Screen Position normalized · aspect) into UV.",
  ),
  build: (c) => {
    const m = new M(c.b);
    const uv = m.w(c.in("uv"));
    const layers = Math.round(Math.min(4, Math.max(1, c.param<number>("layers"))));
    const dark = m.f(1).sub(m.w(c.in("intensity")).saturate());
    const scale = m.w(c.in("scale"));
    const ang = m.w(c.in("angle")).mul(Math.PI / 180);
    let paper: V = m.f(1);
    for (let k = 0; k < layers; k++) {
      const a = ang.add((k * Math.PI) / 4);
      const coord = uv.dot(m.v2(a.sin().neg(), a.cos())).mul(scale);
      const dk = dark.mul(layers).sub(k).clamp(0, 1);
      paper = paper.mul(m.f(1).sub(hatchInk(coord, dk, m.w(c.in("density")), m.w(c.in("contrast")).max(0))));
    }
    return { out: paper.id };
  },
});

export type FogMetric = "radial" | "viewDepth";
/** Fog factor 0…1 (0 = clear, 1 = fully fogged) for distance `d` ≥ 0. */
export function fogFactor(m: M, d: V, mode: string, start: V, end: V, density: V): V {
  if (mode === "linear") return edgeLinear(m, d, start, end);
  const x = d.mul(density.max(0));
  return m
    .f(1)
    .sub(m.fn("exp", mode === "exp2" ? x.mul(x).neg() : x.neg()))
    .saturate();
}
const edgeLinear = (m: M, d: V, s: V, e: V): V =>
  d
    .sub(s)
    .mul(m.f(1).div(m.sel(e.sub(s).abs().le(1e-9), m.f(1e-9), e.sub(s))))
    .saturate();

const fakeFogNode: NodeDef = shNode({
  id: "fakeFog",
  category: "Lighting/Artistic",
  name: "Fake Fog",
  synonyms: ["distance fog", "atmospheric fog", "depth fade fog", "haze"],
  description:
    "Per-object distance fog that does NOT read the scene fog of the engine. Distance metric (param): Radial = |world position − camera| (euclidean, rotation-invariant) or View Depth = −z in VIEW space (distance along the view axis). A wired Distance input overrides the metric. Falloff: Linear = saturate((d − Start)/(End − Start)); Exponential = 1 − exp(−d·Density); Exponential² = 1 − exp(−(d·Density)²). Fog = 0…1 (0 clear, 1 fully fogged); Color = mix(Color In, Fog Color, Fog). Density < 0 is treated as 0; Start = End is a hard step at that distance.",
  inputs: [
    { id: "color", name: "Color", type: T("color"), default: [1, 1, 1] },
    rgbPort("fogColor", "Fog Color", [0.55, 0.65, 0.8]),
    floatPort("start", "Start", 5),
    floatPort("end", "End", 50),
    floatPort("density", "Density", 0.05),
    {
      id: "distance",
      name: "Distance",
      type: T("float"),
      optional: true,
      tooltip: "Optional override of the distance metric (world units).",
    },
  ],
  outputs: [outPort("fog", "Fog", "float"), outPort("out", "Color", "color")],
  params: [
    enumParam(
      "metric",
      "Distance",
      [
        ["radial", "Radial (euclidean)"],
        ["viewDepth", "View depth (−z)"],
      ],
      "radial",
    ),
    enumParam(
      "falloff",
      "Falloff",
      [
        ["linear", "Linear"],
        ["exp", "Exponential"],
        ["exp2", "Exponential²"],
      ],
      "linear",
    ),
  ],
  targetNotes: noteAll(
    "Camera position and the world / view position are the portable built-in inputs. This is a per-object effect, not the engine's global fog.",
  ),
  build: (c) => {
    const m = new M(c.b);
    let d: V;
    if (c.connected("distance")) d = m.w(c.in("distance")).max(0);
    else if (c.param<string>("metric") === "viewDepth") d = m.w(c.b.input("position", "view")).z.neg().max(0);
    else
      d = m
        .w(c.b.input("position", "world"))
        .sub(m.w(c.b.input("cameraPos", "world")))
        .length();
    const f = fogFactor(m, d, c.param<string>("falloff"), m.w(c.in("start")), m.w(c.in("end")), m.w(c.in("density")));
    return { fog: f.id, out: m.w(c.in("color")).mix(m.w(c.in("fogColor")), f).id };
  },
});

export const LIGHTING_PORTABLE_DEFS: NodeDef[] = [
  fresnelNode,
  rimLightNode,
  matcapNode,
  toonRampNode,
  hatchingNode,
  fakeFogNode,
];
