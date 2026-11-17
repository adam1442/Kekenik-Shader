import type { NodeDef } from "../../registry/nodeDef";
import { baseNode, enumParam } from "../kit";
import { M } from "../procedural/irm";
import { floatPort, outPort } from "../procedural/ports";
import { PORTABLE, colorOut, colorPort, rgbOf, rgbPort, vec3Port } from "./common";
import { LUMA_OPTIONS, type LumaWeights, hsvToRgb, luma, rgbToHsv } from "./colorMath";

const NOTE = { all: PORTABLE.all };
const ALPHA = " Alpha is passed through unchanged.";

const hsvAdjustNode: NodeDef = baseNode({
  id: "colorHsvAdjust",
  category: "Color/Adjust",
  name: "HSV Adjust",
  synonyms: ["hue shift", "saturation", "color grading", "hsv adjust", "hue rotate"],
  description:
    "Shifts Hue (degrees or turns, wraps around the colour wheel), multiplies Saturation (1 = unchanged, 0 = grey; the result is clamped to 0…1) and multiplies Value (1 = unchanged; NOT clamped, HDR-safe). Works on RGB values as given (apply it in the space you grade in, usually sRGB-encoded). Greys stay grey under hue shifts (hue is undefined there and ignored)." +
    ALPHA,
  inputs: [
    colorPort("in", "In", [1, 0.5, 0.2, 1]),
    floatPort("hue", "Hue", 0, "Hue shift (see Hue unit)."),
    floatPort("saturation", "Saturation", 1),
    floatPort("value", "Value", 1),
  ],
  outputs: [colorOut()],
  params: [
    enumParam(
      "unit",
      "Hue unit",
      [
        ["degrees", "Degrees"],
        ["turns", "Turns"],
      ],
      "degrees",
    ),
  ],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const v = m.w(c.in("in"));
    const { h, s, v: val } = rgbToHsv(m, rgbOf(v));
    const shift = c.param("unit") === "turns" ? m.w(c.in("hue")) : m.w(c.in("hue")).div(360);
    return {
      out: m.vec(
        "vec4",
        hsvToRgb(m, h.add(shift).fract(), s.mul(m.w(c.in("saturation"))).clamp(0, 1), val.mul(m.w(c.in("value")))),
        v.w,
      ).id,
    };
  },
});

const contrastNode: NodeDef = baseNode({
  id: "colorContrast",
  category: "Color/Adjust",
  name: "Contrast",
  synonyms: ["contrast", "levels contrast", "pivot contrast", "punch"],
  description:
    "Out = (In − Pivot)·Contrast + Pivot per RGB channel. Contrast 1 = identity, 0 = flat Pivot colour, > 1 expands, < 0 inverts around the pivot. The default pivot 0.5 suits sRGB-encoded values; for LINEAR values use ~0.18 (mid grey). Result is not clamped (HDR-safe, may leave 0…1)." +
    ALPHA,
  inputs: [
    colorPort("in", "In", [0.4, 0.5, 0.6, 1]),
    floatPort("contrast", "Contrast", 1.2),
    floatPort("pivot", "Pivot", 0.5),
  ],
  outputs: [colorOut()],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const v = m.w(c.in("in"));
    return {
      out: m.vec(
        "vec4",
        rgbOf(v)
          .sub(m.w(c.in("pivot")))
          .mul(m.w(c.in("contrast")))
          .add(m.w(c.in("pivot"))),
        v.w,
      ).id,
    };
  },
});

const channelMixerNode: NodeDef = baseNode({
  id: "colorChannelMixer",
  category: "Color/Adjust",
  name: "Channel Mixer",
  synonyms: ["color matrix", "rgb mixer", "channel swap", "monochrome mixer"],
  description:
    "Each output channel is a weighted sum of the input RGB: R' = dot(RGB, Red Out), G' = dot(RGB, Green Out), B' = dot(RGB, Blue Out). Identity = (1,0,0), (0,1,0), (0,0,1); swapping weights swaps channels; weights summing to 1 preserve brightness of greys. Monochrome writes dot(RGB, Red Out) to all three channels (Photoshop style). Not clamped (negative weights allowed)." +
    ALPHA,
  inputs: [
    colorPort("in", "In", [0.8, 0.5, 0.2, 1]),
    vec3Port("r", "Red Out", [1, 0, 0]),
    vec3Port("g", "Green Out", [0, 1, 0]),
    vec3Port("b", "Blue Out", [0, 0, 1]),
  ],
  outputs: [colorOut()],
  params: [{ id: "monochrome", label: "Monochrome", control: "bool", default: false }],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const v = m.w(c.in("in")),
      rgb = rgbOf(v);
    const r = rgb.dot(m.w(c.in("r")));
    const out =
      c.param("monochrome") === true ? r.splat("vec3") : m.v3(r, rgb.dot(m.w(c.in("g"))), rgb.dot(m.w(c.in("b"))));
    return { out: m.vec("vec4", out, v.w).id };
  },
});

