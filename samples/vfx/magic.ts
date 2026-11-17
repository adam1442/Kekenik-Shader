import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { ALL_TARGETS, defineMeta } from "../3d/common";

const meta = defineMeta({
  id: "vfx-magic-circle", title: "Magic Circle",
  description: "Ground sigil built only from signed distance fields: concentric rings, a counter-rotating star and triangle, and a ring of runes. Each rune is three strokes whose end points come from a hash of its sector, so no two runes match. All shapes merge into one SDF that drives a crisp HDR line and a pulsing glow.",
  tags: ["magic-circle", "sdf", "runes", "polar", "glow", "hdr", "additive", "vfx"], category: "VFX / Particles", difficulty: "Advanced", targets: ALL_TARGETS,
  compatNotes: ["Designed for a flat quad / plane decal with UV 0…1 (Unity: a Quad lying on the ground; Godot: PlaneMesh). Additive, ZWrite off, two-sided; needs Bloom for the HDR glow.", "Rune Count must be a whole number (the sectors would not meet at the seam otherwise); line anti-aliasing uses screen derivatives (fragment stage)."],
  requiredFeatures: [], budgetClass: "Desktop", godotProfile: "godot.spatial",
  previewConfig: { mode: "3d", mesh: "plane", lighting: { lit: "unlit" }, background: { mode: "dark", ground: "none" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.unlit", settings: { blend: "additive", zwrite: "off", cull: "off" } });
  s.add(
    P.color("lineColor", "Line Color", { default: [2.4, 1.1, 6], hdr: true, tooltip: "HDR colour of the crisp lines (linear).", category: "Color" }),
    P.color("glowColor", "Glow Color", { default: [0.5, 0.18, 2.4], hdr: true, tooltip: "HDR colour of the soft glow around every line (linear).", category: "Color" }),
    P.float("glowSize", "Glow Size", { default: 0.035, min: 0.005, max: 0.15, tooltip: "Reach of the glow around the lines, in UV units.", category: "Glow" }),
    P.float("glowStrength", "Glow Strength", { default: 1.2, min: 0, max: 4, tooltip: "Brightness of the glow (0 = crisp lines only).", category: "Glow" }),
    P.float("pulseSpeed", "Glow Pulse Speed", { default: 2, min: 0, max: 10, tooltip: "Speed of the breathing glow in radians per second (0 = steady).", category: "Glow" }),
    P.float("spinSpeed", "Sigil Spin", { default: 25, min: -120, max: 120, tooltip: "Rotation speed of the star in degrees per second; the triangle turns the other way.", category: "Motion" }),
    P.float("runeSpeed", "Rune Ring Speed", { default: 0.03, min: -0.3, max: 0.3, tooltip: "Rotation speed of the rune ring in turns per second.", category: "Motion" }),
    P.float("runeCount", "Rune Count", { default: 10, min: 4, max: 20, step: 1, tooltip: "Number of runes around the ring (whole numbers).", category: "Runes" }),
    P.float("runeThickness", "Rune Thickness", { default: 0.07, min: 0.02, max: 0.2, tooltip: "Stroke width of the runes (share of the rune cell).", category: "Runes" }),
  );

  const i = s.block("inputs", "Inputs", "Plane UV (0…1, centre ½) and time.", { col: 0, color: COLORS.blue });
  i.n("uv", "uv", {});
  i.n("t", "time", {});
  i.n("polar", "uvPolar", {});
  s.w("uv.out", "polar.uv");

  const rg = s.block("rings", "Rings", "Exact ring SDFs (`abs(|p − c| − r) − thickness/2`): an outer double ring and one inner ring. A negative SDF is inside the line, so the *union* of several shapes is simply their minimum.", { col: 1, row: 0, color: COLORS.cyan });
  rg.n("r1", "sdfRing", { values: { radius: 0.46, thickness: 0.014 } });
  rg.n("r2", "sdfRing", { values: { radius: 0.425, thickness: 0.005 } });
  rg.n("r3", "sdfRing", { values: { radius: 0.25, thickness: 0.008 } });
  rg.n("u1", "sdfUnion", {});
  rg.n("u2", "sdfUnion", {});
  s.w("uv.out", "r1.p").w("uv.out", "r2.p").w("uv.out", "r3.p").w("r1.sdf", "u1.a").w("r2.sdf", "u1.b").w("u1.out", "u2.a").w("r3.sdf", "u2.b");

  const sg = s.block("sigils", "Counter-rotating star + triangle", "A 5-point star and a triangle share the centre and rotate in opposite directions (`rotation = ± time × spin`, degrees). Filled-shape SDFs become outlines with `abs(sdf) − thickness`.", { col: 1, row: 1, color: COLORS.green });
  sg.n("rotA", "multiply", {});
  sg.n("rotB", "multiply", { values: { b: -0.6 } });
  sg.n("star", "sdfStar", { params: { sides: 5 }, values: { radius: 0.23, sharpness: 2.4 } });
  sg.n("tri", "sdfPolygon", { params: { sides: 3 }, values: { radius: 0.25 } });
  sg.n("sa", "abs", {});
  sg.n("ta", "abs", {});
  sg.n("so", "subtract", { values: { b: 0.004 } });
  sg.n("to", "subtract", { values: { b: 0.004 } });
  sg.n("u3", "sdfUnion", {});
  s.w("t.time", "rotA.a", "Time").w(sg.po("spinSpeed"), "rotA.b").w("rotA.out", "rotB.a").w("uv.out", "star.p").w("rotA.out", "star.rotation").w("uv.out", "tri.p").w("rotB.out", "tri.rotation")
    .w("star.sdf", "sa.in").w("sa.out", "so.a").w("tri.sdf", "ta.in").w("ta.out", "to.a").w("so.out", "u3.a").w("to.out", "u3.b");

  const rn = s.block("runes", "Rune ring (procedural runes)", "`polar.x` (turns) + `time × speed` is cut into *Rune Count* sectors: `id = floor(a × N)`, `local.x = fract(a × N)`, `local.y` = radius remapped from 0.29…0.39 to 0…1. Three hashes of the sector id give three points `0.15 + 0.7·h`; the rune is the segment A–B, the segment B–C and a fixed vertical stem — a different glyph for every sector. The result (in rune-cell units) is scaled by 0.1 to world units.", { col: 2, row: 0, color: COLORS.violet });
  rn.n("ang", "split", {});
  rn.n("drift", "multiply", {});
  rn.n("aRot0", "add", {});
  rn.n("aRot", "fract", {});
  rn.n("aN", "multiply", {});
  rn.n("id", "floor", {});
  rn.n("fx", "fract", {});
  rn.n("ly", "remap", { values: { inMin: 0.29, inMax: 0.39, outMin: 0, outMax: 1 } });
  rn.n("local", "combine", {});
  s.w("polar.out", "ang.in").w("t.time", "drift.a", "Time").w(rn.po("runeSpeed"), "drift.b").w("ang.r", "aRot0.a").w("drift.out", "aRot0.b").w("aRot0.out", "aRot.in")
    .w("aRot.out", "aN.a").w(rn.po("runeCount"), "aN.b").w("aN.out", "id.in").w("aN.out", "fx.in").w("polar.radius", "ly.in").w("fx.out", "local.r").w("ly.out", "local.g");
  [["a", 1.7], ["b", 5.3], ["c", 9.1]].forEach(([k, salt]) => {
    rn.n(`k${k}`, "combine", { values: { g: salt as number } });
    rn.n(`h${k}`, "hash2to2", {});
    rn.n(`m${k}`, "multiply", { values: { b: 0.7 } });
    rn.n(`p${k}`, "add", { values: { b: 0.15 } });
    s.w("id.out", `k${k}.r`).w(`k${k}.rg`, `h${k}.in`).w(`h${k}.out`, `m${k}.a`).w(`m${k}.out`, `p${k}.a`);
  });
  rn.n("s1", "sdfSegment", {});
  rn.n("s2", "sdfSegment", {});
  rn.n("s3", "sdfSegment", { values: { a: [0.5, 0.05], b: [0.5, 0.95] } });
  rn.n("ru1", "sdfUnion", {});
  rn.n("ru2", "sdfUnion", {});
  rn.n("runeW", "multiply", { values: { b: 0.1 } });
  s.w("local.rg", "s1.p").w("pa.out", "s1.a").w("pb.out", "s1.b").w(rn.po("runeThickness"), "s1.thickness").w("local.rg", "s2.p").w("pb.out", "s2.a").w("pc.out", "s2.b").w(rn.po("runeThickness"), "s2.thickness")
    .w("local.rg", "s3.p").w(rn.po("runeThickness"), "s3.thickness").w("s1.sdf", "ru1.a").w("s2.sdf", "ru1.b").w("ru1.out", "ru2.a").w("s3.sdf", "ru2.b").w("ru2.out", "runeW.a");

  const m = s.block("merge", "Merge + line + glow", "One SDF for the whole sigil (`min` of everything). *Line* = anti-aliased coverage (`sdfMask`, 1.5 px). *Glow* = `(1 − max(sdf, 0) / size)²` — a quadratic falloff — modulated by a slow `sin` pulse. Both fade out towards the plane's edge so the quad never shows.", { col: 3, color: COLORS.orange });
  m.n("m1", "sdfUnion", {});
  m.n("m2", "sdfUnion", {});
  m.n("line", "sdfMask", { values: { softness: 1.5 } });
  m.n("pos", "maximum", { values: { b: 0 } });
  m.n("gd", "divide", {});
  m.n("gi", "oneMinus", {});
  m.n("gs", "saturate", {});
  m.n("g2", "power", { values: { b: 2 } });
  m.n("ps", "multiply", {});
  m.n("pu", "sin", {});
  m.n("pk", "remap", { values: { outMin: 0.6, outMax: 1 } });
  m.n("gl", "multiply", {});
  m.n("gl2", "multiply", {});
  m.n("ef", "smoothstep", { values: { edge1: 0.46, edge2: 0.5 } });
  m.n("fade", "oneMinus", {});
  s.w("u2.out", "m1.a", "Rings").w("u3.out", "m1.b", "Sigils").w("m1.out", "m2.a").w("runeW.out", "m2.b", "Runes").w("m2.out", "line.sdf").w("m2.out", "pos.a").w("pos.out", "gd.a").w(m.po("glowSize"), "gd.b").w("gd.out", "gi.in").w("gi.out", "gs.in").w("gs.out", "g2.a")
    .w("t.time", "ps.a", "Time").w(m.po("pulseSpeed"), "ps.b").w("ps.out", "pu.in").w("pu.out", "pk.in").w("g2.out", "gl.a").w("pk.out", "gl.b").w("gl.out", "gl2.a").w(m.po("glowStrength"), "gl2.b")
    .w("polar.radius", "ef.in").w("ef.out", "fade.in");

  const c = s.block("color", "Colour + alpha", "`colour = (line colour × line + glow colour × glow) × edge fade`; alpha = saturate(line + glow) × edge fade.", { col: 4, color: COLORS.yellow });
  c.n("c1", "multiply", {});
  c.n("c2", "multiply", {});
  c.n("cs", "add", {});
  c.n("col", "multiply", {});
  c.n("a0", "add", {});
  c.n("a1", "saturate", {});
  c.n("al", "multiply", {});
  s.w(c.po("lineColor"), "c1.a").w("line.mask", "c1.b").w(c.po("glowColor"), "c2.a").w("gl2.out", "c2.b").w("c1.out", "cs.a").w("c2.out", "cs.b").w("cs.out", "col.a").w("fade.out", "col.b")
    .w("line.mask", "a0.a").w("gl2.out", "a0.b").w("a0.out", "a1.in").w("a1.out", "al.a").w("fade.out", "al.b");

  const o = s.block("out", "Master output (URP Unlit, additive)", "Additive blend, ZWrite off, two-sided.", { col: 5, color: COLORS.violet });
  s.master(o);
  s.w("col.out", "master.baseColor").w("al.out", "master.alpha");
  return s;
}
export const magicCircleSample: SampleModule = { meta, build };
