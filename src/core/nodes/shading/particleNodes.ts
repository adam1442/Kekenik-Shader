import type { BuildContext, NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { enumParam } from "../kit";
import { M, type V } from "../procedural/irm";
import { hash11 } from "../procedural/hash";
import { floatPort, outPort } from "../procedural/ports";
import { SAMPLING_PARAM, colorPort, fetch, lodPort, texPort, uvPort } from "../visual/common";
import { emitSrgbToLinear } from "../visual/colorMath";
import { noteAll, shNode } from "./common";

/**
 * Particle & sprite DATA nodes. Particle data that is not a built-in vertex attribute travels in CUSTOM VERTEX STREAMS, which the
 * portable IR exposes as the UV channels uv1…uv3 (xy each). The exporter / engine must route the stream there:
 *   Unity URP: Particle System › Renderer › Custom Vertex Streams (add e.g. "Age Percent" → TEXCOORD1.x, "Stable Random" → TEXCOORD1.y).
 *   Godot 4:   GPUParticles3D / CPUParticles + a vertex() that copies INSTANCE_CUSTOM (age = CUSTOM.y, seed = CUSTOM.x) into UV2.
 * Colour needs no stream: the particle system writes it to the vertex colour attribute.
 */
const STREAM_OPTIONS: Array<[string, string]> = ["uv1.x", "uv1.y", "uv2.x", "uv2.y", "uv3.x", "uv3.y"].map((s) => [
  s,
  `${s.toUpperCase().replace("UV", "UV")} (TEXCOORD${s[2]}.${s[4]})`,
]);
const streamParam = (def: string) => enumParam("stream", "Stream", STREAM_OPTIONS, def);
const STREAM_NOTES = {
  all: "Needs a CUSTOM VERTEX STREAM carrying the value in the chosen UV channel. Unity URP: Particle System › Renderer › Custom Vertex Streams (TEXCOORDn.x/y). Godot: copy INSTANCE_CUSTOM into UV / UV2 in vertex().",
  unity:
    "Add the stream in the Particle System renderer (Custom Vertex Streams) so it lands in the TEXCOORD channel selected here; the generic stream order is shown in the renderer's warning if it mismatches.",
  godot: "Write the value into UV / UV2 from INSTANCE_CUSTOM in a vertex() function.",
};

/** Value of the chosen custom stream (a float). */
function streamValue(c: BuildContext, m: M): V {
  const s = c.param<string>("stream");
  const input = s.slice(0, 3) as "uv1" | "uv2" | "uv3";
  return m.w(c.b.input(input)).sw(s[4] === "y" ? "y" : "x");
}

const particleColorNode: NodeDef = shNode({
  id: "particleColor",
  category: "Particle/Data",
  name: "Particle Color",
  synonyms: ["particle tint", "particle vertex tint", "start color over lifetime"],
  description:
    "Per-particle colour written by the particle system to the VERTEX COLOUR attribute (start colour × colour over lifetime), interpolated across the quad. RGBA 0…1. Colour space = As Is (the engine's vertex-colour value, normally already usable in the shader) or sRGB → Linear (use when the particle colours are authored / stored in sRGB and the shader works in linear light). Alpha is never converted. No custom stream needed.",
  outputs: [
    { id: "rgba", name: "RGBA", type: T("color4") },
    { id: "rgb", name: "RGB", type: T("color") },
    outPort("a", "A", "float"),
  ],
  params: [
    enumParam(
      "space",
      "Colour space",
      [
        ["asIs", "As is"],
        ["srgbToLinear", "sRGB → Linear"],
      ],
      "asIs",
    ),
  ],
  capabilities: ["vertexColor"],
  targetNotes: noteAll(
    "Vertex colour attribute (a_color / COLOR). Unity URP: Particle System writes it automatically; Godot: COLOR.",
  ),
  build: (c) => {
    const m = new M(c.b);
    const v = m.w(c.b.input("vertexColor"));
    const rgb = c.param<string>("space") === "srgbToLinear" ? emitSrgbToLinear(m, v.sw("xyz")) : v.sw("xyz");
    return { rgba: m.vec("vec4", rgb, v.w).id, rgb: rgb.id, a: v.w.id };
  },
});

const particleAgeNode: NodeDef = shNode({
  id: "particleAge",
  category: "Particle/Data",
  name: "Particle Age",
  synonyms: ["age percent", "normalized age", "lifetime progress", "particle life"],
  description:
    "Age of the particle read from a custom vertex stream. Normalized = 0 (just born) … 1 (end of life), clamped. Seconds = absolute age in seconds (≥ 0). Stream mode Normalized: the stream already holds age / lifetime (Unity 'Age Percent'); Seconds = Normalized · Lifetime. Stream mode Absolute: the stream holds seconds (Unity 'Age'); Normalized = saturate(age / Lifetime). Lifetime ≤ 1e-6 is treated as 1e-6 (so Normalized snaps to 1 for any positive age, never NaN). Lifetime is only needed to convert between the two.",
  inputs: [
    floatPort("lifetime", "Lifetime", 1, "Particle lifetime in seconds (conversion between normalized and absolute)."),
  ],
  outputs: [outPort("normalized", "Normalized", "float"), outPort("seconds", "Seconds", "float")],
  params: [
    streamParam("uv1.x"),
    enumParam(
      "mode",
      "Stream holds",
      [
        ["normalized", "Normalized age (0…1)"],
        ["absolute", "Absolute age (seconds)"],
      ],
      "normalized",
    ),
  ],
  capabilities: ["customVertexStreams"],
  targetNotes: STREAM_NOTES,
  build: (c) => {
    const m = new M(c.b);
    const s = streamValue(c, m);
    const life = m.w(c.in("lifetime")).max(1e-6);
    if (c.param<string>("mode") === "absolute") {
      const sec = s.max(0);
      return { normalized: sec.div(life).saturate().id, seconds: sec.id };
    }
    const n = s.saturate();
    return { normalized: n.id, seconds: n.mul(life).id };
  },
});

const particleRandomNode: NodeDef = shNode({
  id: "particleRandom",
  category: "Particle/Data",
  name: "Particle Random",
  synonyms: ["stable random", "per particle random", "random seed per particle", "particle seed"],
  description:
    "Deterministic per-particle random number in [0, 1). Hash mode: the stream carries a STABLE per-particle value (Unity 'Stable Random' / any id) which is hashed together with the Seed with a sine-free float hash — the same (stream, seed) always gives the same result, different seeds decorrelate several uses of one stream. Direct mode: the stream is already uniform 0…1 and is passed through (clamped to 0…1; Seed ignored). Signed = Value · 2 − 1.",
  inputs: [floatPort("seed", "Seed", 0, "Decorrelates several random values from one stream (Hash mode).")],
  outputs: [outPort("value", "Value", "float"), outPort("signed", "Signed", "float")],
  params: [
    streamParam("uv1.y"),
    enumParam(
      "mode",
      "Stream holds",
      [
        ["hash", "Stable id / seed (hashed)"],
        ["direct", "Uniform random 0…1"],
      ],
      "hash",
    ),
  ],
  capabilities: ["customVertexStreams"],
  targetNotes: STREAM_NOTES,
  build: (c) => {
    const m = new M(c.b);
    const s = streamValue(c, m);
    const v =
      c.param<string>("mode") === "direct" ? s.saturate() : hash11(m, s.add(m.w(c.in("seed")).mul(37.719)).add(1.3));
    return { value: v.id, signed: v.mul(2).sub(1).id };
  },
});

const ALPHA_MODE = enumParam(
  "alpha",
  "Alpha",
  [
    ["straight", "Straight (un-premultiplied)"],
    ["premultiplied", "Premultiplied"],
  ],
  "straight",
);

const spriteTextureNode: NodeDef = shNode({
  id: "spriteTexture",
  category: "Sprite/Basic",
  name: "Sprite Texture",
  synonyms: ["sprite sample", "sprite renderer texture", "main texture sprite", "2d texture"],
  description:
    "Samples a sprite texture at UV (UV origin bottom-left, V up, the sprite sheet frame is the caller's UV). RGBA 0…1 as stored. Outside = Sampler (the texture wrap mode decides) or Transparent (alpha forced to 0 outside the 0…1 UV square — use it after UV offsets / flips so a Repeat wrap never smears the sprite). Alpha = Straight (output as stored) or Premultiplied (the texture stores premultiplied colour: RGB is un-premultiplied here, alpha 0 → RGB 0, so downstream tint / flash maths is always on straight colour). Colour space is not converted.",
  inputs: [texPort("tex", "Texture"), uvPort(), lodPort(0)],
  outputs: [
    { id: "rgba", name: "RGBA", type: T("color4") },
    { id: "rgb", name: "RGB", type: T("color") },
    outPort("a", "A", "float"),
  ],
  params: [
    ALPHA_MODE,
    enumParam(
      "outside",
      "Outside 0…1",
      [
        ["sampler", "Use sampler wrap"],
        ["transparent", "Transparent"],
      ],
      "sampler",
    ),
    SAMPLING_PARAM,
  ],
  targetNotes: noteAll(
    "Texture sampling: implicit LOD in the fragment stage, Explicit LOD (Sampling param) in any stage.",
  ),
  build: (c) => {
    const m = new M(c.b);
    const uv = m.w(c.in("uv"));
    const t = fetch(c, m, c.in("tex"), uv);
    let rgb = t.sw("xyz");
    let a = t.w;
    if (c.param<string>("alpha") === "premultiplied")
      rgb = m.sel(a.gt(1e-6), rgb.div(m.sel(a.gt(1e-6), a, 1)), m.k("vec3", 0, 0, 0));
    if (c.param<string>("outside") === "transparent") {
      const inside = m.and(m.and(uv.x.ge(0), uv.x.le(1)), m.and(uv.y.ge(0), uv.y.le(1)));
      a = m.sel(inside, a, 0);
    }
    return { rgba: m.vec("vec4", rgb, a).id, rgb: rgb.id, a: a.id };
  },
});

const spriteTintNode: NodeDef = shNode({
  id: "spriteTint",
  category: "Sprite/Basic",
  name: "Sprite Tint",
  synonyms: ["sprite color tint", "sprite renderer color", "modulate sprite"],
  description:
    "Multiplies a sprite colour by a tint (the SpriteRenderer colour / vertex colour). Straight alpha: RGB = Sprite.rgb · Tint.rgb, A = Sprite.a · Tint.a. Premultiplied alpha: RGB = Sprite.rgb · Tint.rgb · Tint.a (keeps the colour premultiplied), A = Sprite.a · Tint.a. Components stay unclamped (HDR tints > 1 allowed); alpha is clamped to 0…1. A white opaque tint is the identity.",
  inputs: [colorPort("color", "Sprite"), colorPort("tint", "Tint", [1, 1, 1, 1])],
  outputs: [{ id: "out", name: "Out", type: T("color4") }],
  params: [ALPHA_MODE],
  targetNotes: noteAll(),
  build: (c) => {
    const m = new M(c.b);
    const s = m.w(c.in("color"));
    const t = m.w(c.in("tint"));
    let rgb = s.sw("xyz").mul(t.sw("xyz"));
    if (c.param<string>("alpha") === "premultiplied") rgb = rgb.mul(t.w.saturate());
    return { out: m.vec("vec4", rgb, s.w.mul(t.w).saturate()).id };
  },
});

const spriteFlipNode: NodeDef = shNode({
  id: "spriteFlip",
  category: "Sprite/Basic",
  name: "Sprite Flip",
  synonyms: ["flip x", "flip y", "mirror sprite", "sprite mirror"],
  description:
    "Mirrors UVs inside a sprite RECT (xy = min corner, zw = size, default the whole 0…1 texture, for atlas frames pass the frame rect). Flip X / Flip Y are 0 or 1 (≥ 0.5 = on, so a float property / SpriteRenderer flag drives it). local = (UV − min) / size; flipped = 1 − local; UV' = min + local · size, so the sprite keeps its place inside the rect and the pivot is the rect centre. Size components ≤ 1e-6 leave that axis unchanged. UV origin bottom-left. Alpha is untouched (flip only moves UVs).",
  inputs: [
    uvPort(),
    floatPort("flipX", "Flip X", 0),
    floatPort("flipY", "Flip Y", 0),
    {
      id: "rect",
      name: "Rect",
      type: T("vec4"),
      default: [0, 0, 1, 1],
      tooltip: "Sprite frame: x, y = min UV, z, w = size.",
    },
  ],
  outputs: [outPort("out", "UV", "vec2")],
  targetNotes: noteAll(),
  build: (c) => {
    const m = new M(c.b);
    const uv = m.w(c.in("uv"));
    const r = m.w(c.in("rect"));
    const axis = (u: V, mn: V, sz: V, flip: V): V => {
      const ok = sz.gt(1e-6);
      const safe = m.sel(ok, sz, 1);
      const local = u.sub(mn).div(safe);
      return m.sel(ok, mn.add(m.sel(flip.ge(0.5), m.f(1).sub(local), local).mul(safe)), u);
    };
    return { out: m.v2(axis(uv.x, r.x, r.z, m.w(c.in("flipX"))), axis(uv.y, r.y, r.w, m.w(c.in("flipY")))).id };
  },
});

export const PARTICLE_DEFS: NodeDef[] = [
  particleColorNode,
  particleAgeNode,
  particleRandomNode,
  spriteTextureNode,
  spriteTintNode,
  spriteFlipNode,
];