const posterizeNode: NodeDef = baseNode({
  id: "colorPosterize",
  category: "Color/Adjust",
  name: "Posterize",
  synonyms: ["quantize", "color steps", "reduce colors", "banding", "cel bands"],
  description:
    "Quantises each RGB channel to L = max(floor(Steps), 2) levels after saturating it to 0…1. Round: round(c·(L − 1))/(L − 1) — levels 0, 1/(L−1), … 1 including exact black and white; band edges at (k + ½)/(L − 1). Floor: floor(c·L)/L — L bands whose lower edge is k/L (c = 1 maps to 1). Deterministic: edges use floor(x + ½), never a backend-dependent round()." +
    ALPHA,
  inputs: [colorPort("in", "In", [0.5, 0.5, 0.5, 1]), floatPort("steps", "Steps", 4)],
  outputs: [colorOut()],
  params: [
    enumParam(
      "mode",
      "Mode",
      [
        ["round", "Round (includes 0 and 1)"],
        ["floor", "Floor (bands)"],
      ],
      "round",
    ),
  ],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const v = m.w(c.in("in")),
      x = rgbOf(v).clamp(0, 1);
    const l = m.w(c.in("steps")).floor().max(2);
    const q = c.param("mode") === "floor" ? x.mul(l).floor().div(l) : x.mul(l.sub(1)).add(0.5).floor().div(l.sub(1));
    return { out: m.vec("vec4", q, v.w).id };
  },
});

const invertNode: NodeDef = baseNode({
  id: "colorInvert",
  category: "Color/Adjust",
  name: "Invert Color",
  synonyms: ["negative", "invert color", "inverse color", "color negative"],
  description:
    "Colour-aware invert: RGB mode gives 1 − c per channel (Amount blends from the original to the inverse); Value mode keeps hue and saturation and inverts only the HSV value (V' = 1 − saturate(V)). Alpha is kept unless Invert alpha is on. For a plain per-channel flip of any vector use Flip.",
  inputs: [colorPort("in", "In", [0.9, 0.4, 0.1, 1]), floatPort("amount", "Amount", 1)],
  outputs: [colorOut()],
  params: [
    enumParam(
      "mode",
      "Mode",
      [
        ["rgb", "RGB"],
        ["value", "Value only (keep hue)"],
      ],
      "rgb",
    ),
    { id: "invertAlpha", label: "Invert alpha", control: "bool", default: false },
  ],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const v = m.w(c.in("in")),
      rgb = rgbOf(v);
    let inv: ReturnType<M["w"]>;
    if (c.param("mode") === "value") {
      const { h, s, v: val } = rgbToHsv(m, rgb);
      inv = hsvToRgb(m, h, s, m.f(1).sub(val.saturate()));
    } else inv = m.k("vec3", 1, 1, 1).sub(rgb);
    const a = c.param("invertAlpha") === true ? m.f(1).sub(v.w) : v.w;
    return { out: m.vec("vec4", rgb.mix(inv, m.w(c.in("amount"))), a).id };
  },
});

