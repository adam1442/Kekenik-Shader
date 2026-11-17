import { COLORS } from "../build/canvas";
import { kit, port } from "./util";

/** Three-colour ramp driven by a 0…1 value (heat maps, fire, smoke tint, energy). Cheap replacement for a gradient texture. */
export const colorRamp3 = () => kit({
  id: "ks_color_ramp3", name: "Color Ramp (3 stops)", color: COLORS.orange,
  inputs: [
    port("t", "Value", "float", "Ramp position, 0 (cold) … 1 (hot).", 0.5),
    port("cold", "Cold", "color", "Colour at 0.", [0.1, 0, 0]),
    port("mid", "Mid", "color", "Colour at 0.5.", [1, 0.3, 0]),
    port("hot", "Hot", "color", "Colour at 1.", [1, 0.9, 0.4]),
  ],
  outputs: [port("color", "Color", "color", "Interpolated colour.")],
  note: "**Color ramp** — `lerp(lerp(cold, mid, smoothstep(0, ½, t)), hot, smoothstep(½, 1, t))`.\nThe colours stay in the caller's colour space (HDR values keep their intensity, so a hot stop above 1 blooms). Use it instead of a gradient texture to keep a shader texture-free.",
}, (b, c) => {
  b.n("s1", "smoothstep", { values: { edge1: 0, edge2: 0.5 } });
  b.n("s2", "smoothstep", { values: { edge1: 0.5, edge2: 1 } });
  b.n("l1", "lerp", {});
  b.n("l2", "lerp", {});
  c.w("inputs.t", "s1.in").w("inputs.t", "s2.in").w("inputs.cold", "l1.a").w("inputs.mid", "l1.b").w("s1.out", "l1.t")
    .w("l1.out", "l2.a").w("inputs.hot", "l2.b").w("s2.out", "l2.t").w("l2.out", "outputs.color");
});

/** Thin-film interference approximation: optical path → cosine palette. */
export const thinFilm = () => kit({
  id: "ks_thin_film", name: "Thin Film", color: COLORS.pink,
  inputs: [
    port("nDotV", "N·V", "float", "Cosine between normal and view direction (saturate(dot(N, V))).", 0.7),
    port("thickness", "Thickness", "float", "Film thickness, arbitrary 0…1 units (vary it with noise for oil-slick patterns).", 0.5),
    port("ior", "IOR", "float", "Refractive index of the film (soap ≈ 1.33, oxide ≈ 2).", 1.5),
    port("bands", "Bands", "float", "Colour cycles per unit of optical path.", 2),
  ],
  outputs: [port("color", "Color", "color", "Interference tint (per-channel cosine, 0…1).")],
  note: "**Thin film** — light reflected from the top and bottom of a film of thickness `d` interferes with path difference `2·n·d·cosθt`, where `cosθt = √(1 − (1 − N·V²)/n²)`.\nEach colour channel has a different wavelength, modelled as phase offsets (0, ⅓, ⅔) of `½ + ½ cos(2π(path·bands + offset))`. Not spectral — an art-directable approximation, cheap and portable.",
}, (b, c) => {
  b.n("nv2", "multiply", {});
  b.n("sin2", "oneMinus", {});
  b.n("n2", "multiply", {});
  b.n("ratio", "divide", {});
  b.n("cosT2", "oneMinus", {});
  b.n("cosT", "sqrt", {});
  b.n("t1", "multiply", {});
  b.n("t2", "multiply", { values: { b: 2 } });
  b.n("path", "multiply", {});
  c.w("inputs.nDotV", "nv2.a").w("inputs.nDotV", "nv2.b").w("nv2.out", "sin2.in").w("inputs.ior", "n2.a").w("inputs.ior", "n2.b")
    .w("sin2.out", "ratio.a").w("n2.out", "ratio.b").w("ratio.out", "cosT2.in").w("cosT2.out", "cosT.in")
    .w("inputs.thickness", "t1.a").w("inputs.ior", "t1.b").w("t1.out", "t2.a").w("t2.out", "path.a").w("cosT.out", "path.b");
  b.n("scaled", "multiply", {});
  c.w("path.out", "scaled.a").w("inputs.bands", "scaled.b");
  b.n("rgb", "combine", {});
  (["r", "g", "b"] as const).forEach((ch, i) => {
    b.n(`off_${ch}`, "add", { values: { b: i / 3 } });
    b.n(`tau_${ch}`, "multiply", { values: { b: 6.28318530718 } });
    b.n(`cos_${ch}`, "cos", {});
    b.n(`hl_${ch}`, "remap", { values: { inMin: -1, inMax: 1, outMin: 0, outMax: 1 } });
    c.w("scaled.out", `off_${ch}.a`).w(`off_${ch}.out`, `tau_${ch}.a`).w(`tau_${ch}.out`, `cos_${ch}.in`).w(`cos_${ch}.out`, `hl_${ch}.in`).w(`hl_${ch}.out`, `rgb.${ch}`);
  });
  c.w("rgb.rgb", "outputs.color");
});

