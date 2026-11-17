import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { colorRamp3, depthIntersect } from "../lib";
import { smokeTex } from "../textures/gen-fx";
import { defineMeta } from "../3d/common";
import { GODOT_VFX, VFX_PROFILE, envelope } from "./common";

const meta = defineMeta({
  id: "vfx-explosion", title: "Stylized Explosion",
  description: "Flipbook-free fireball: two rotating layers of tileable noise form the puff, its heat falls over the particle's age and picks a colour from a white-hot → orange → soot ramp, an erosion threshold eats the puff away, soft depth fading removes the geometry cut and the opaque scene is bent behind it as heat haze.",
  tags: ["explosion", "fireball", "noise", "gradient-over-age", "soft-particles", "distortion", "heat-haze", "particles", "vfx"], category: "VFX / Particles", difficulty: "Advanced", targets: ["glsl", "unity", "godot"],
  compatNotes: ["Needs the scene depth texture (Unity URP asset → Depth Texture; Godot hint_depth_texture) and the opaque texture (Unity: Opaque Texture; Godot hint_screen_texture). Not available in the HLSL / WGSL snippet targets.", "Alpha blended, ZWrite off. The heat ramp is HDR (linear) — use Bloom. Age comes from the Age Percent custom vertex stream (TEXCOORD1.x) and the per-particle random from Stable Random (TEXCOORD1.y)."],
  requiredFeatures: ["URP Depth Texture", "URP Opaque Texture"], budgetClass: "Mobile", godotProfile: GODOT_VFX, reusableSubgraphs: ["ks_color_ramp3", "ks_depth_intersect"],
  previewConfig: {
    mode: "vfx", mesh: "quad", background: { mode: "gradient", ground: "grid" },
    emitter: { rate: 0.7, lifetime: 2.4, lifetimeVar: 0, sizeStart: 0.9, sizeEnd: 3.2, speed: 0.2, spread: 8, gravity: [0, 0.1, 0], maxParticles: 5, colorOverLife: envelope(1, 0.03) },
    intersector: { kind: "box", position: [0, -0.1, 0], scale: 0.7 }, simulation: { depthTexture: true, opaqueTexture: true },
  },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: VFX_PROFILE, settings: { blend: "alpha", zwrite: "off", cull: "off" } });
  s.add(
    P.tex("noiseMap", "Fire Noise", { default: "grey", tooltip: "Tileable cloud noise (grey). Linear data, wrap mode Repeat.", category: "Shape" }),
    P.float("tiling", "Noise Tiling", { default: 1.3, min: 0.4, max: 4, tooltip: "Noise repeats across the quad (bigger = finer billows).", category: "Shape" }),
    P.float("spin", "Spin", { default: 0.3, min: -1, max: 1, tooltip: "Rotation of the noise over the particle's life, in turns.", category: "Shape" }),
    P.float("density", "Density", { default: 2.2, min: 0.5, max: 4, tooltip: "Multiplier of noise × round falloff: higher = a fuller, harder fireball.", category: "Shape" }),
    P.float("erosion", "Erosion", { default: 0.75, min: 0, max: 0.95, tooltip: "How far the puff has eaten away at the end of its life.", category: "Shape" }),
    P.float("heatFall", "Heat Falloff", { default: 1.6, min: 0.3, max: 4, tooltip: "How fast the fire cools with age: heat = (1 − age)^falloff.", category: "Heat" }),
    P.color("hotColor", "Hot Color", { default: [4.5, 3.4, 1.4], hdr: true, tooltip: "HDR colour of the hottest part, at birth (linear).", category: "Heat" }),
    P.color("midColor", "Flame Color", { default: [2.4, 0.6, 0.06], hdr: true, tooltip: "HDR colour of the flame body (linear).", category: "Heat" }),
    P.color("coldColor", "Soot Color", { default: [0.07, 0.06, 0.06], tooltip: "Colour of the cooled smoke at the end of life (sRGB).", category: "Heat" }),
    P.float("distortion", "Distortion", { default: 0.06, min: 0, max: 0.2, tooltip: "Screen-space bending of the scene behind the explosion (UV units).", category: "Heat Haze" }),
    P.float("haze", "Haze Opacity", { default: 0.8, min: 0, max: 1, tooltip: "How much of the bent scene replaces the background around the fireball (0 = no haze).", category: "Heat Haze" }),
    P.float("softDistance", "Soft Distance", { default: 0.7, min: 0.05, max: 3, tooltip: "World-space fade distance where the explosion meets geometry.", category: "Soft Particles" }),
    P.float("opacity", "Opacity", { default: 1, min: 0, max: 1, tooltip: "Maximum opacity of the fireball.", category: "Soft Particles" }),
  );
  s.texture("noiseMap", "fire-noise", smokeTex(128, 33));
  s.use(colorRamp3()).use(depthIntersect());

  const i = s.block("inputs", "Particle inputs", "Quad UV, normalised age (Age Percent stream), a per-particle random number (Stable Random stream), the particle colour and the screen UV for the haze.", { col: 0, color: COLORS.blue });
  i.n("uv", "uv", {});
  i.n("age", "particleAge", { params: { mode: "normalized" } });
  i.n("rnd", "particleRandom", {});
  i.n("pc", "particleColor", {});
  i.n("sp", "screenPosition", {});

  const n = s.block("noise", "Two noise layers", "The UV is rotated by `random + age × spin` turns. Layer A at the base tiling and layer B at 2.1× with an offset rising with age are blended 55 / 45: two interacting scales read as billowing. The raw samples are kept: they also drive the haze offset.", { col: 1, row: 0, color: COLORS.cyan });
  n.n("sp1", "multiply", {});
  n.n("turns", "add", {});
  n.n("rot", "uvRotate", { params: { unit: "turns" } });
  n.n("tA", "combine", {});
  n.n("tBv", "multiply", { values: { b: 2.1 } });
  n.n("tB", "combine", {});
  n.n("oA", "combine", {});
  n.n("oB", "combine", {});
  n.n("uvA", "uvTilingOffset", {});
  n.n("uvB", "uvTilingOffset", {});
  n.n("sa", "sampleTexture2D", {});
  n.n("sb", "sampleTexture2D", {});
  n.n("ar", "split", {});
  n.n("br", "split", {});
  n.n("mix", "lerp", { values: { t: 0.45 } });
  s.w("age.normalized", "sp1.a").w(n.po("spin"), "sp1.b").w("rnd.value", "turns.a").w("sp1.out", "turns.b").w("uv.out", "rot.uv").w("turns.out", "rot.rotation")
    .w(n.po("tiling"), "tA.r").w(n.po("tiling"), "tA.g").w(n.po("tiling"), "tBv.a").w("tBv.out", "tB.r").w("tBv.out", "tB.g").w("rnd.value", "oA.r").w("rnd.value", "oA.g")
    .w("age.normalized", "oB.g").w("rnd.value", "oB.r").w("rot.out", "uvA.uv").w("tA.rg", "uvA.tiling").w("oA.rg", "uvA.offset").w("rot.out", "uvB.uv").w("tB.rg", "uvB.tiling").w("oB.rg", "uvB.offset")
    .w(n.po("noiseMap"), "sa.tex").w("uvA.out", "sa.uv").w(n.po("noiseMap"), "sb.tex").w("uvB.out", "sb.uv").w("sa.rgb", "ar.in").w("sb.rgb", "br.in").w("ar.r", "mix.a").w("br.r", "mix.b");

  const b = s.block("body", "Round puff + erosion", "`body = saturate(noise × round × density)` with `round = 1 − smoothstep(0.1, 0.5, |uv − ½|)`. The threshold `age × erosion` rises over the life; `smoothstep(thr, thr + 0.25, body)` keeps what is above it.", { col: 1, row: 1, color: COLORS.orange });
  b.n("d", "distance", { values: { b: [0.5, 0.5] } });
  b.n("rs", "smoothstep", { values: { edge1: 0.1, edge2: 0.5 } });
  b.n("round", "oneMinus", {});
  b.n("p0", "multiply", {});
  b.n("p1", "multiply", {});
  b.n("body", "saturate", {});
  b.n("thr", "multiply", {});
  b.n("thr2", "add", { values: { b: 0.25 } });
  b.n("cut", "smoothstep", {});
  s.w("uv.out", "d.a").w("d.out", "rs.in").w("rs.out", "round.in").w("mix.out", "p0.a").w("round.out", "p0.b").w("p0.out", "p1.a").w(b.po("density"), "p1.b").w("p1.out", "body.in")
    .w("age.normalized", "thr.a").w(b.po("erosion"), "thr.b").w("thr.out", "cut.edge1").w("thr.out", "thr2.a").w("thr2.out", "cut.edge2").w("body.out", "cut.in");

  const h = s.block("heat", "Heat over age → colour", "`heat = saturate(body × (1 − age)^falloff)` indexes the shared **Color Ramp**: soot → flame → hot white. A young fireball is hot in its dense core; as it ages everything slides down the ramp towards soot.", { col: 2, row: 0, color: COLORS.yellow });
  h.n("ia", "oneMinus", {});
  h.n("hf", "power", {});
  h.n("h0", "multiply", {});
  h.n("heat", "saturate", {});
  h.sub("ramp", "ks_color_ramp3", { label: "Heat Ramp" });
  h.n("tint", "multiply", {});
  s.w("age.normalized", "ia.in").w("ia.out", "hf.a").w(h.po("heatFall"), "hf.b").w("body.out", "h0.a").w("hf.out", "h0.b").w("h0.out", "heat.in").w("heat.out", "ramp.t")
    .w(h.po("coldColor"), "ramp.cold").w(h.po("midColor"), "ramp.mid").w(h.po("hotColor"), "ramp.hot").w("ramp.color", "tint.a").w("pc.rgb", "tint.b");

  const d = s.block("haze", "Heat-haze distortion", "`offset = (nA − ½, nB − ½) × distortion × round × (1 − age)`; the opaque scene is read at `screenUV + offset`. Haze alpha = `round × (1 − age) × haze`: the bent scene replaces the background around the fireball.", { col: 2, row: 1, color: COLORS.red });
  d.n("nx", "subtract", { values: { b: 0.5 } });
  d.n("ny", "subtract", { values: { b: 0.5 } });
  d.n("of", "combine", {});
  d.n("ds", "multiply", {});
  d.n("dr", "multiply", {});
  d.n("dg", "multiply", {});
  d.n("suv", "add", {});
  d.n("scene", "sceneColor", {});
  d.n("hz", "multiply", {});
  d.n("hz2", "multiply", {});
  s.w("ar.r", "nx.a").w("br.r", "ny.a").w("nx.out", "of.r").w("ny.out", "of.g").w("of.rg", "ds.a").w(d.po("distortion"), "ds.b").w("ds.out", "dr.a").w("round.out", "dr.b", "Round").w("dr.out", "dg.a").w("ia.out", "dg.b")
    .w("sp.normalized", "suv.a", "ScreenUV").w("dg.out", "suv.b").w("suv.out", "scene.uv").w("round.out", "hz.a").w("ia.out", "hz.b").w("hz.out", "hz2.a").w(d.po("haze"), "hz2.b");

  const a = s.block("alpha", "Soft particles + final mix", "Fire alpha = erosion cut × soft depth fade × opacity × particle alpha. `colour = lerp(bent scene, fire colour, fire alpha)`, `alpha = max(fire alpha, haze alpha × particle alpha)`.", { col: 3, color: COLORS.green });
  a.sub("depth", "ks_depth_intersect", { label: "Soft Fade" });
  a.n("f1", "multiply", {});
  a.n("f2", "multiply", {});
  a.n("f3", "multiply", {});
  a.n("hp", "multiply", {});
  a.n("mx", "maximum", {});
  a.n("col", "lerp", {});
  s.w(a.po("softDistance"), "depth.distance").w("cut.out", "f1.a").w("depth.fade", "f1.b").w("f1.out", "f2.a").w(a.po("opacity"), "f2.b").w("f2.out", "f3.a").w("pc.a", "f3.b")
    .w("hz2.out", "hp.a").w("pc.a", "hp.b").w("f3.out", "mx.a").w("hp.out", "mx.b").w("scene.out", "col.a").w("tint.out", "col.b").w("f3.out", "col.t");

  const o = s.block("out", "Master output (URP VFX Unlit, alpha)", "Alpha blend, ZWrite off, two-sided.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("col.out", "master.baseColor").w("mx.out", "master.alpha");
  return s;
}
export const explosionSample: SampleModule = { meta, build };