const whiteBalanceNode: NodeDef = baseNode({
  id: "colorWhiteBalance",
  category: "Color/Adjust",
  name: "White Balance",
  synonyms: ["color temperature", "kelvin", "tint temperature", "warm cool"],
  description:
    "Shifts the colour temperature (negative = cooler / bluer, positive = warmer / yellower) and tint (negative = greener, positive = magenta) in LMS cone space, as in Unity's White Balance. Expects LINEAR RGB. Temperature and Tint are clamped to −100…100. Both 0 is the identity to within ~1e-3 (the reference white points differ by that much). Alpha untouched. Output is not clamped.",
  inputs: [
    colorPort("in", "In", [0.5, 0.5, 0.5, 1], "LINEAR colour."),
    floatPort("temperature", "Temperature", 0),
    floatPort("tint", "Tint", 0),
  ],
  outputs: [colorOut()],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const v = m.w(c.in("in")),
      rgb = rgbOf(v);
    const t1 = m.w(c.in("temperature")).clamp(-100, 100).div(65),
      t2 = m.w(c.in("tint")).clamp(-100, 100).div(65);
    const x = m.f(0.31271).sub(t1.mul(m.sel(t1.lt(0), 0.1, 0.05)));
    const y = x.mul(2.87).sub(x.mul(x).mul(3)).sub(0.27509507).add(t2.mul(0.05));
    const X = x.div(y),
      Z = m.f(1).sub(x).sub(y).div(y);
    const L = X.mul(0.7328).add(0.4296).sub(Z.mul(0.1624));
    const Mm = X.mul(-0.7036).add(1.6975).add(Z.mul(0.0061));
    const S = X.mul(0.003).add(0.0136).add(Z.mul(0.9834));
    const bal = m.v3(m.f(0.949237).div(L), m.f(1.03542).div(Mm), m.f(1.08728).div(S));
    const d = (a: number, b: number, e: number) => rgb.dot(m.k("vec3", a, b, e));
    const lms = m
      .v3(
        d(3.90405e-1, 5.49941e-1, 8.92632e-3),
        d(7.08416e-2, 9.63172e-1, 1.35775e-3),
        d(2.31082e-2, 1.28021e-1, 9.36245e-1),
      )
      .mul(bal);
    const e = (a: number, b: number, k: number) => lms.dot(m.k("vec3", a, b, k));
    return {
      out: m.vec(
        "vec4",
        m.v3(e(2.85847, -1.62879, -2.4891e-2), e(-2.10182e-1, 1.1582, 3.24281e-4), e(-4.1812e-2, -1.18169e-1, 1.06867)),
        v.w,
      ).id,
    };
  },
});

const grayscaleNode: NodeDef = baseNode({
  id: "colorGrayscale",
  category: "Color/Adjust",
  name: "Grayscale",
  synonyms: ["desaturate", "black and white", "luminance", "luma", "monochrome"],
  description:
    "Luminance = dot(RGB, weights): Rec.709 (0.2126, 0.7152, 0.0722 — correct for LINEAR light), Rec.601 (0.299, 0.587, 0.114 — classic, used on encoded values) or the plain average. Out = lerp(In, grey, Amount) (Amount 1 = fully grey, 0 = unchanged, > 1 over-desaturates). Luma output is the luminance as a float; a grey input returns itself for weights that sum to 1. Alpha untouched.",
  inputs: [colorPort("in", "In", [0.9, 0.4, 0.1, 1]), floatPort("amount", "Amount", 1)],
  outputs: [colorOut(), outPort("luma", "Luma", "float")],
  params: [enumParam("weights", "Weights", LUMA_OPTIONS, "rec709")],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const v = m.w(c.in("in")),
      rgb = rgbOf(v);
    const l = luma(m, rgb, c.param<LumaWeights>("weights"));
    return { out: m.vec("vec4", rgb.mix(l.splat("vec3"), m.w(c.in("amount"))), v.w).id, luma: l.id };
  },
});

const tintNode: NodeDef = baseNode({
  id: "colorTint",
  category: "Color/Adjust",
  name: "Tint",
  synonyms: ["colorize", "color overlay", "tint color", "sepia", "duotone tint"],
  description:
    "Multiply: RGB·Tint (white = unchanged, darkens). Colorize: Rec.709 luminance·Tint (replaces the hue, keeps the brightness — sepia, monotone). Out = lerp(In, tinted, Amount); Amount is not clamped. Values are used as given — tint in the same colour space as the input. Alpha untouched.",
  inputs: [
    colorPort("in", "In", [0.8, 0.8, 0.8, 1]),
    rgbPort("tint", "Tint", [1, 0.75, 0.5]),
    floatPort("amount", "Amount", 1),
  ],
  outputs: [colorOut()],
  params: [
    enumParam(
      "mode",
      "Mode",
      [
        ["multiply", "Multiply"],
        ["colorize", "Colorize (luminance × tint)"],
      ],
      "multiply",
    ),
  ],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const v = m.w(c.in("in")),
      rgb = rgbOf(v),
      tint = m.w(c.in("tint"));
    const tinted = c.param("mode") === "colorize" ? luma(m, rgb, "rec709").splat("vec3").mul(tint) : rgb.mul(tint);
    return { out: m.vec("vec4", rgb.mix(tinted, m.w(c.in("amount"))), v.w).id };
  },
});
export const COLOR_ADJUST_DEFS: NodeDef[] = [
  hsvAdjustNode,
  contrastNode,
  channelMixerNode,
  posterizeNode,
  invertNode,
  whiteBalanceNode,
  grayscaleNode,
  tintNode,
];
