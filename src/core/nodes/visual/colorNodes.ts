import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { baseNode, enumParam } from "../kit";
import { M } from "../procedural/irm";
import { floatPort, outPort } from "../procedural/ports";
import { PORTABLE, colorOut, colorPort, rgbOf, rgbPort } from "./common";
import {
  BLEND_MODE_LIST,
  type BlendMode,
  blendRgb,
  emitLinearToSrgb,
  emitSrgbToLinear,
  hsvToRgb,
  rgbToHsv,
} from "./colorMath";

const NOTE = { all: PORTABLE.all };

const colorBlendNode: NodeDef = baseNode({
  id: "colorBlend",
  category: "Color/Blend",
  name: "Blend",
  synonyms: [
    "blend modes",
    "photoshop blend",
    "layer blend",
    "multiply blend",
    "screen blend",
    "overlay",
    "soft light",
    "color dodge",
    "color burn",
    "linear burn",
  ],
  description:
    "Combines Base (backdrop Cb) and Blend (source Cs) with one of 16 separable modes (W3C formulas): Multiply, Screen, Overlay, Soft Light, Hard Light, Color Dodge, Color Burn, Darken, Lighten, Difference, Exclusion, Add (unclamped), Subtract (unclamped), Divide (unclamped; Cs = 0 gives 1 where Cb > 0, else 0), Linear Dodge (min(Cb + Cs, 1)), Linear Burn (max(Cb + Cs − 1, 0)). Overlay, Soft Light, Hard Light, Dodge and Burn SATURATE both operands to 0…1 first; other modes accept HDR. RGB = lerp(Base, B(Base, Blend), Opacity·Blend.a) — Opacity is not clamped. Alpha: Base keeps Base.a; Over = Base.a + a·(1 − Base.a) with a = saturate(Opacity·Blend.a). Colour space: operate on values of ONE space (usually sRGB-encoded for Photoshop-like looks, linear for physically-based mixing).",
  inputs: [
    colorPort("base", "Base", [0.5, 0.5, 0.5, 1]),
    colorPort("blend", "Blend", [0.8, 0.4, 0.2, 1]),
    floatPort("opacity", "Opacity", 1),
  ],
  outputs: [colorOut()],
  params: [
    enumParam("mode", "Mode", BLEND_MODE_LIST, "multiply"),
    enumParam(
      "alpha",
      "Alpha",
      [
        ["base", "Keep base alpha"],
        ["over", "Source-over"],
      ],
      "base",
    ),
  ],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const base = m.w(c.in("base")),
      src = m.w(c.in("blend"));
    const f = m.w(c.in("opacity")).mul(src.w);
    const blended = blendRgb(m, c.param<BlendMode>("mode"), rgbOf(base), rgbOf(src));
    const rgb = rgbOf(base).mix(blended, f);
    const a = c.param("alpha") === "over" ? base.w.add(f.saturate().mul(m.f(1).sub(base.w))) : base.w;
    return { out: m.vec("vec4", rgb, a).id };
  },
});

const rgbToHsvNode: NodeDef = baseNode({
  id: "colorRgbToHsv",
  category: "Color/Convert",
  name: "RGB → HSV",
  synonyms: ["rgb to hsv", "hue saturation value", "to hsv"],
  description:
    "Converts RGB to HSV: H in turns [0, 1) (red 0, green ⅓, blue ⅔), S = (max − min)/max in [0, 1], V = max(r, g, b) (unbounded for HDR). Greys and black are STABLE: S = 0 and H = 0 (no division by zero). Hue is exactly 0 for pure red and wraps continuously through 1 → 0. Values are used as given: convert to the colour space you want the hue in first.",
  inputs: [rgbPort("in", "RGB", [1, 0.5, 0])],
  outputs: [
    { id: "hsv", name: "HSV", type: T("vec3") },
    outPort("h", "H", "float"),
    outPort("s", "S", "float"),
    outPort("v", "V", "float"),
  ],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const { h, s, v } = rgbToHsv(m, m.w(c.in("in")));
    return { hsv: m.v3(h, s, v).id, h: h.id, s: s.id, v: v.id };
  },
});

const hsvToRgbNode: NodeDef = baseNode({
  id: "colorHsvToRgb",
  category: "Color/Convert",
  name: "HSV → RGB",
  synonyms: ["hsv to rgb", "from hsv", "hue to color"],
  description:
    "Converts HSV to RGB. H is in turns and WRAPS (any real number: −0.25 ≡ 0.75, 1 ≡ 0); S is used as given (S > 1 over-saturates and can produce negative channels); V scales the result (HDR allowed). S = 0 gives the grey (V, V, V). Inverse of RGB → HSV for S in [0, 1].",
  inputs: [{ id: "in", name: "HSV", type: T("vec3"), default: [0.08, 1, 1] }],
  outputs: [{ id: "out", name: "RGB", type: T("color") }],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const v = m.w(c.in("in"));
    return { out: hsvToRgb(m, v.x, v.y, v.z).id };
  },
});

const srgbToLinearNode: NodeDef = baseNode({
  id: "colorSrgbToLinear",
  category: "Color/Convert",
  name: "Convert sRGB → Linear",
  synonyms: ["srgb to linear", "gamma to linear", "decode srgb", "remove gamma"],
  description:
    "Decodes sRGB-encoded colour to linear light with the EXACT IEC 61966-2-1 curve (c ≤ 0.04045 → c/12.92, else ((c + 0.055)/1.055)^2.4) — not a 2.2 power approximation. Expects ENCODED input (e.g. a colour picked in the UI or an sRGB texture sampled without hardware decode); alpha is untouched. Negative values are mirrored (odd extension), so the result is always finite. 0 → 0 and 1 → 1 exactly. (At the 0.04045 knee the two branches differ by ~2e-9 — the standard's own constant rounding.)",
  inputs: [colorPort("in", "In", [0.5, 0.5, 0.5, 1])],
  outputs: [colorOut()],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const v = m.w(c.in("in"));
    return { out: m.vec("vec4", emitSrgbToLinear(m, rgbOf(v)), v.w).id };
  },
});

const linearToSrgbNode: NodeDef = baseNode({
  id: "colorLinearToSrgb",
  category: "Color/Convert",
  name: "Convert Linear → sRGB",
  synonyms: ["linear to srgb", "linear to gamma", "encode srgb", "apply gamma"],
  description:
    "Encodes linear light to sRGB with the EXACT IEC 61966-2-1 curve (c ≤ 0.0031308 → 12.92·c, else 1.055·c^(1/2.4) − 0.055). Expects LINEAR input; alpha is untouched. Values above 1 (HDR) are encoded as-is (not clamped); negative values are mirrored, so the result is always finite. Exact inverse of sRGB → Linear. 0 → 0 and 1 → 1. (At the 0.0031308 knee the two branches differ by ~3e-8.)",
  inputs: [colorPort("in", "In", [0.2, 0.2, 0.2, 1])],
  outputs: [colorOut()],
  targetNotes: NOTE,
  build: (c) => {
    const m = new M(c.b);
    const v = m.w(c.in("in"));
    return { out: m.vec("vec4", emitLinearToSrgb(m, rgbOf(v)), v.w).id };
  },
});

export const COLOR_BASIC_DEFS: NodeDef[] = [
  colorBlendNode,
  rgbToHsvNode,
  hsvToRgbNode,
  srgbToLinearNode,
  linearToSrgbNode,
];
