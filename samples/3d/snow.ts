import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { ALL_TARGETS, defineMeta } from "./common";

const meta = defineMeta({
  id: "snow-sparkle", title: "Snow with Sparkle",
  description: "Soft snow with a fbm bump and view-dependent ice glints: every grid cell holds a tiny mirror flake with a random orientation that only lights up when it reflects the sun towards the camera, so the sparkles twinkle as you orbit.",
  tags: ["snow", "sparkle", "glitter", "flakes", "lit", "procedural"], category: "3D / Lit", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["The sun direction is a material parameter (like the Toon sample) so the look is identical on every target; drive it from your light's script.", "Flake cells are a jittered 3D grid in object space (one hash per cell, no neighbour search) — no UVs, no seams, sparkles stay glued to the mesh."],
  requiredFeatures: [], budgetClass: "Desktop", godotProfile: "godot.spatial",
  previewConfig: { mode: "3d", mesh: "sphere", lighting: { lit: "lit", azimuth: 35, elevation: 38, intensity: 1.2 }, background: { mode: "gradient" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.lit" });
  s.add(
    P.color("snowColor", "Snow Color", { default: [0.93, 0.96, 1], tooltip: "Albedo of the snow in light areas.", category: "Surface" }),
    P.color("shadeColor", "Shade Color", { default: [0.62, 0.72, 0.9], tooltip: "Cool blue-ish albedo in the dips of the bump (fake sub-surface scattering).", category: "Surface" }),
    P.float("smoothness", "Smoothness", { default: 0.3, min: 0, max: 1, tooltip: "Specular smoothness of the snow surface.", category: "Surface" }),
    P.float("bumpScale", "Bump Scale", { default: 14, min: 2, max: 48, tooltip: "Frequency of the snow bumps (UV space).", category: "Bump" }),
    P.float("bumpStrength", "Bump Strength", { default: 0.8, min: 0, max: 3, tooltip: "Strength of the bump normal.", category: "Bump" }),
    P.color("sparkleColor", "Sparkle Color", { default: [1.5, 1.7, 2.2], hdr: true, tooltip: "HDR colour of the glints (values above 1 bloom).", category: "Sparkle" }),
    P.vec3("lightDir", "Light Direction", { default: [0.5, 0.65, 0.55], tooltip: "Direction FROM the surface TOWARDS the sun (world space, normalised in the graph). Drive it from your light's script.", category: "Sparkle" }),
    P.float("density", "Flake Density", { default: 40, min: 8, max: 160, tooltip: "Grid cells per object unit — more cells = finer glitter.", category: "Sparkle" }),
    P.float("size", "Flake Size", { default: 0.2, min: 0.03, max: 0.25, tooltip: "Radius of one flake as a fraction of its cell (max 0.25 keeps the flake inside its cell).", category: "Sparkle" }),
    P.float("sharpness", "Glint Sharpness", { default: 90, min: 8, max: 400, tooltip: "Exponent of the glint: higher = narrower range of view angles that sparkle.", category: "Sparkle" }),
    P.float("flakeTilt", "Flake Tilt", { default: 1.4, min: 0.1, max: 4, tooltip: "How far random flakes tilt away from the surface normal (larger = more glints, less coherent).", category: "Sparkle" }),
    P.float("intensity", "Sparkle Intensity", { default: 4, min: 0, max: 12, tooltip: "Brightness of the glints.", category: "Sparkle" }),
    P.float("twinkle", "Twinkle", { default: 0.35, min: 0, max: 1, tooltip: "Per-flake brightness flicker over time (0 = none).", category: "Sparkle" }),
  );

  const g = s.block("geo", "Geometry + light", "Object-space position drives the flake cells; world normal, view and the *Light Direction* parameter decide when a flake reflects light into the camera. Shared through portals.", { col: 0, color: COLORS.blue });
  g.n("opos", "position", { params: { space: "object" } });
  g.n("wn", "normal", { params: { space: "world" } });
  g.n("v", "viewDirection", { params: { space: "world" } });
  g.n("l0", "normalize", {});
  g.n("t", "time", {});
  g.n("uv", "uv", {});

  const b = s.block("bump", "Snow bump", "Two octaves of cheap value-fbm are the height; **Height To Normal** (fast kernel) turns it into a tangent-space normal for the Lit master. The same height tints dips with the shade colour and darkens crevices (occlusion).", { col: 1, row: 0, color: COLORS.green });
  b.n("fbm", "noiseFbm", { params: { basis: "value", octaves: 2 } });
  b.n("nrm", "heightToNormal", { params: { quality: "fast" } });
  b.n("hmix", "remap", { values: { inMin: 0.25, inMax: 0.75, outMin: 0, outMax: 1 } });
  b.n("hsat", "saturate", {});
  b.n("albedo", "lerp", {});
  b.n("ao", "remap", { values: { inMin: 0, inMax: 1, outMin: 0.6, outMax: 1 } });
  s.w(g.po("lightDir"), "l0.in").w("uv.out", "fbm.p", "UV").w(b.po("bumpScale"), "fbm.scale").w("fbm.out", "nrm.height").w("uv.out", "nrm.uv").w(b.po("bumpStrength"), "nrm.strength")
    .w("fbm.out", "hmix.in").w("hmix.out", "hsat.in").w(b.po("shadeColor"), "albedo.a").w(b.po("snowColor"), "albedo.b").w("hsat.out", "albedo.t").w("hsat.out", "ao.in");

  const f = s.block("flake", "Flake cells", "Object position × density is split into an integer **cell** and a fractional position inside it. One hash of the cell gives a random vector: it jitters the flake centre (±¼ of the cell) and tilts the flake normal `normalize(N + d × tilt)`. A radial mask keeps a small disc per cell.", { col: 1, row: 1, color: COLORS.cyan });
  f.n("pd", "multiply", {});
  f.n("cell", "floor", {});
  f.n("fr", "fract", {});
  f.n("rnd", "hash3to3", {});
  f.n("cid", "hash3to1", {});
  f.n("jit", "multiply", { values: { b: 0.5 } });
  f.n("ctr", "add", { values: { b: 0.25 } });
  f.n("dv", "subtract", {});
  f.n("dist", "length", {});
  f.n("d1", "multiply", { values: { b: 2 } });
  f.n("d2", "subtract", { values: { b: 1 } });
  f.n("tilt", "multiply", {});
  f.n("fn0", "add", {});
  f.n("fn", "normalize", {});
  f.n("mask", "smoothstep", { values: { edge1: 0 } });
  f.n("disc", "oneMinus", {});
  s.w("opos.out", "pd.a", "ObjectPos").w(f.po("density"), "pd.b").w("pd.out", "cell.in").w("pd.out", "fr.in").w("cell.out", "rnd.in").w("cell.out", "cid.in")
    .w("rnd.out", "jit.a").w("jit.out", "ctr.a").w("fr.out", "dv.a").w("ctr.out", "dv.b").w("dv.out", "dist.in")
    .w("rnd.out", "d1.a").w("d1.out", "d2.a").w("d2.out", "tilt.a").w(f.po("flakeTilt"), "tilt.b")
    .w("wn.out", "fn0.a", "WorldNormal").w("tilt.out", "fn0.b").w("fn0.out", "fn.in").w(f.po("size"), "mask.edge2").w("dist.out", "mask.in").w("mask.out", "disc.in");

  const gl = s.block("glint", "Glint", "Half vector `H = normalize(L + V)`; a flake glints when its normal lines up with H: `pow(saturate(F·H), sharpness)`. Multiplied by the disc mask, the sun-facing term and a per-flake twinkle `½ + ½·sin(t·3 + id·37)` (id = cell hash) blended by *Twinkle*.", { col: 2, color: COLORS.yellow });
  gl.n("h0", "add", {});
  gl.n("h", "normalize", {});
  gl.n("fh", "dot", {});
  gl.n("fhs", "saturate", {});
  gl.n("pw", "power", {});
  gl.n("nl", "dot", {});
  gl.n("nls", "saturate", {});
  gl.n("tw1", "multiply", { values: { b: 37 } });
  gl.n("tw2", "multiply", { values: { b: 3 } });
  gl.n("tw3", "add", {});
  gl.n("tw4", "sin", {});
  gl.n("tw5", "remap", { values: { inMin: -1, inMax: 1, outMin: 0, outMax: 1 } });
  gl.n("tw6", "lerp", { values: { a: 1 } });
  gl.n("g1", "multiply", {});
  gl.n("g2", "multiply", {});
  gl.n("g3", "multiply", {});
  s.w("l0.out", "h0.a", "SunDir").w("v.out", "h0.b", "ViewDir").w("h0.out", "h.in").w("fn.out", "fh.a").w("h.out", "fh.b").w("fh.out", "fhs.in").w("fhs.out", "pw.a").w(gl.po("sharpness"), "pw.b")
    .w("wn.out", "nl.a").w("l0.out", "nl.b").w("nl.out", "nls.in")
    .w("cid.out", "tw1.a").w("t.time", "tw2.a", "Time").w("tw2.out", "tw3.a").w("tw1.out", "tw3.b").w("tw3.out", "tw4.in").w("tw4.out", "tw5.in").w("tw5.out", "tw6.b").w(gl.po("twinkle"), "tw6.t")
    .w("pw.out", "g1.a").w("disc.out", "g1.b").w("g1.out", "g2.a").w("nls.out", "g2.b").w("g2.out", "g3.a").w("tw6.out", "g3.b");

  const e = s.block("emit", "Sparkle emission", "`emission = sparkleColor × glint × intensity` — emission is HDR, so strong glints bloom in the preview and in URP/Godot with Bloom enabled.", { col: 3, color: COLORS.orange });
  e.n("sp", "multiply", {});
  e.n("em", "multiply", {});
  s.w(e.po("sparkleColor"), "sp.a").w("g3.out", "sp.b").w("sp.out", "em.a").w(e.po("intensity"), "em.b");

  const o = s.block("out", "Master output (URP Lit)", "Tangent-space bump normal, tinted albedo, crevice occlusion and glint emission.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("albedo.out", "master.baseColor").w("nrm.normal", "master.normalTS").w(o.po("smoothness"), "master.smoothness").w("ao.out", "master.occlusion").w("em.out", "master.emission");
  return s;
}
export const snowSparkleSample: SampleModule = { meta, build };
