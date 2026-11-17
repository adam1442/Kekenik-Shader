import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { enumParam } from "../kit";
import { M } from "../procedural/irm";
import { floatPort, outPort, vec2Port } from "../procedural/ports";
import { lodPort, texPort, uvPort } from "../visual/common";
import { STAGE_NOTE, noteAll, normalPort, posPort, shNode, unit } from "./common";

/** Vertex nodes part 2: texture displacement, normal recalculation helper, sprite squash / stretch. */
const OUT_OFFSET = {
  id: "offset",
  name: "Offset",
  type: T("vec3"),
  tag: { semantic: "direction" as const, space: "object" as const },
};
const OUT_POS = {
  id: "position",
  name: "Position",
  type: T("vec3"),
  tag: { semantic: "position" as const, space: "object" as const },
};
const VNOTES = { all: `${STAGE_NOTE.vertex} Object-space Offset → Vertex Offset slot.` };

const displacementNode: NodeDef = shNode({
  id: "displacementTexture",
  category: "Vertex/Deform",
  name: "Displacement By Texture",
  synonyms: ["height map displacement", "vertex displacement", "terrain displacement", "heightfield offset"],
  description:
    "VERTEX-ONLY height-map displacement. Height = the chosen Channel of the texture at UV, sampled with EXPLICIT LOD (LOD input, default 0 = full resolution; the vertex stage has no derivatives). Offset = Direction · (Height − Midpoint) · Scale; Direction = the object-space Normal or +Y. Height ∈ [0, 1] for 8-bit textures, so Offset ∈ [−Midpoint·Scale, (1 − Midpoint)·Scale]. Needs vertex texture fetch: always available in WebGL2 (≥ 16 vertex units) and Godot; Unity URP needs shader model 3.5+ (#pragma target 3.5), which every URP platform meets. Texture UV origin bottom-left (V up). Wrap / filter come from the texture.",
  inputs: [
    posPort("object"),
    normalPort("normal", "object"),
    texPort("tex", "Height Map"),
    uvPort(),
    floatPort("scale", "Scale", 0.2),
    floatPort("midpoint", "Midpoint", 0.5),
    lodPort(0),
  ],
  outputs: [OUT_OFFSET, OUT_POS, outPort("height", "Height", "float")],
  params: [
    enumParam(
      "channel",
      "Channel",
      [
        ["r", "R"],
        ["g", "G"],
        ["b", "B"],
        ["a", "A"],
      ],
      "r",
    ),
    enumParam(
      "direction",
      "Direction",
      [
        ["normal", "Normal"],
        ["up", "Up (+Y)"],
      ],
      "normal",
    ),
  ],
  stage: "vertex",
  capabilities: ["vertexTextureFetch"],
  targetNotes: {
    ...VNOTES,
    glsl: "texture2D in the vertex shader via textureLod (GLSL ES 3.00, WebGL2: MAX_VERTEX_TEXTURE_IMAGE_UNITS ≥ 16).",
    wgsl: "textureSampleLevel in the vertex stage (WebGPU allows sampled textures in vertex shaders).",
    hlsl: "Texture2D.SampleLevel in the vertex shader (SM 3.5+).",
    unity: "URP: SAMPLE_TEXTURE2D_LOD in the vertex function (#pragma target 3.5).",
    godot: "textureLod() in vertex().",
  },
  build: (c) => {
    const m = new M(c.b);
    const texel = m.w(c.b.sample({ tex: c.in("tex"), uv: c.in("uv"), mode: "lod", lod: c.in("lod") }));
    const h = texel.sw(c.param<string>("channel"));
    const dir =
      c.param<string>("direction") === "up" ? m.k("vec3", 0, 1, 0) : unit(m, m.w(c.in("normal")), m.k("vec3", 0, 1, 0));
    const offset = dir.mul(h.sub(m.w(c.in("midpoint"))).mul(m.w(c.in("scale"))));
    return { offset: offset.id, position: m.w(c.in("position")).add(offset).id, height: h.id };
  },
});

