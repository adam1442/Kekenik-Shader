import type { BuildContext, NodeDef, PortDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import type { ShaderType } from "../../types/shaderType";
import { baseNode, enumParam } from "../kit";
import { M } from "../procedural/irm";
import { floatPort } from "../procedural/ports";
import { TEX_NOTES, colorOut, colorPort, rgbOf } from "./common";

/**
 * 2 (E9): sample nodes for the texture kinds beyond Texture 2D — Texture 2D Array (UV + layer), Texture 3D (UVW),
 * Cubemap (direction) — and a real 3-D colour LUT lookup (hardware trilinear filtering of a Texture3D).
 * One IR `sample` op serves them all: the coordinate type follows the texture kind (see `IRBuilder.sample`).
 */
const KIND_NOTES = {
  ...TEX_NOTES,
  all: "Implicit-LOD sampling is fragment-only; Explicit LOD works in every stage. Gradient sampling is not offered for these texture kinds.",
  glsl: "GLSL ES 3.00: sampler2DArray / sampler3D / samplerCube with texture() / textureLod() (explicit precision statement is emitted for the non-default sampler types).",
  hlsl: "HLSL SM5: Texture2DArray / Texture3D / TextureCube .Sample / .SampleLevel with a separate SamplerState (static check only, never compiled here).",
  wgsl: "WGSL: texture_2d_array / texture_3d / texture_cube with textureSample / textureSampleLevel (validated by naga); the array layer is rounded to nearest.",
  unity: "URP macros TEXTURE2D_ARRAY / TEXTURE3D / TEXTURECUBE + SAMPLE_*(_LOD) [K: manual check texture-kinds].",
  godot:
    "sampler2DArray / sampler3D / samplerCube + texture() / textureLod() [verify: manual Godot check texture-kinds].",
};

const MODE = enumParam(
  "mode",
  "Mode",
  [
    ["implicit", "Implicit LOD"],
    ["lod", "Explicit LOD"],
  ],
  "implicit",
);
const tex = (ty: ShaderType, name = "Texture"): PortDef => ({ id: "tex", name, type: T(ty) });
const lodPort: PortDef = { id: "lod", name: "LOD", type: T("float"), default: 0 };
const OUTS: PortDef[] = [
  { id: "rgba", name: "RGBA", type: T("color4") },
  { id: "rgb", name: "RGB", type: T("color") },
  { id: "a", name: "A", type: T("float") },
];

const sampleOut = (c: BuildContext, uv: number): Record<string, number> => {
  const lod = c.param<string>("mode") === "lod";
  const s = c.b.sample({ tex: c.in("tex"), uv, mode: lod ? "lod" : "implicit", ...(lod ? { lod: c.in("lod") } : {}) });
  return { rgba: s, rgb: c.b.swizzle(s, "xyz"), a: c.b.swizzle(s, "w") };
};

const sampleTexture2DArrayNode: NodeDef = baseNode({
  id: "sampleTexture2DArray",
  category: "Input/Texture",
  name: "Sample Texture 2D Array",
  synonyms: ["texture array", "tex2darray", "sprite array", "layered texture", "atlas layers"],
  description:
    "Samples one layer of a Texture 2D Array (a stack of equally sized 2D images). Layer is a float rounded to the nearest layer index and clamped to the array range by the hardware (GLSL / HLSL / WGSL / Unity / Godot all agree: nearest). Implicit LOD is fragment-only; Explicit LOD works in any stage.",
  inputs: [
    tex("texture2DArray"),
    { id: "uv", name: "UV", type: T("vec2"), tag: { semantic: "uv" }, defaultInput: { input: "uv0" } },
    floatPort("layer", "Layer", 0, "Layer index (rounded to nearest)."),
    lodPort,
  ],
  outputs: OUTS,
  params: [MODE],
  targetNotes: KIND_NOTES,
  build: (c) => {
    const m = new M(c.b);
    return sampleOut(c, m.v3(m.w(c.in("uv")).x, m.w(c.in("uv")).y, m.w(c.in("layer"))).id);
  },
});

const sampleTexture3DNode: NodeDef = baseNode({
  id: "sampleTexture3D",
  category: "Input/Texture",
  name: "Sample Texture 3D",
  synonyms: ["volume texture", "tex3d", "3d texture", "volume sample", "noise volume"],
  description:
    "Samples a Texture 3D (volume) at UVW (0–1 per axis) with the hardware's trilinear filtering. UVW defaults to object-space Position. Implicit LOD is fragment-only; Explicit LOD works in any stage.",
  inputs: [
    tex("texture3D"),
    { id: "uvw", name: "UVW", type: T("vec3"), defaultInput: { input: "position", space: "object" } },
    lodPort,
  ],
  outputs: OUTS,
  params: [MODE],
  targetNotes: KIND_NOTES,
  build: (c) => sampleOut(c, c.in("uvw")),
});

const sampleCubemapNode: NodeDef = baseNode({
  id: "sampleCubemap",
  category: "Input/Texture",
  name: "Sample Cubemap",
  synonyms: ["cube texture", "skybox", "environment map", "texturecube"],
  description:
    "Samples a Cubemap along a direction (it need not be normalised). Direction defaults to object-space Position. Implicit LOD is fragment-only; Explicit LOD works in any stage. Cube face orientation follows each engine's own convention (the Preview uses WebGL's).",
  inputs: [
    tex("textureCube", "Cubemap"),
    { id: "dir", name: "Direction", type: T("vec3"), defaultInput: { input: "position", space: "object" } },
    lodPort,
  ],
  outputs: OUTS,
  params: [MODE],
  targetNotes: KIND_NOTES,
  build: (c) => sampleOut(c, c.in("dir")),
});

const lut3DNode: NodeDef = baseNode({
  id: "colorLut3D",
  category: "Color/Mask",
  name: "LUT Lookup 3D",
  synonyms: ["texture3d lut", "volume lut", "lut texture3d", "true 3d lut", "color grade volume"],
  description:
    "Applies a real 3-D colour lookup table stored in a Texture 3D (R → U, G → V, B → W) with hardware trilinear filtering: ONE explicit-LOD-0 fetch per pixel, usable in any stage. Size is the number of entries per axis of the texture (16, 32, 64…); it only drives the half-texel correction so the table's first / last entries land exactly on 0 and 1. The 3-D texture should use linear filtering + clamp. For LUTs stored in a flat 2D strip / grid use LUT Lookup. Alpha passes through.",
  inputs: [colorPort("in", "In", [0.6, 0.4, 0.2, 1]), tex("texture3D", "LUT"), floatPort("amount", "Amount", 1)],
  outputs: [colorOut()],
  params: [
    {
      id: "size",
      label: "LUT size",
      control: "int",
      default: 32,
      min: 2,
      max: 256,
      step: 1,
      tooltip: "Entries per axis of the 3-D texture.",
    },
  ],
  targetNotes: { ...KIND_NOTES, all: "One explicit-LOD-0 3-D fetch per pixel (any stage)." },
  build: (c) => {
    const m = new M(c.b);
    const n = Math.max(2, Math.min(256, Math.round(Number(c.param("size")) || 32)));
    const v = m.w(c.in("in")),
      rgb = rgbOf(v).saturate();
    const uvw = rgb.mul((n - 1) / n).add(0.5 / n);
    const graded = m.w(c.b.sample({ tex: c.in("tex"), uv: uvw.id, mode: "lod", lod: m.f(0).id })).sw("xyz");
    return { out: m.vec("vec4", rgbOf(v).mix(graded, m.w(c.in("amount"))), v.w).id };
  },
});

export const TEXTURE_KIND_DEFS: NodeDef[] = [
  sampleTexture2DArrayNode,
  sampleTexture3DNode,
  sampleCubemapNode,
  lut3DNode,
];
