import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { colorRamp3, depthIntersect } from "../lib";
import { fireFlipbook } from "../textures/gen-fx";
import { defineMeta } from "../3d/common";
import { GODOT_VFX, VFX_PROFILE, envelope } from "./common";

const meta = defineMeta({
  id: "vfx-fire", title: "Fire (Flipbook + Soft Particles + Heat Haze)",
  description: "Particle fire: a looping 4×4 flipbook of flame intensity with frame cross-fade and a random start frame per particle, mapped through a 3-stop HDR colour ramp; soft depth fade where particles touch geometry; and a heat-haze halo that distorts the scene colour behind the flame.",
  tags: ["fire", "flipbook", "soft-particles", "distortion", "heat-haze", "particles", "vfx"], category: "VFX / Particles", difficulty: "Advanced", targets: ["glsl", "unity", "godot"],
  compatNotes: ["Needs the scene depth and opaque colour textures: Unity URP asset → Depth Texture + Opaque Texture on; Godot hint_depth_texture / hint_screen_texture. Not available in the HLSL / WGSL snippet targets.", "The flipbook is advanced inside the graph from the particle age (no custom vertex streams needed); keep the sheet's grid at 4 × 4 or edit the Flipbook node.", "Particle colour (vertex colour) multiplies the flame: use it for per-particle tint and the alpha fade-in / fade-out."],
  requiredFeatures: ["URP Depth Texture", "URP Opaque Texture"], budgetClass: "Desktop", godotProfile: GODOT_VFX, reusableSubgraphs: ["ks_depth_intersect", "ks_color_ramp3"],
  previewConfig: {
    mode: "vfx", mesh: "quad", background: { mode: "dark", ground: "grid" },
    emitter: { rate: 26, lifetime: 1.3, lifetimeVar: 0.3, sizeStart: 0.85, sizeEnd: 0.55, speed: 0.35, spread: 8, gravity: [0, 0.35, 0], maxParticles: 90, colorOverLife: envelope(1, 0.08) },
    intersector: { kind: "box", position: [0, -0.25, 0], scale: 0.45 }, simulation: { depthTexture: true, opaqueTexture: true },
  },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: VFX_PROFILE, settings: { blend: "alpha", zwrite: "off", cull: "off" } });
  s.add(
    P.tex("flameSheet", "Flame Flipbook", { default: "white", tooltip: "4 × 4 flipbook of flame intensity (grey, frame 0 top-left, row-major). Import as linear data.", category: "Flame" }),
    P.float("flipSpeed", "Flipbook Speed", { default: 1.6, min: 0.2, max: 6, tooltip: "Flipbook loops per particle lifetime.", category: "Flame" }),
    P.color("coldColor", "Flame Edge", { default: [0.5, 0.04, 0], hdr: true, tooltip: "HDR colour at the flame's cool edge.", category: "Color" }),
    P.color("midColor", "Flame Body", { default: [2.6, 0.75, 0.08], hdr: true, tooltip: "HDR colour of the flame body.", category: "Color" }),
    P.color("hotColor", "Flame Core", { default: [4.5, 3.4, 1.4], hdr: true, tooltip: "HDR colour of the hottest core.", category: "Color" }),
    P.float("intensity", "Intensity", { default: 1.2, min: 0, max: 4, tooltip: "Brightness multiplier of the flame colour.", category: "Color" }),
    P.float("softDistance", "Soft Distance", { default: 0.5, min: 0.05, max: 3, tooltip: "World-space fade distance where the particle meets geometry.", category: "Soft Particles" }),
    P.float("distortion", "Heat Haze", { default: 0.03, min: 0, max: 0.15, tooltip: "Screen-UV distortion of the scene behind the flame (0 = off).", category: "Distortion" }),
  );
  s.texture("flameSheet", "flame-flipbook", fireFlipbook(64, 4, 5));
  s.use(colorRamp3()).use(depthIntersect());

  const i = s.block("inputs", "Particle inputs", "Quad UV, the particle's normalised age (0 → 1), a per-particle random number and the particle colour.", { col: 0, color: COLORS.blue });
  i.n("uv", "uv", {});
  i.n("age", "particleAge", { params: { mode: "normalized" } });
  i.n("rnd", "particleRandom", {});
  i.n("pc", "particleColor", {});
  i.n("sp", "screenPosition", {});

  const f = s.block("flip", "Flipbook animation", "`frame = (age × speed + random) × 16`: every particle starts at a different frame, and the flame loops seamlessly because the sheet scrolls exactly one noise period. Current and next frame are fetched and cross-faded by the Flipbook node's *blend*.", { col: 1, row: 0, color: COLORS.green });
  f.n("a", "multiply", {});
  f.n("sum", "add", {});
  f.n("fr", "multiply", { values: { b: 16 } });
  f.n("fb", "uvFlipbook", { values: { columns: 4, rows: 4 }, params: { start: "topLeft", direction: "forward", edge: "repeat" } });
  f.n("sa", "sampleTexture2D", {});
  f.n("sb", "sampleTexture2D", {});
  f.n("ra", "split", {});
  f.n("rb", "split", {});
  f.n("heat", "lerp", {});
  s.w("age.normalized", "a.a").w(f.po("flipSpeed"), "a.b").w("a.out", "sum.a").w("rnd.value", "sum.b").w("sum.out", "fr.a").w("uv.out", "fb.uv").w("fr.out", "fb.frame")
    .w(f.po("flameSheet"), "sa.tex").w("fb.out", "sa.uv").w(f.po("flameSheet"), "sb.tex").w("fb.next", "sb.uv").w("sa.rgb", "ra.in").w("sb.rgb", "rb.in").w("ra.r", "heat.a").w("rb.r", "heat.b").w("fb.blend", "heat.t");

  const c = s.block("color", "Flame colour", "**Color Ramp** maps the flame intensity to edge → body → core HDR colours; multiplied by *Intensity* and the particle colour.", { col: 2, row: 0, color: COLORS.orange });
  c.sub("ramp", "ks_color_ramp3", { label: "Flame Ramp" });
  c.n("g", "multiply", {});
  c.n("tint", "multiply", {});
  s.w("heat.out", "ramp.t").w(c.po("coldColor"), "ramp.cold").w(c.po("midColor"), "ramp.mid").w(c.po("hotColor"), "ramp.hot").w("ramp.color", "g.a").w(c.po("intensity"), "g.b").w("g.out", "tint.a").w("pc.rgb", "tint.b");

  const sf = s.block("soft", "Soft particles", "The **Depth Intersection** kit fades the particle to 0 where it touches opaque geometry, hiding the hard intersection line of a flat quad.", { col: 1, row: 1, color: COLORS.cyan });
  sf.sub("depth", "ks_depth_intersect", { label: "Soft Fade" });
  s.w(sf.po("softDistance"), "depth.distance");

  const d = s.block("haze", "Heat haze", "The scene colour is sampled at `screenUV + (I − ½, ΔI·4) × haze`, where ΔI is the difference between the two flipbook frames. The result replaces the background inside the flame's halo (`smoothstep(0, 0.25, I)`), so hot air wobbles the view behind the fire.", { col: 2, row: 1, color: COLORS.red });
  d.n("ox", "subtract", { values: { b: 0.5 } });
  d.n("dI", "subtract", {});
  d.n("oy", "multiply", { values: { b: 4 } });
  d.n("off", "combine", {});
  d.n("offd", "multiply", {});
  d.n("suv", "add", {});
  d.n("scene", "sceneColor", {});
  s.w("heat.out", "ox.a").w("ra.r", "dI.a").w("rb.r", "dI.b").w("dI.out", "oy.a").w("ox.out", "off.r").w("oy.out", "off.g").w("off.rg", "offd.a").w(d.po("distortion"), "offd.b")
    .w("sp.normalized", "suv.a").w("offd.out", "suv.b").w("suv.out", "scene.uv");

  const m = s.block("mix", "Combine", "`colour = lerp(distorted scene, flame, coverage)`, `coverage = saturate(1.8 I − 0.1)`; alpha = halo × soft fade × particle alpha. The haze is only visible through the halo, the flame covers it.", { col: 3, color: COLORS.yellow });
  m.n("cv0", "multiply", { values: { b: 1.8 } });
  m.n("cv1", "subtract", { values: { b: 0.1 } });
  m.n("cv", "saturate", {});
  m.n("col", "lerp", {});
  m.n("halo", "smoothstep", { values: { edge1: 0, edge2: 0.25 } });
  m.n("al1", "multiply", {});
  m.n("al2", "multiply", {});
  s.w("heat.out", "cv0.a").w("cv0.out", "cv1.a").w("cv1.out", "cv.in").w("scene.out", "col.a").w("tint.out", "col.b").w("cv.out", "col.t").w("heat.out", "halo.in")
    .w("halo.out", "al1.a").w("depth.fade", "al1.b").w("al1.out", "al2.a").w("pc.a", "al2.b");

  const o = s.block("out", "Master output (URP VFX Unlit, alpha)", "Colour + alpha; blend mode Alpha, ZWrite off, two-sided.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("col.out", "master.baseColor").w("al2.out", "master.alpha");
  return s;
}
export const fireSample: SampleModule = { meta, build };
