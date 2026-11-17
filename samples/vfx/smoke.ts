import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { depthIntersect } from "../lib";
import { smokeTex } from "../textures/gen-fx";
import { defineMeta } from "../3d/common";
import { GODOT_VFX, VFX_PROFILE, envelope } from "./common";

const meta = defineMeta({
  id: "vfx-smoke", title: "Soft Smoke",
  description: "Billowing smoke puffs: two rotating, drifting layers of tileable noise form the body, a round falloff keeps the quad edge invisible, the cloud erodes into wisps as the particle ages, and soft depth fading removes the hard intersection with geometry.",
  tags: ["smoke", "soft-particles", "erosion", "billow", "particles", "vfx"], category: "VFX / Particles", difficulty: "Intermediate", targets: ["glsl", "unity", "godot"],
  compatNotes: ["Needs the scene depth texture (Unity URP asset → Depth Texture on; Godot hint_depth_texture). Not available in the HLSL / WGSL snippet targets.", "Particle colour multiplies the smoke tint and its alpha drives the fade-in / fade-out; the per-particle random number rotates and offsets the noise so puffs never repeat."],
  requiredFeatures: ["URP Depth Texture"], budgetClass: "Mobile", godotProfile: GODOT_VFX, reusableSubgraphs: ["ks_depth_intersect"],
  previewConfig: {
    mode: "vfx", mesh: "quad", background: { mode: "gradient", ground: "grid" },
    emitter: { rate: 14, lifetime: 3.6, lifetimeVar: 0.25, sizeStart: 0.55, sizeEnd: 1.9, speed: 0.45, spread: 12, gravity: [0, 0.14, 0], maxParticles: 80, colorOverLife: envelope(0.85, 0.18) },
    intersector: { kind: "sphere", position: [0.2, 0.15, 0], scale: 0.4 }, simulation: { depthTexture: true, opaqueTexture: true },
  },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: VFX_PROFILE, settings: { blend: "alpha", zwrite: "off", cull: "off" } });
  s.add(
    P.tex("smokeMap", "Smoke Noise", { default: "grey", tooltip: "Tileable cloud noise (grey). Import as linear data, wrap mode Repeat.", category: "Shape" }),
    P.float("tiling", "Noise Tiling", { default: 1.4, min: 0.4, max: 5, tooltip: "Noise repeats across the particle quad (bigger = finer billows).", category: "Shape" }),
    P.float("spin", "Spin", { default: 0.25, min: -1, max: 1, tooltip: "Rotation of the noise over the particle's life, in turns.", category: "Shape" }),
    P.float("erode", "Erosion", { default: 0.5, min: 0, max: 0.9, tooltip: "How far the cloud has eaten away at the end of its life.", category: "Shape" }),
    P.float("edgeSoft", "Edge Softness", { default: 0.35, min: 0.05, max: 0.8, tooltip: "Width of the transition at the erosion edge.", category: "Shape" }),
    P.color("darkColor", "Shadow Color", { default: [0.1, 0.1, 0.12], tooltip: "Smoke colour in the dense, shaded parts (sRGB).", category: "Color" }),
    P.color("lightColor", "Light Color", { default: [0.62, 0.6, 0.58], tooltip: "Smoke colour in the lit, thin parts (sRGB).", category: "Color" }),
    P.float("opacity", "Opacity", { default: 0.9, min: 0, max: 1, tooltip: "Maximum opacity of a puff.", category: "Color" }),
    P.float("softDistance", "Soft Distance", { default: 0.6, min: 0.05, max: 3, tooltip: "World-space fade distance where smoke meets geometry.", category: "Soft Particles" }),
  );
  s.texture("smokeMap", "smoke-noise", smokeTex(128, 9));
  s.use(depthIntersect());

  const i = s.block("inputs", "Particle inputs", "Quad UV, normalised age, a per-particle random number and the particle colour.", { col: 0, color: COLORS.blue });
  i.n("uv", "uv", {});
  i.n("age", "particleAge", { params: { mode: "normalized" } });
  i.n("rnd", "particleRandom", {});
  i.n("pc", "particleColor", {});

  const r = s.block("rot", "Per-particle rotation", "`turns = random + age × spin`: each puff starts rotated differently and turns slowly while it rises.", { col: 1, row: 0, color: COLORS.green });
  r.n("sp", "multiply", {});
  r.n("turns", "add", {});
  r.n("rot", "uvRotate", { params: { unit: "turns" } });
  s.w("age.normalized", "sp.a").w(r.po("spin"), "sp.b").w("rnd.value", "turns.a").w("sp.out", "turns.b").w("uv.out", "rot.uv").w("turns.out", "rot.rotation");

  const n = s.block("noise", "Two noise layers", "Layer 1 at the base tiling, layer 2 at 0.55× with a different offset drifting upward with age. `noise = lerp(n₁, n₂, 0.4)` has two interacting scales, which reads as billowing.", { col: 2, row: 0, color: COLORS.cyan });
  n.n("t1", "combine", {});
  n.n("t2v", "multiply", { values: { b: 0.55 } });
  n.n("t2", "combine", {});
  n.n("o1", "combine", {});
  n.n("rise", "multiply", { values: { b: 0.4 } });
  n.n("o2", "combine", {});
  n.n("uv1", "uvTilingOffset", {});
  n.n("uv2", "uvTilingOffset", {});
  n.n("a", "sampleTexture2D", {});
  n.n("b", "sampleTexture2D", {});
  n.n("ar", "split", {});
  n.n("br", "split", {});
  n.n("mix", "lerp", { values: { t: 0.4 } });
  s.w(n.po("tiling"), "t1.r").w(n.po("tiling"), "t1.g").w(n.po("tiling"), "t2v.a").w("t2v.out", "t2.r").w("t2v.out", "t2.g").w("rnd.value", "o1.r").w("rnd.value", "o1.g")
    .w("age.normalized", "rise.a").w("rise.out", "o2.g").w("rnd.value", "o2.r")
    .w("rot.out", "uv1.uv", "RotatedUV").w("t1.rg", "uv1.tiling").w("o1.rg", "uv1.offset").w("rot.out", "uv2.uv").w("t2.rg", "uv2.tiling").w("o2.rg", "uv2.offset")
    .w(n.po("smokeMap"), "a.tex").w("uv1.out", "a.uv").w(n.po("smokeMap"), "b.tex").w("uv2.out", "b.uv").w("a.rgb", "ar.in").w("b.rgb", "br.in").w("ar.r", "mix.a").w("br.r", "mix.b");

  const a = s.block("alpha", "Shape + erosion", "`puff = noise × round falloff`, `round = 1 − smoothstep(0.15, 0.5, |uv − ½|)`. The threshold `age × erosion` rises over the particle's life; `smoothstep(threshold, threshold + softness, puff)` keeps what is above it.", { col: 3, row: 0, color: COLORS.orange });
  a.n("d", "distance", { values: { b: [0.5, 0.5] } });
  a.n("rs", "smoothstep", { values: { edge1: 0.15, edge2: 0.5 } });
  a.n("round", "oneMinus", {});
  a.n("puff", "multiply", {});
  a.n("e", "multiply", {});
  a.n("e2", "add", {});
  a.n("cut", "smoothstep", {});
  s.w("uv.out", "d.a").w("d.out", "rs.in").w("rs.out", "round.in").w("mix.out", "puff.a").w("round.out", "puff.b").w("age.normalized", "e.a").w(a.po("erode"), "e.b")
    .w("e.out", "cut.edge1").w("e.out", "e2.a").w(a.po("edgeSoft"), "e2.b").w("e2.out", "cut.edge2").w("puff.out", "cut.in");

  const c = s.block("color", "Shading", "Fake lighting: `l = saturate(uv.y × 0.8 + (noise − ½) × 0.6)` — the top of the puff and the thin parts are lighter. Colour = `lerp(shadow, light, l)` × particle colour.", { col: 3, row: 1, color: COLORS.yellow });
  c.n("us", "split", {});
  c.n("ly", "multiply", { values: { b: 0.8 } });
  c.n("nn", "subtract", { values: { b: 0.5 } });
  c.n("nk", "multiply", { values: { b: 0.6 } });
  c.n("l0", "add", {});
  c.n("l", "saturate", {});
  c.n("col", "lerp", {});
  c.n("tint", "multiply", {});
  s.w("uv.out", "us.in").w("us.g", "ly.a").w("mix.out", "nn.a").w("nn.out", "nk.a").w("ly.out", "l0.a").w("nk.out", "l0.b").w("l0.out", "l.in")
    .w(c.po("darkColor"), "col.a").w(c.po("lightColor"), "col.b").w("l.out", "col.t").w("col.out", "tint.a").w("pc.rgb", "tint.b");

  const sf = s.block("soft", "Soft particles + opacity", "Depth fade × erosion alpha × particle alpha × *Opacity*.", { col: 4, row: 0, color: COLORS.red });
  sf.sub("depth", "ks_depth_intersect", { label: "Soft Fade" });
  sf.n("a1", "multiply", {});
  sf.n("a2", "multiply", {});
  sf.n("a3", "multiply", {});
  s.w(sf.po("softDistance"), "depth.distance").w("cut.out", "a1.a").w("depth.fade", "a1.b").w("a1.out", "a2.a").w("pc.a", "a2.b").w("a2.out", "a3.a").w(sf.po("opacity"), "a3.b");

  const o = s.block("out", "Master output (URP VFX Unlit, alpha)", "Alpha blend, ZWrite off, two-sided.", { col: 5, color: COLORS.violet });
  s.master(o);
  s.w("tint.out", "master.baseColor").w("a3.out", "master.alpha");
  return s;
}
export const smokeSample: SampleModule = { meta, build };
