import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { baseNode, enumParam } from "../kit";
import { M } from "../procedural/irm";
import { outPort } from "../procedural/ports";
import { TEX_NOTES, texPort } from "./common";

const SIZE_NOTE = {
  ...TEX_NOTES,
  all: "Texture size of mip level 0 (textureSize / textureDimensions / GetDimensions via a helper) — legal in every stage. An unbound / default texture reports its real size (the preview's 1×1 defaults give 1).",
};

const samplerStateNode: NodeDef = baseNode({
  id: "textureSamplerState",
  category: "Texture/Sampler",
  name: "Sampler State",
  synonyms: ["sampler", "filter mode", "wrap mode", "texture filtering", "address mode"],
  description:
    "Creates an inline sampler: Filter (Point = nearest, Linear = bilinear, Trilinear = bilinear + mip blending) and Wrap (Repeat, Clamp, Mirror — applied to U and V). Connect it to the Sampler input of Sample Texture 2D. Supported natively by HLSL (static sampler), WGSL (static sampler) and the engine targets; GLSL has combined samplers, so the exported GLSL carries a WARNING and the filtering / wrapping of the texture object set by the host applies (the Kekenik Shader preview applies the node's Filter / Wrap to the bound texture itself). Output type: sampler (no preview).",
  inputs: [],
  outputs: [{ id: "out", name: "Sampler", type: T("sampler") }],
  params: [
    enumParam(
      "filter",
      "Filter",
      [
        ["linear", "Linear"],
        ["point", "Point"],
        ["trilinear", "Trilinear"],
      ],
      "linear",
    ),
    enumParam(
      "wrap",
      "Wrap",
      [
        ["repeat", "Repeat"],
        ["clamp", "Clamp"],
        ["mirror", "Mirror"],
      ],
      "repeat",
    ),
  ],
  targetNotes: {
    ...TEX_NOTES,
    glsl: "GLSL ES 3.00 has no separate sampler objects: using this node produces a warning; set filtering / wrapping on the texture in the host.",
  },
  build: (c) => ({
    out: c.b.samplerState(
      c.param<"linear" | "point" | "trilinear">("filter"),
      c.param<"repeat" | "clamp" | "mirror">("wrap"),
    ),
  }),
});

const textureSizeNode: NodeDef = baseNode({
  id: "textureSize",
  category: "Texture/Info",
  name: "Texture Size",
  synonyms: ["texture dimensions", "image size", "resolution of texture", "width height"],
  description:
    "Width and height in texels of mip level 0, as floats: Size = (W, H), Width, Height. Always ≥ 0; exactly the dimensions of the bound texture (a power-of-two or non-power-of-two texture alike). Output range: [0, ∞).",
  inputs: [texPort("tex", "Texture")],
  outputs: [outPort("size", "Size", "vec2"), outPort("width", "Width", "float"), outPort("height", "Height", "float")],
  targetNotes: SIZE_NOTE,
  build: (c) => {
    const m = new M(c.b);
    const s = m.w(c.b.textureSize(c.in("tex")));
    return { size: s.id, width: s.x.id, height: s.y.id };
  },
});

const texelSizeNode: NodeDef = baseNode({
  id: "textureTexelSize",
  category: "Texture/Info",
  name: "Texel Size",
  synonyms: ["texel", "pixel size in uv", "one over size", "inverse texture size"],
  description:
    "Size of one texel in UV units: Texel = (1/W, 1/H) of mip level 0 (add it to a UV to step to the neighbouring texel). A zero-sized texture is defined as Texel = (0, 0) (no division by zero). Outputs Width / Height as the texel counts. Output range: (0, 1] for any real texture.",
  inputs: [texPort("tex", "Texture")],
  outputs: [
    outPort("texel", "Texel", "vec2"),
    outPort("width", "Width", "float"),
    outPort("height", "Height", "float"),
  ],
  targetNotes: SIZE_NOTE,
  build: (c) => {
    const m = new M(c.b);
    const s = m.w(c.b.textureSize(c.in("tex")));
    const inv = (v: ReturnType<M["w"]>) => m.sel(v.gt(0), m.f(1).div(m.sel(v.gt(0), v, 1)), 0);
    return { texel: m.v2(inv(s.x), inv(s.y)).id, width: s.x.id, height: s.y.id };
  },
});
export const TEXTURE_BASIC_DEFS: NodeDef[] = [samplerStateNode, textureSizeNode, texelSizeNode];
