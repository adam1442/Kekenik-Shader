import { T } from "../types/generics";
import { defineNode } from "./define";

export const PROPERTY_PARAM = "property";

/** Reads an exposed property (uniform). Its output type follows the property type. */
export const propertyNode = defineNode({
  id: "property",
  category: "Input/Property",
  name: "Property",
  synonyms: ["parameter", "uniform", "exposed"],
  description: "Reads an exposed property from the Blackboard.",
  params: [{ id: PROPERTY_PARAM, label: "Property", control: "string", default: "" }],
  dynamicPorts: (node, ctx) => {
    const p = ctx.graph.properties.find((x) => x.id === node.params[PROPERTY_PARAM]);
    return {
      inputs: [],
      outputs: [
        {
          id: "out",
          name: p?.displayName ?? "Property",
          type: T(p?.type ?? "float"),
          ...(p?.type === "color" || p?.type === "color4"
            ? { tag: { semantic: p.hdr ? ("hdr-color" as const) : ("color" as const) } }
            : {}),
        },
      ],
    };
  },
  validate: (node, ctx) =>
    ctx.graph.properties.some((x) => x.id === node.params[PROPERTY_PARAM])
      ? []
      : [
          {
            code: "E_UNKNOWN_PROPERTY",
            message: `Property "${String(node.params[PROPERTY_PARAM] ?? "")}" does not exist`,
          },
        ],
  build: (c) => ({ out: c.uniform(String(c.node.params[PROPERTY_PARAM])) }),
});

export const sampleTexture2DNode = defineNode({
  id: "sampleTexture2D",
  category: "Input/Texture",
  name: "Sample Texture 2D",
  synonyms: ["texture", "tex2d", "texture sample", "sample gradient", "textureGrad"],
  targets: { backends: ["glsl", "hlsl", "wgsl", "godot", "unity"] },
  targetNotes: {
    all: "Implicit-LOD sampling is fragment-only; Explicit LOD and Gradient (with connected DDX / DDY) work in every stage.",
    glsl: "texture() / textureLod() / textureGrad(); a connected Sampler input cannot be expressed with a combined sampler2D (warning).",
    hlsl: "Texture2D.Sample / SampleLevel / SampleGrad with a separate SamplerState (static check only).",
    wgsl: "textureSample / textureSampleLevel / textureSampleGrad (validated by naga); implicit sampling in the vertex stage falls back to level 0 with a warning.",
  },
  description:
    "Samples a 2D texture. Implicit LOD (hardware derivatives, fragment-only), Explicit LOD (any stage, uses the LOD port) or Gradient (any stage when DDX / DDY are connected: UV derivatives chosen by you; unconnected DDX / DDY default to ddx(UV) / ddy(UV), which makes the node fragment-only). Optional Sampler input overrides the texture's own sampler (not expressible in GLSL: warning). Colour data is returned as stored in the texture (sRGB textures are decoded by the sampler).",
  params: [
    {
      id: "mode",
      label: "Mode",
      control: "enum",
      default: "implicit",
      options: [
        { value: "implicit", label: "Implicit LOD" },
        { value: "lod", label: "Explicit LOD" },
        { value: "grad", label: "Gradient (DDX / DDY)" },
      ],
    },
  ],
  inputs: [
    { id: "tex", name: "Texture", type: T("texture2D") },
    { id: "uv", name: "UV", type: T("vec2"), tag: { semantic: "uv" }, defaultInput: { input: "uv0" } },
    { id: "sampler", name: "Sampler", type: T("sampler"), optional: true },
    { id: "lod", name: "LOD", type: T("float"), default: 0 },
    {
      id: "ddx",
      name: "DDX",
      type: T("vec2"),
      optional: true,
      tooltip: "UV derivative along screen X (Gradient mode). Defaults to ddx(UV).",
    },
    {
      id: "ddy",
      name: "DDY",
      type: T("vec2"),
      optional: true,
      tooltip: "UV derivative along screen Y (Gradient mode). Defaults to ddy(UV).",
    },
  ],
  outputs: [
    { id: "rgba", name: "RGBA", type: T("color4") },
    { id: "rgb", name: "RGB", type: T("color") },
    { id: "a", name: "A", type: T("float") },
  ],
  build: (c) => {
    const raw = c.param<string>("mode");
    const mode = raw === "lod" ? "lod" : raw === "grad" ? "grad" : "implicit";
    const s = c.b.sample({
      tex: c.in("tex"),
      uv: c.in("uv"),
      mode,
      ...(c.connected("sampler") ? { samp: c.in("sampler") } : {}),
      ...(mode === "lod" ? { lod: c.in("lod") } : {}),
      ...(mode === "grad"
        ? {
            ddx: c.connected("ddx") ? c.in("ddx") : c.b.deriv("ddx", c.in("uv")),
            ddy: c.connected("ddy") ? c.in("ddy") : c.b.deriv("ddy", c.in("uv")),
          }
        : {}),
    });
    return { rgba: s, rgb: c.b.swizzle(s, "xyz"), a: c.b.swizzle(s, "w") };
  },
});