/** Kajiya–Kay anisotropic highlight (hair / brushed metal). */
export const anisoSpec = () => kit({
  id: "ks_aniso_spec", name: "Anisotropic Highlight", color: COLORS.cyan,
  inputs: [
    port("tangent", "Tangent", "vec3", "Brushing direction in world space (mesh tangent).", [1, 0, 0]),
    port("normal", "Normal", "vec3", "World normal (used to shift the highlight along the surface).", [0, 1, 0]),
    port("viewDir", "View Dir", "vec3", "World direction towards the camera.", [0, 0, 1]),
    port("lightDir", "Light Dir", "vec3", "World direction towards the light.", [0, 1, 0]),
    port("exponent", "Exponent", "float", "Highlight tightness (larger = narrower streak).", 60),
    port("shift", "Shift", "float", "Moves the highlight along the normal (−1…1).", 0),
  ],
  outputs: [port("spec", "Highlight", "float", "Highlight intensity ≥ 0 (before light colour / N·L).")],
  note: "**Kajiya–Kay** — with `T' = normalize(T + N·shift)` and half vector `H = normalize(L + V)`: `highlight = (1 − (T'·H)²)^(exponent/2)`.\nThe streak is perpendicular to the brushing direction and stretches along the surface — the signature look of brushed metal. Multiply by the light colour and `saturate(N·L)` outside.",
}, (b, c) => {
  b.n("sh", "multiply", {});
  b.n("tp", "add", {});
  b.n("tn", "normalize", {});
  b.n("lv", "add", {});
  b.n("h", "normalize", {});
  b.n("th", "dot", {});
  b.n("th2", "multiply", {});
  b.n("sinTH2", "oneMinus", {});
  b.n("pos", "maximum", { values: { b: 0.0001 } });
  b.n("half", "multiply", { values: { b: 0.5 } });
  b.n("pw", "power", {});
  c.w("inputs.normal", "sh.a").w("inputs.shift", "sh.b").w("inputs.tangent", "tp.a").w("sh.out", "tp.b").w("tp.out", "tn.in")
    .w("inputs.lightDir", "lv.a").w("inputs.viewDir", "lv.b").w("lv.out", "h.in").w("tn.out", "th.a").w("h.out", "th.b")
    .w("th.out", "th2.a").w("th.out", "th2.b").w("th2.out", "sinTH2.in").w("sinTH2.out", "pos.a").w("inputs.exponent", "half.a")
    .w("pos.out", "pw.a").w("half.out", "pw.b").w("pw.out", "outputs.spec");
});

/** Four-layer height-aware blend (terrain / painted vertex colours): weights are sharpened where a layer's height is above the others. */
export const heightBlend4 = () => kit({
  id: "ks_height_blend4", name: "Height Blend (4 layers)", color: COLORS.green,
  inputs: [
    port("weights", "Weights", "vec4", "Raw layer weights (e.g. painted vertex colour RGBA); need not sum to 1.", [1, 0, 0, 0]),
    port("heights", "Heights", "vec4", "Per-layer height 0…1 (R = layer 1 … A = layer 4), e.g. the albedo luminance.", [0.5, 0.5, 0.5, 0.5]),
    port("depth", "Blend Depth", "float", "Transition depth: 0 = hard height-driven edges, 1 = plain weight blending.", 0.2),
  ],
  outputs: [port("weights", "Weights", "vec4", "Sharpened weights that sum to 1.")],
  note: "**Height blend** — `score = weight + height`; the winning score `m = max(score)` defines a window of size *depth*: `b = saturate(score − (m − depth))`, result `b / Σb`.\nPeaks of a layer (stones, grass tufts) poke through its neighbours instead of fading linearly, which is what makes painted terrain look natural. Four layers cost one add, three maxes, one subtract, one saturate and one divide.",
}, (b, c) => {
  b.n("score", "add", {});
  b.n("sp", "split", {});
  b.n("m1", "maximum", {});
  b.n("m2", "maximum", {});
  b.n("m", "maximum", {});
  b.n("thr", "subtract", {});
  b.n("tv", "combine", {});
  b.n("raw", "subtract", {});
  b.n("pos", "saturate", {});
  b.n("sum", "dot", { values: { b: [1, 1, 1, 1] } });
  b.n("safe", "maximum", { values: { b: 0.0001 } });
  b.n("sv", "combine", {});
  b.n("norm", "divide", {});
  c.w("inputs.weights", "score.a").w("inputs.heights", "score.b").w("score.out", "sp.in").w("sp.r", "m1.a").w("sp.g", "m1.b").w("sp.b", "m2.a").w("sp.a", "m2.b")
    .w("m1.out", "m.a").w("m2.out", "m.b").w("m.out", "thr.a").w("inputs.depth", "thr.b")
    .w("thr.out", "tv.r").w("thr.out", "tv.g").w("thr.out", "tv.b").w("thr.out", "tv.a")
    .w("score.out", "raw.a").w("tv.rgba", "raw.b").w("raw.out", "pos.in").w("pos.out", "sum.a").w("sum.out", "safe.a")
    .w("safe.out", "sv.r").w("safe.out", "sv.g").w("safe.out", "sv.b").w("safe.out", "sv.a").w("pos.out", "norm.a").w("sv.rgba", "norm.b").w("norm.out", "outputs.weights");
});
