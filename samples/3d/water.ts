import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { depthIntersect, flowSample, fresnelKit, gerstnerWave } from "../lib";
import { waterTextures } from "../textures/gen";
import { defineMeta } from "./common";

const meta = defineMeta({
  id: "stylized-water", title: "Stylized Water (Gerstner, Foam, Refraction)",
  description: "Three summed Gerstner waves displace the vertices, a flow-mapped ripple normal map shades the surface, depth intersection draws shore foam and the deep/shallow gradient, Scene Color gives fake refraction and a fresnel term adds a sky reflection.",
  tags: ["water", "gerstner", "depth-foam", "refraction", "fresnel", "transparent"], category: "3D / Lit", difficulty: "Advanced", targets: ["glsl", "unity", "godot"],
  compatNotes: ["Scene Depth / Scene Color are engine resources: not available in the HLSL / WGSL snippet targets (no host to supply them).", "The preview emulates both; drop the Depth-Intersector object into the Preview to see foam."],
  requiredFeatures: ["URP Depth Texture", "URP Opaque Texture", "Material set to Transparent"], budgetClass: "Desktop", godotProfile: "godot.spatial",
  reusableSubgraphs: ["ks_gerstner_wave", "ks_depth_intersect", "ks_flow_sample", "ks_fresnel_kit"],
  previewConfig: { mode: "3d", mesh: "sphere", lighting: { lit: "lit", azimuth: 35, elevation: 55 }, intersector: { kind: "sphere", position: [0.35, -0.1, 0.25], scale: 0.55 }, simulation: { depthTexture: true, opaqueTexture: true } },
});
const wt = waterTextures(128, 5);

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.lit", settings: { blend: "alpha" } });
  const W = "Waves", C = "Color", F = "Foam", R = "Ripples";
  s.add(
    P.float("steepness", "Wave Steepness", { default: 0.3, min: 0, max: 0.9, tooltip: "Total steepness of the three waves (0 = flat, 0.9 = sharp crests).", category: W }),
    P.float("wavelength", "Wavelength", { default: 0.9, min: 0.2, max: 4, tooltip: "Length of the longest wave (object units).", category: W }),
    P.float("waveSpeed", "Wave Speed", { default: 1, min: 0, max: 3, tooltip: "Time multiplier of all waves.", category: W }),
    P.color("shallow", "Shallow Color", { default: [0.2, 0.75, 0.75], tooltip: "Colour where the water is thin (sRGB).", category: C }),
    P.color("deep", "Deep Color", { default: [0.02, 0.18, 0.4], tooltip: "Colour where the water is deep (sRGB).", category: C }),
    P.float("depthRange", "Depth Range", { default: 1.2, min: 0.1, max: 6, tooltip: "Distance over which shallow turns into deep (world units).", category: C }),
    P.float("refraction", "Refraction", { default: 0.04, min: 0, max: 0.2, tooltip: "Screen-space distortion strength of the background.", category: C }),
    P.color("sky", "Sky Reflection", { default: [0.55, 0.75, 1.0], hdr: true, tooltip: "Colour reflected at grazing angles (fresnel).", category: C }),
    P.float("fresnelPower", "Fresnel Power", { default: 4, min: 0.5, max: 10, tooltip: "Fresnel falloff.", category: C }),
    P.color("foamColor", "Foam Color", { default: [0.95, 0.98, 1], tooltip: "Colour of the shoreline foam (sRGB).", category: F }),
    P.float("foamWidth", "Foam Width", { default: 0.35, min: 0.02, max: 2, tooltip: "Reach of the foam from intersecting geometry.", category: F }),
    P.float("foamNoise", "Foam Breakup", { default: 7, min: 1, max: 24, tooltip: "Scale of the noise that breaks the foam line.", category: F }),
    P.tex("ripples", "Ripple Normal", { default: "bump", tooltip: "Tangent-space ripple normal map (tileable).", category: R }),
    P.tex("flow", "Flow Map", { default: "grey", tooltip: "Flow vectors (RG, 0.5 = still). Linear data.", category: R }),
    P.float("rippleTile", "Ripple Tiling", { default: 3, min: 0.5, max: 12, tooltip: "Ripple repeats per world unit.", category: R }),
    P.float("rippleStrength", "Ripple Strength", { default: 0.8, min: 0, max: 2, tooltip: "Strength of the ripple normals.", category: R }),
  );
  s.texture("ripples", "water-ripples", wt.normal).texture("flow", "water-flow", wt.flow);
  s.use(gerstnerWave()).use(depthIntersect()).use(flowSample()).use(fresnelKit());

  const t = s.block("time", "Inputs", "Time, the world-space position (ripples and foam are laid out in world XZ so they do not swim with the mesh) and the world normal / view direction.", { col: 0, color: COLORS.blue });
  t.n("t", "time", {});
  t.n("wpos", "position", { params: { space: "world" } });
  t.n("opos", "position", { params: { space: "object" } });
  t.n("nrm", "normal", { params: { space: "world" } });
  t.n("vdir", "viewDirection", { params: { space: "world" } });
  t.n("xs", "split", {});
  t.n("xz", "combine", {});
  s.w("wpos.out", "xs.in").w("xs.r", "xz.r").w("xs.b", "xz.g");

  const w = s.block("waves", "Gerstner waves (vertex)", "Three **Gerstner wave** kits with different directions, wavelengths (×1, ×0.55, ×0.3) and steepness (×0.5, ×0.3, ×0.2 of the total, so crests never loop). Offsets add to the position; the normal deltas add to `(0,1,0)` and are normalised.", { col: 1, row: 0, color: COLORS.blue });
  w.n("tt", "multiply", {});
  const dirs: Array<[string, number[], number, number]> = [["a", [1, 0.2], 0.5, 1], ["b", [0.6, 0.8], 0.3, 0.55], ["c", [-0.4, 0.9], 0.2, 0.3]];
  for (const [k, d, st, wl] of dirs) {
    w.n(`st_${k}`, "multiply", { values: { b: st } });
    w.n(`wl_${k}`, "multiply", { values: { b: wl } });
    w.sub(`g_${k}`, "ks_gerstner_wave", { label: `Wave ${k.toUpperCase()}`, values: { dir: d } });
    s.w(w.po("steepness"), `st_${k}.a`).w(w.po("wavelength"), `wl_${k}.a`).w(`st_${k}.out`, `g_${k}.steepness`).w(`wl_${k}.out`, `g_${k}.wavelength`)
      .w("opos.out", `g_${k}.pos`, "ObjPos").w("tt.out", `g_${k}.time`);
  }
  w.n("o1", "add", {}); w.n("o2", "add", {}); w.n("newPos", "add", {});
  w.n("n1", "add", {}); w.n("n2", "add", {}); w.n("n3", "add", { values: { b: [0, 1, 0] } }); w.n("newNrm", "normalize", {});
  s.w("t.time", "tt.a", "Time").w(w.po("waveSpeed"), "tt.b")
    .w("g_a.offset", "o1.a").w("g_b.offset", "o1.b").w("o1.out", "o2.a").w("g_c.offset", "o2.b").w("opos.out", "newPos.a", "ObjPos").w("o2.out", "newPos.b")
    .w("g_a.nrm", "n1.a").w("g_b.nrm", "n1.b").w("n1.out", "n2.a").w("g_c.nrm", "n2.b").w("n2.out", "n3.a").w("n3.out", "newNrm.in");

  const rp = s.block("ripple", "Ripple normals (flow map)", "The **Flow Map Sample** kit advects the ripple normal map along the flow texture with two phase-shifted layers; the result is decoded and scaled. Coordinates are world XZ × tiling.", { col: 1, row: 1, color: COLORS.cyan });
  rp.n("uvs", "multiply", {});
  rp.sub("flow", "ks_flow_sample", { label: "Ripples", values: { strength: 0.2, speed: 0.35 } });
  rp.n("unpack", "normalUnpack", {});
  rp.n("scaled", "normalStrength", {});
  s.w("xz.rg", "uvs.a", "XZ").w(rp.po("rippleTile"), "uvs.b").w("uvs.out", "flow.uv").w(rp.po("ripples"), "flow.tex").w(rp.po("flow"), "flow.flow").w("t.time", "flow.time", "Time")
    .w("flow.color", "unpack.in").w("unpack.out", "scaled.in").w(rp.po("rippleStrength"), "scaled.strength");

  const d = s.block("depth", "Depth: gradient + foam", "Two **Depth Intersection** kits: one with the *Depth Range* gives the shallow→deep gradient, one with the *Foam Width* gives the shoreline mask `1 − fade`. A single value-noise evaluation breaks the foam line: `foam = smoothstep(0.45, 0.55, mask + (noise − 0.5) × 0.7)`.", { col: 2, row: 0, color: COLORS.red });
  d.sub("depthColor", "ks_depth_intersect", { label: "Depth (gradient)" });
  d.sub("depthFoam", "ks_depth_intersect", { label: "Depth (foam)" });
  d.n("shore", "oneMinus", {});
  d.n("fxz", "multiply", {});
  d.n("drift", "multiply", { values: { b: 0.15 } });
  d.n("fuv", "add", {});
  d.n("noise", "noiseValue", {});
  d.n("nc", "subtract", { values: { b: 0.5 } });
  d.n("nk", "multiply", { values: { b: 0.7 } });
  d.n("score", "add", {});
  d.n("foam", "smoothstep", { values: { edge1: 0.45, edge2: 0.55 } });
  s.w(d.po("depthRange"), "depthColor.distance").w(d.po("foamWidth"), "depthFoam.distance").w("depthFoam.fade", "shore.in")
    .w("xz.rg", "fxz.a", "XZ").w("t.time", "drift.a", "Time").w("fxz.out", "fuv.a").w("drift.out", "fuv.b").w("fuv.out", "noise.p").w(d.po("foamNoise"), "noise.scale")
    .w("noise.out", "nc.a").w("nc.out", "nk.a").w("shore.out", "score.a").w("nk.out", "score.b").w("score.out", "foam.in");
  d.n("fscale", "float", { values: { x: 1 } });
  s.w("fscale.out", "fxz.b");

  const rf = s.block("refr", "Fake refraction + reflection", "**Distortion Offset** bends the screen UV by the ripple normal (view space), **Scene Color** reads the opaque scene there. The **Fresnel kit** adds the sky colour at grazing angles — a cheap stand-in for a reflection probe.", { col: 2, row: 1, color: COLORS.violet });
  rf.n("dist", "distortionOffset", { params: { mode: "normal", clamp: true } });
  rf.n("scene", "sceneColor", {});
  rf.sub("fres", "ks_fresnel_kit", { label: "Sky", values: { intensity: 1 } });
  s.w("scaled.out", "dist.normal").w(rf.po("refraction"), "dist.strength").w("dist.uv", "scene.uv")
    .w("nrm.out", "fres.normal", "N").w("vdir.out", "fres.viewDir", "V").w(rf.po("sky"), "fres.color").w(rf.po("fresnelPower"), "fres.power");

  const m = s.block("mix", "Surface mix", "`water = lerp(shallow, deep, fade)`, tinted refraction replaces part of it near the shore, foam wins over everything. Smoothness drops under foam; alpha rises with depth and under foam.", { col: 3, color: COLORS.orange });
  m.n("body", "lerp", {});
  m.n("refr", "multiply", {});
  m.n("shoreMix", "multiply", { values: { b: 0.6 } });
  m.n("withRefr", "lerp", {});
  m.n("withFoam", "lerp", {});
  m.n("smooth", "lerp", { values: { a: 0.93, b: 0.25 } });
  m.n("alphaBody", "lerp", { values: { a: 0.45, b: 0.95 } });
  m.n("alpha", "maximum", {});
  m.n("sat", "saturate", {});
  m.n("glow", "multiply", { values: { b: 0.5 } });
  s.w(m.po("shallow"), "body.a").w(m.po("deep"), "body.b").w("depthColor.fade", "body.t")
    .w("scene.out", "refr.a").w("body.out", "refr.b").w("shore.out", "shoreMix.a").w("shoreMix.out", "sat.in")
    .w("body.out", "withRefr.a").w("refr.out", "withRefr.b").w("sat.out", "withRefr.t")
    .w("withRefr.out", "withFoam.a").w(m.po("foamColor"), "withFoam.b").w("foam.out", "withFoam.t")
    .w("foam.out", "smooth.t").w("depthColor.fade", "alphaBody.t").w("alphaBody.out", "alpha.a").w("foam.out", "alpha.b").w("fres.glow", "glow.a");

  const o = s.block("out", "Master output (URP Lit, transparent)", "Vertex: displaced position + wave normal. Fragment: colour, ripple normal, smoothness, sky reflection as emission, alpha.", { col: 4, color: COLORS.green });
  s.master(o);
  s.w("newPos.out", "master.positionOS").w("newNrm.out", "master.normalOS").w("withFoam.out", "master.baseColor").w("scaled.out", "master.normalTS")
    .w("smooth.out", "master.smoothness").w("glow.out", "master.emission").w("alpha.out", "master.alpha");
  return s;
}
export const waterSample: SampleModule = { meta, build };
