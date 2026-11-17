import { COLORS } from "../build/canvas";
import { kit, port } from "./util";

/** One Gerstner wave: horizontal + vertical displacement and the matching normal delta (sum several waves, then normalise). */
export const gerstnerWave = () => kit({
  id: "ks_gerstner_wave", name: "Gerstner Wave", color: COLORS.blue,
  inputs: [
    port("pos", "Position", "vec3", "Rest position (object space; XZ is the water plane).", [0, 0, 0]),
    port("time", "Time", "float", "Seconds.", 0),
    port("dir", "Direction", "vec2", "Travel direction in XZ (normalised inside).", [1, 0]),
    port("steepness", "Steepness", "float", "0 = sine, 1 = sharp crest (sum of all waves should stay ≤ 1).", 0.3),
    port("wavelength", "Wavelength", "float", "Distance between crests.", 2),
  ],
  outputs: [
    port("offset", "Offset", "vec3", "Vertex displacement of this wave."),
    port("nrm", "Normal Delta", "vec3", "Normal contribution: add the deltas of all waves to (0,1,0) and normalise."),
  ],
  note: "**Gerstner wave** — `k = 2π/λ`, phase speed `c = √(g/k)`, `f = k(d·p − c·t)`, amplitude `a = s/k`.\nOffset = `(dx·a·cos f, a·sin f, dz·a·cos f)` — vertices travel in circles, so crests sharpen. Normal delta = `(−dx·s·cos f, −s·sin f, −dz·s·cos f)`.",
}, (b, c) => {
  b.n("k", "divide", { values: { a: 6.28318530718 } });
  b.n("g", "divide", { values: { a: 9.81 } });
  b.n("cs", "sqrt", {});
  b.n("dn", "normalize", {});
  b.n("dsplit", "split", {});
  b.n("psplit", "split", {});
  b.n("xz", "combine", {});
  b.n("proj", "dot", {});
  b.n("ct", "multiply", {});
  b.n("diff", "subtract", {});
  b.n("f", "multiply", {});
  b.n("a", "divide", {});
  b.n("cosf", "cos", {});
  b.n("sinf", "sin", {});
  b.n("ax", "multiply", {});
  b.n("ox", "multiply", {});
  b.n("oy", "multiply", {});
  b.n("az", "multiply", {});
  b.n("oz", "multiply", {});
  b.n("off", "combine", {});
  b.n("sx", "multiply", {});
  b.n("nx0", "multiply", {});
  b.n("nx", "negate", {});
  b.n("ny0", "multiply", {});
  b.n("ny", "negate", {});
  b.n("sz", "multiply", {});
  b.n("nz0", "multiply", {});
  b.n("nz", "negate", {});
  b.n("nrm", "combine", {});
  c.w("inputs.wavelength", "k.b").w("k.out", "g.b").w("g.out", "cs.in").w("inputs.dir", "dn.in").w("dn.out", "dsplit.in").w("inputs.pos", "psplit.in")
    .w("psplit.r", "xz.r").w("psplit.b", "xz.g").w("dn.out", "proj.a").w("xz.rg", "proj.b")
    .w("cs.out", "ct.a").w("inputs.time", "ct.b").w("proj.out", "diff.a").w("ct.out", "diff.b").w("k.out", "f.a").w("diff.out", "f.b")
    .w("inputs.steepness", "a.a").w("k.out", "a.b").w("f.out", "cosf.in").w("f.out", "sinf.in")
    .w("dsplit.r", "ax.a").w("a.out", "ax.b").w("ax.out", "ox.a").w("cosf.out", "ox.b")
    .w("a.out", "oy.a").w("sinf.out", "oy.b")
    .w("dsplit.g", "az.a").w("a.out", "az.b").w("az.out", "oz.a").w("cosf.out", "oz.b")
    .w("ox.out", "off.r").w("oy.out", "off.g").w("oz.out", "off.b").w("off.rgb", "outputs.offset")
    .w("dsplit.r", "sx.a").w("inputs.steepness", "sx.b").w("sx.out", "nx0.a").w("cosf.out", "nx0.b").w("nx0.out", "nx.in")
    .w("inputs.steepness", "ny0.a").w("sinf.out", "ny0.b").w("ny0.out", "ny.in")
    .w("dsplit.g", "sz.a").w("inputs.steepness", "sz.b").w("sz.out", "nz0.a").w("cosf.out", "nz0.b").w("nz0.out", "nz.in")
    .w("nx.out", "nrm.r").w("ny.out", "nrm.g").w("nz.out", "nrm.b").w("nrm.rgb", "outputs.nrm");
});

/** Depth intersection: distance between the scene depth behind this fragment and the fragment itself. */
export const depthIntersect = () => kit({
  id: "ks_depth_intersect", name: "Depth Intersection", color: COLORS.red,
  inputs: [port("distance", "Distance", "float", "World-space reach of the intersection band.", 0.5)],
  outputs: [
    port("fade", "Fade", "float", "0 where geometry touches the surface, 1 at Distance or further behind it."),
    port("gap", "Gap", "float", "Eye-space distance between this fragment and the opaque scene behind it (world units)."),
  ],
  note: "**Depth intersection** — `gap = sceneEyeDepth(screenUV) − thisFragmentEyeDepth`, `fade = saturate(gap / distance)`.\nNeeds the camera depth texture (Unity URP: enable *Depth Texture* in the URP asset; Godot: `hint_depth_texture`). Use `1 − fade` for foam or intersection glow.",
}, (b, c) => {
  b.n("sp", "screenPosition", {});
  b.n("sd", "sceneDepth", {});
  b.n("gap", "subtract", {});
  b.n("dmax", "maximum", { values: { b: 0.0001 } });
  b.n("ratio", "divide", {});
  b.n("fade", "saturate", {});
  c.w("sp.normalized", "sd.uv").w("sd.eye", "gap.a").w("sp.eyeDepth", "gap.b").w("inputs.distance", "dmax.a")
    .w("gap.out", "ratio.a").w("dmax.out", "ratio.b").w("ratio.out", "fade.in")
    .w("fade.out", "outputs.fade").w("gap.out", "outputs.gap");
});