const normalRecalcNode: NodeDef = shNode({
  id: "normalRecalc",
  category: "Vertex/Deform",
  name: "Normal Recalculation",
  synonyms: ["recalculate normals", "deformed normal", "normal from slope", "flat normal"],
  description:
    "Normal for deformed geometry WITHOUT neighbouring vertices (a shader only ever sees one vertex / pixel). Slopes mode (any stage): N' = normalize(N − Strength · (SlopeT · T + SlopeB · B)) where SlopeT / SlopeB are dh/dT and dh/dB of the displacement height measured along the tangent and bitangent (object-space units); exact to first order for displacement along N. Wave Deformation already outputs an analytic normal. Derivatives mode (FRAGMENT-ONLY): faceted normal normalize(cross(ddx(P), ddy(P))), flipped into the hemisphere of the input Normal; it needs Position in the same space as the Normal and gives flat shading per triangle. N, T, B and P must share one space (object by default). Falls back to N where the result is degenerate.",
  inputs: [
    normalPort("normal", "object"),
    {
      id: "tangent",
      name: "Tangent",
      type: T("vec3"),
      tag: { semantic: "direction" },
      defaultInput: { input: "tangent", space: "object" },
    },
    {
      id: "bitangent",
      name: "Bitangent",
      type: T("vec3"),
      tag: { semantic: "direction" },
      defaultInput: { input: "bitangent", space: "object" },
    },
    floatPort("slopeT", "Slope T", 0),
    floatPort("slopeB", "Slope B", 0),
    floatPort("strength", "Strength", 1),
    posPort("object"),
  ],
  outputs: [{ id: "out", name: "Normal", type: T("vec3"), tag: { semantic: "normal" } }],
  params: [
    enumParam(
      "mode",
      "Mode",
      [
        ["slopes", "Slopes (any stage)"],
        ["derivatives", "Derivatives (fragment only)"],
      ],
      "slopes",
    ),
  ],
  targetNotes: noteAll(
    "Derivatives mode is fragment-only (a stage diagnostic appears in the vertex stage). Slopes mode needs the mesh tangent attribute.",
  ),
  build: (c) => {
    const m = new M(c.b);
    const n = unit(m, m.w(c.in("normal")), m.k("vec3", 0, 1, 0));
    if (c.param<string>("mode") === "derivatives") {
      const P = c.in("position");
      const f = unit(m, m.w(c.b.intrinsic("cross", [c.b.deriv("ddx", P), c.b.deriv("ddy", P)])), n);
      return { out: m.sel(f.dot(n).lt(0), f.neg(), f).id };
    }
    const t = m.w(c.in("tangent"));
    const b = m.w(c.in("bitangent"));
    return {
      out: unit(
        m,
        n.sub(
          t
            .mul(m.w(c.in("slopeT")))
            .add(b.mul(m.w(c.in("slopeB"))))
            .mul(m.w(c.in("strength"))),
        ),
        n,
      ).id,
    };
  },
});

const SQUASH_MIN = -0.95;
const SQUASH_MAX = 8;

const squashStretchNode: NodeDef = shNode({
  id: "spriteSquashStretch",
  category: "Vertex/Deform",
  name: "Sprite Squash Stretch",
  synonyms: ["squash and stretch", "jelly scale", "bounce squash", "elastic scale"],
  description:
    "VERTEX-ONLY squash & stretch of a sprite quad in the XY plane. Along = 1 + Amount with Amount clamped to [−0.95, 8] (so Along ∈ [0.05, 9]); Across = 1 / Along when Preserve Area is on (area stays constant), else 1. Axis Y: scale (Across, Along); Axis X: (Along, Across). Position' = Pivot + (Position.xy − Pivot) · scale, z unchanged — the PIVOT never moves, and the scaled quad spans exactly pivot ± scale · (original offsets), so the new bounds are predictable (the Scale output). Positive Amount stretches, negative squashes. Object space.",
  inputs: [
    posPort("object"),
    floatPort("amount", "Amount", 0.3, "Stretch (+) / squash (−) along the axis; clamped to −0.95…8."),
    vec2Port("pivot", "Pivot", [0, 0], "Fixed point in object-space XY (e.g. the feet)."),
  ],
  outputs: [OUT_OFFSET, OUT_POS, outPort("scale", "Scale", "vec2")],
  params: [
    enumParam(
      "axis",
      "Axis",
      [
        ["y", "Y (vertical)"],
        ["x", "X (horizontal)"],
      ],
      "y",
    ),
    { id: "preserveArea", label: "Preserve area", control: "bool", default: true },
  ],
  stage: "vertex",
  targetNotes: { ...VNOTES, all: `${VNOTES.all} Portable IR maths.` },
  build: (c) => {
    const m = new M(c.b);
    const pos = m.w(c.in("position"));
    const pivot = m.w(c.in("pivot"));
    const along = m.w(c.in("amount")).clamp(SQUASH_MIN, SQUASH_MAX).add(1);
    const across = c.param<boolean>("preserveArea") ? m.f(1).div(along) : m.f(1);
    const scale = c.param<string>("axis") === "x" ? m.v2(along, across) : m.v2(across, along);
    const xy = pivot.add(pos.sw("xy").sub(pivot).mul(scale));
    const p = m.v3(xy.x, xy.y, pos.z);
    return { offset: p.sub(pos).id, position: p.id, scale: scale.id };
  },
});

export const VERTEX_MESH_DEFS: NodeDef[] = [displacementNode, normalRecalcNode, squashStretchNode];
