import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { ALL_TARGETS, defineMeta } from "./common";

const meta = defineMeta({
  id: "foliage-wind", title: "Foliage: Wind + Translucency",
  description: "A procedural leaf card with alpha-clipped outline, midrib and side veins. The Wind Foliage node sways it from the base to the tip, and the Lit master's Translucency + Thickness blocks let sunlight glow through the thin blade — thicker veins stay dark.",
  tags: ["foliage", "wind", "translucency", "leaf", "alpha-clip", "vertex", "lit"], category: "3D / Lit", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["Translucency is a portable approximation: back light = translucency × (1 − thickness) × albedo × main light × saturate(−N·L). URP Lit has no native translucency (added to emission), Godot maps it to BACKLIGHT.", "Alpha Clip + two-sided (Render Face = Both, double-sided normals) are set in the graph settings.", "Wind runs in the vertex stage: the leaf needs enough subdivisions to bend smoothly (the preview plane has them)."],
  requiredFeatures: [], budgetClass: "Mobile", godotProfile: "godot.spatial",
  previewConfig: { mode: "3d", mesh: "plane", lighting: { lit: "lit", azimuth: 200, elevation: 30, intensity: 1.5 }, background: { mode: "gradient" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.lit", settings: { alphaClip: true, cull: "off", doubleSided: "flip" } });
  s.add(
    P.color("baseColor", "Base Color", { default: [0.1, 0.38, 0.06], tooltip: "Leaf colour at the stem end (sRGB).", category: "Leaf" }),
    P.color("tipColor", "Tip Color", { default: [0.5, 0.72, 0.14], tooltip: "Leaf colour at the tip (sRGB).", category: "Leaf" }),
    P.color("veinColor", "Vein Color", { default: [0.62, 0.75, 0.3], tooltip: "Colour of the midrib and side veins (sRGB).", category: "Leaf" }),
    P.float("smoothness", "Smoothness", { default: 0.28, min: 0, max: 1, tooltip: "Specular smoothness (waxy leaves are higher).", category: "Leaf" }),
    P.float("width", "Leaf Width", { default: 0.46, min: 0.2, max: 0.5, tooltip: "Half-width of the leaf at its widest point (UV units).", category: "Shape" }),
    P.float("veins", "Side Vein Count", { default: 7, min: 3, max: 14, step: 1, tooltip: "Number of side veins along the blade.", category: "Shape" }),
    P.color("transColor", "Translucency Color", { default: [0.5, 0.85, 0.15], hdr: true, tooltip: "HDR colour of the light that shines through the leaf.", category: "Translucency" }),
    P.float("transStrength", "Translucency Strength", { default: 1.6, min: 0, max: 5, tooltip: "Multiplier of the back light.", category: "Translucency" }),
    P.float("thickness", "Blade Thickness", { default: 0.15, min: 0, max: 1, tooltip: "0 = paper-thin (full back light), 1 = opaque. Veins add extra thickness.", category: "Translucency" }),
    P.float("windStrength", "Wind Strength", { default: 0.12, min: 0, max: 0.5, tooltip: "Maximum sway distance at the tip (object units).", category: "Wind" }),
    P.float("windFreq", "Wind Frequency", { default: 0.9, min: 0.1, max: 4, tooltip: "Sway cycles per second.", category: "Wind" }),
    P.float("turbulence", "Turbulence", { default: 0.35, min: 0, max: 1, tooltip: "Amount of high-frequency flutter on top of the sway.", category: "Wind" }),
    P.vec3("windDir", "Wind Direction", { default: [1, 0, 0.3], tooltip: "Direction of the wind (object space).", category: "Wind" }),
  );

  const g = s.block("inputs", "Inputs", "UV (u across, v from stem to tip), object-space position for the wind and time.", { col: 0, color: COLORS.blue });
  g.n("uv", "uv", {});
  g.n("us", "split", {});
  g.n("opos", "position", { params: { space: "object" } });
  g.n("t", "time", {});
  g.n("x", "subtract", { values: { b: 0.5 } });
  g.n("ax", "abs", {});
  s.w("uv.out", "us.in").w("us.r", "x.a").w("x.out", "ax.in");

  const sh = s.block("shape", "Leaf outline", "`halfWidth(v) = width × sin(πv)^0.6` gives a pointed oval. Alpha is 1 inside `|u − ½| < halfWidth` with a hair of anti-aliasing; the Alpha Clip threshold cuts the card to the leaf.", { col: 1, row: 0, color: COLORS.green });
  sh.n("pv", "multiply", { values: { b: 3.14159265 } });
  sh.n("sv", "sin", {});
  sh.n("sp", "power", { values: { b: 0.6 } });
  sh.n("hw", "multiply", {});
  sh.n("edge0", "subtract", { values: { b: 0.02 } });
  sh.n("alpha0", "smoothstep", {});
  sh.n("alpha", "oneMinus", {});
  s.w("us.g", "pv.a").w("pv.out", "sv.in").w("sv.out", "sp.a").w("sp.out", "hw.a").w(sh.po("width"), "hw.b").w("hw.out", "edge0.a")
    .w("edge0.out", "alpha0.edge1").w("hw.out", "alpha0.edge2").w("ax.out", "alpha0.in", "AbsU").w("alpha0.out", "alpha.in");

  const v = s.block("veins", "Veins", "Midrib: `1 − smoothstep(0, 0.03, |u − ½|)`. Side veins: `fract(v·count − |u − ½|·3)` is a sawtooth along diagonal lines; its distance from ½ peaks on a thin line, fading towards the leaf edge.", { col: 1, row: 1, color: COLORS.yellow });
  v.n("mid0", "smoothstep", { values: { edge1: 0, edge2: 0.03 } });
  v.n("mid", "oneMinus", {});
  v.n("vc", "multiply", {});
  v.n("ax3", "multiply", { values: { b: 3 } });
  v.n("ph", "subtract", {});
  v.n("fr", "fract", {});
  v.n("dc", "subtract", { values: { b: 0.5 } });
  v.n("da", "abs", {});
  v.n("line", "smoothstep", { values: { edge1: 0.42, edge2: 0.5 } });
  v.n("fade0", "multiply", { values: { b: 2.2 } });
  v.n("fade", "oneMinus", {});
  v.n("fades", "saturate", {});
  v.n("side", "multiply", {});
  v.n("vein", "maximum", {});
  s.w("ax.out", "mid0.in").w("mid0.out", "mid.in").w("us.g", "vc.a").w(v.po("veins"), "vc.b").w("ax.out", "ax3.a").w("vc.out", "ph.a").w("ax3.out", "ph.b").w("ph.out", "fr.in")
    .w("fr.out", "dc.a").w("dc.out", "da.in").w("da.out", "line.in").w("ax.out", "fade0.a").w("fade0.out", "fade.in").w("fade.out", "fades.in").w("line.out", "side.a").w("fades.out", "side.b")
    .w("mid.out", "vein.a").w("side.out", "vein.b");

  const c = s.block("color", "Leaf colour", "Colour runs from *Base* to *Tip* along v; veins are blended in with `lerp(colour, vein colour, vein × 0.7)`.", { col: 2, row: 0, color: COLORS.orange });
  c.n("grad", "lerp", {});
  c.n("vk", "multiply", { values: { b: 0.7 } });
  c.n("col", "lerp", {});
  s.w(c.po("baseColor"), "grad.a").w(c.po("tipColor"), "grad.b").w("us.g", "grad.t").w("vein.out", "vk.a").w("grad.out", "col.a").w(c.po("veinColor"), "col.b").w("vk.out", "col.t");

  const tr = s.block("trans", "Translucency + thickness", "Translucency colour × strength feeds the master's **Translucency** block; **Thickness** = blade thickness + 0.5 × vein, so veins block more light (they look dark against the sun).", { col: 2, row: 1, color: COLORS.pink });
  tr.n("tc", "multiply", {});
  tr.n("vt", "multiply", { values: { b: 0.5 } });
  tr.n("th0", "add", {});
  tr.n("th", "saturate", {});
  s.w(tr.po("transColor"), "tc.a").w(tr.po("transStrength"), "tc.b").w("vein.out", "vt.a").w(tr.po("thickness"), "th0.a").w("vt.out", "th0.b").w("th0.out", "th.in");

  const w = s.block("wind", "Wind", "**Wind Foliage** bends the card with a mask of `v` (0 at the stem = pinned, 1 at the tip = free): one slow sway along the wind direction plus phase-shifted flutter driven by the object position.", { col: 3, color: COLORS.cyan });
  w.n("mask", "saturate", {});
  w.n("wind", "windFoliage", { params: { space: "object" } });
  s.w("us.g", "mask.in").w("opos.out", "wind.position", "ObjectPos").w("mask.out", "wind.mask").w("t.time", "wind.time", "Time").w(w.po("windStrength"), "wind.strength").w(w.po("windFreq"), "wind.frequency")
    .w(w.po("turbulence"), "wind.turbulence").w(w.po("windDir"), "wind.direction");

  const o = s.block("out", "Master output (URP Lit, alpha clip, two-sided)", "Alpha Clip, Render Face = Both and double-sided normals are set in the graph settings.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("col.out", "master.baseColor").w("alpha.out", "master.alpha").w(o.po("smoothness"), "master.smoothness").w("tc.out", "master.translucency").w("th.out", "master.thickness").w("wind.position", "master.positionOS");
  return s;
}
export const foliageWindSample: SampleModule = { meta, build };
