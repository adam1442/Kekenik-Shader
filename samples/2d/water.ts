import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { slimeSprite } from "../textures/gen";
import { ALL_TARGETS, defineMeta } from "../3d/common";
import { SPRITE_PROFILE, SPRITE_PROP_ID, spriteTexProp } from "./common";

const meta = defineMeta({
  id: "sprite-water-reflection", title: "2D Water Reflection",
  description: "Sprite standing on water: the upper part of the quad shows the sprite, the lower part its mirror image. The reflection is rippled by two travelling sines whose strength grows with depth, fades out with distance from the waterline, is tinted by the water colour, and a thin bright line marks the surface.",
  tags: ["water", "reflection", "ripple", "mirror", "waterline", "sprite", "2d"], category: "2D / Sprites", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["The quad is split at the Waterline: V above it shows the sprite (stretched to fill that part), V below shows the reflection. With Waterline 0.5 use a quad twice as tall as the sprite so nothing is distorted; lower values give a shorter, cropped reflection.", "Two texture fetches (sprite + reflection), but only one is visible per pixel; no screen texture is used, so it works in every 2D pipeline."],
  requiredFeatures: [], budgetClass: "Mobile", godotProfile: "godot.canvasitem",
  previewConfig: { mode: "2d", sprite: true, background: { mode: "dark" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: SPRITE_PROFILE });
  s.add(
    spriteTexProp(),
    P.float("waterline", "Waterline", { default: 0.5, min: 0.2, max: 0.7, tooltip: "V coordinate where the water starts (0 = bottom of the quad).", category: "Water" }),
    P.color("waterColor", "Water Tint", { default: [0.35, 0.65, 0.9], tooltip: "Colour multiplied onto the reflection (sRGB).", category: "Water" }),
    P.float("reflectOpacity", "Reflection Opacity", { default: 0.65, min: 0, max: 1, tooltip: "Opacity of the reflection right below the waterline.", category: "Water" }),
    P.float("fadeLength", "Fade Length", { default: 0.4, min: 0.05, max: 1, tooltip: "Depth (UV units) over which the reflection fades out.", category: "Water" }),
    P.float("rippleAmount", "Ripple Amount", { default: 0.03, min: 0, max: 0.1, tooltip: "Sideways displacement of the reflection at full depth (UV units).", category: "Ripples" }),
    P.float("rippleFrequency", "Ripple Frequency", { default: 28, min: 4, max: 80, tooltip: "Ripples per unit of depth (radians).", category: "Ripples" }),
    P.float("rippleSpeed", "Ripple Speed", { default: 2.5, min: 0, max: 8, tooltip: "Travel speed of the ripples in radians per second.", category: "Ripples" }),
    P.color("lineColor", "Surface Line Color", { default: [2.2, 3, 3.6], hdr: true, tooltip: "HDR colour of the bright line on the water surface (linear).", category: "Surface" }),
    P.float("lineWidth", "Surface Line Width", { default: 0.012, min: 0, max: 0.05, tooltip: "Thickness of the surface line in UV units (0 = off).", category: "Surface" }),
  );
  s.texture(SPRITE_PROP_ID, "slime", slimeSprite(96, false));

  const i = s.block("inputs", "Inputs", "Sprite UV and time.", { col: 0, color: COLORS.blue });
  i.n("uv", "uv", {});
  i.n("us", "split", {});
  i.n("t", "time", {});
  s.w("uv.out", "us.in");

  const d = s.block("depth", "Depth below the waterline", "`depth = waterline − v` (positive under water). The mirror image is read at `v' = depth / (1 − waterline)`, i.e. the same distance above the line, in the sprite's own 0…1 space. `above = step(waterline, v)` selects the sprite half.", { col: 1, row: 0, color: COLORS.cyan });
  d.n("depth", "subtract", {});
  d.n("dpos", "maximum", { values: { b: 0 } });
  d.n("span", "oneMinus", {});
  d.n("vr", "divide", {});
  d.n("above", "step", {});
  d.n("vs", "subtract", {});
  d.n("vsn", "divide", {});
  s.w(d.po("waterline"), "depth.a").w("us.g", "depth.b").w("depth.out", "dpos.a").w(d.po("waterline"), "span.in").w("dpos.out", "vr.a").w("span.out", "vr.b").w(d.po("waterline"), "above.edge").w("us.g", "above.in")
    .w("us.g", "vs.a").w(d.po("waterline"), "vs.b").w("vs.out", "vsn.a").w("span.out", "vsn.b");

  const r = s.block("ripple", "Ripples that grow with depth", "`dx = (sin(depth·f − t·speed) + 0.5·sin(depth·1.7f − 1.3·t·speed)) · amount · saturate(depth·4)`: two sines of different frequency don't look periodic, and the `saturate(depth·4)` ramp keeps the reflection attached to the sprite's feet at the waterline.", { col: 2, row: 0, color: COLORS.green });
  r.n("f1", "multiply", {});
  r.n("ts", "multiply", {});
  r.n("a1", "subtract", {});
  r.n("s1", "sin", {});
  r.n("f2", "multiply", { values: { b: 1.7 } });
  r.n("ts2", "multiply", { values: { b: 1.3 } });
  r.n("a2", "subtract", {});
  r.n("s2", "sin", {});
  r.n("s2h", "multiply", { values: { b: 0.5 } });
  r.n("sum", "add", {});
  r.n("grow0", "multiply", { values: { b: 4 } });
  r.n("grow", "saturate", {});
  r.n("am", "multiply", {});
  r.n("dx", "multiply", {});
  r.n("ux", "add", {});
  r.n("ruv", "combine", {});
  s.w("dpos.out", "f1.a", "Depth").w(r.po("rippleFrequency"), "f1.b").w("t.time", "ts.a", "Time").w(r.po("rippleSpeed"), "ts.b").w("f1.out", "a1.a").w("ts.out", "a1.b").w("a1.out", "s1.in")
    .w("f1.out", "f2.a").w("f2.out", "a2.a").w("ts.out", "ts2.a").w("ts2.out", "a2.b").w("a2.out", "s2.in").w("s2.out", "s2h.a").w("s1.out", "sum.a").w("s2h.out", "sum.b")
    .w("dpos.out", "grow0.a").w("grow0.out", "grow.in").w(r.po("rippleAmount"), "am.a").w("grow.out", "am.b").w("sum.out", "dx.a").w("am.out", "dx.b").w("us.r", "ux.a").w("dx.out", "ux.b").w("ux.out", "ruv.r").w("vr.out", "ruv.g");

  const m = s.block("sample", "Sprite half + reflection half", "Two **Sprite Texture** reads (*Outside: transparent* so rippled UVs that leave the sprite are empty): the sprite at `(u, (v − waterline) / (1 − waterline))` and the reflection at the rippled mirror UV. Reflection alpha = `a × opacity × (1 − depth / fade)²`; colour = `rgb × water tint`. `lerp(…, above)` picks the half.", { col: 3, color: COLORS.orange });
  m.n("suv", "combine", {});
  m.n("spr", "spriteTexture", { params: { outside: "transparent" } });
  m.n("ref", "spriteTexture", { params: { outside: "transparent" } });
  m.n("tint", "multiply", {});
  m.n("fd", "divide", {});
  m.n("fi", "oneMinus", {});
  m.n("fs", "saturate", {});
  m.n("fq", "multiply", {});
  m.n("ra0", "multiply", {});
  m.n("ra", "multiply", {});
  m.n("col", "lerp", {});
  m.n("al", "lerp", {});
  s.w("us.r", "suv.r").w("vsn.out", "suv.g").w("suv.rg", "spr.uv").w(m.po(SPRITE_PROP_ID), "spr.tex").w("ruv.rg", "ref.uv").w(m.po(SPRITE_PROP_ID), "ref.tex").w("ref.rgb", "tint.a").w(m.po("waterColor"), "tint.b")
    .w("dpos.out", "fd.a", "Depth").w(m.po("fadeLength"), "fd.b").w("fd.out", "fi.in").w("fi.out", "fs.in").w("fs.out", "fq.a").w("fs.out", "fq.b").w("ref.a", "ra0.a").w(m.po("reflectOpacity"), "ra0.b").w("ra0.out", "ra.a").w("fq.out", "ra.b")
    .w("tint.out", "col.a").w("spr.rgb", "col.b").w("above.out", "col.t", "Above").w("ra.out", "al.a").w("spr.a", "al.b").w("above.out", "al.t", "Above");

  const l = s.block("line", "Surface line", "`line = 1 − smoothstep(0, width, |v − waterline|)`: a thin HDR highlight on the surface that also covers the seam between sprite and reflection.", { col: 4, row: 0, color: COLORS.yellow });
  l.n("dd", "subtract", {});
  l.n("ad", "abs", {});
  l.n("lw", "maximum", { values: { b: 0.0001 } });
  l.n("sm", "smoothstep", { values: { edge1: 0 } });
  l.n("ln", "oneMinus", {});
  l.n("lc", "multiply", {});
  l.n("cadd", "add", {});
  l.n("aadd", "maximum", {});
  s.w("us.g", "dd.a").w(l.po("waterline"), "dd.b").w("dd.out", "ad.in").w(l.po("lineWidth"), "lw.a").w("lw.out", "sm.edge2").w("ad.out", "sm.in").w("sm.out", "ln.in").w(l.po("lineColor"), "lc.a").w("ln.out", "lc.b")
    .w("col.out", "cadd.a").w("lc.out", "cadd.b").w("al.out", "aadd.a").w("ln.out", "aadd.b");

  const o = s.block("out", "Master output (URP Sprite Unlit)", "Sprite / reflection colour with the surface line, and the matching alpha.", { col: 5, color: COLORS.violet });
  s.master(o);
  s.w("cadd.out", "master.baseColor").w("aadd.out", "master.alpha");
  return s;
}
export const waterReflectionSample: SampleModule = { meta, build };
