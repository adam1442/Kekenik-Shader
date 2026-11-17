import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { anisoSpec } from "../lib";
import { ALL_TARGETS, defineMeta } from "./common";

const meta = defineMeta({
  id: "cloth-sheen", title: "Cloth Sheen (Velvet)",
  description: "Velvet and satin look on the Lit profile: a grazing-angle sheen lobe (1 − N·V)^power brightens the silhouette instead of the centre, the face-on colour is darkened, and a fine thread weave modulates the albedo. An Anisotropy slider blends in a Kajiya–Kay highlight along the mesh tangent for satin-like streaks.",
  tags: ["cloth", "velvet", "sheen", "fabric", "anisotropic", "kajiya-kay", "lit"], category: "3D / Lit", difficulty: "Advanced", targets: ALL_TARGETS,
  compatNotes: ["URP Lit and Godot's standard material have no sheen lobe: the sheen is analytic and added through Emission (portable, but not shadowed by the scene lights). Light direction is a material parameter, like the Toon and Brushed Metal samples.", "Anisotropy > 0 needs mesh tangents; the streak runs along the tangent direction (U of the UVs). At 0 the shader is a pure isotropic velvet."],
  requiredFeatures: [], budgetClass: "Desktop", godotProfile: "godot.spatial", reusableSubgraphs: ["ks_aniso_spec"],
  previewConfig: { mode: "3d", mesh: "sphere", lighting: { lit: "lit", azimuth: 40, elevation: 45, intensity: 1.1, envIntensity: 0.8 }, background: { mode: "dark" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.lit" });
  s.add(
    P.color("fabricColor", "Fabric Color", { default: [0.45, 0.03, 0.09], tooltip: "Base colour of the cloth (sRGB).", category: "Fabric" }),
    P.float("smoothness", "Smoothness", { default: 0.2, min: 0, max: 1, tooltip: "Smoothness of the base layer: cloth is rough, keep it low.", category: "Fabric" }),
    P.float("faceDarken", "Face-On Darkening", { default: 0.5, min: 0, max: 1, tooltip: "Darkens the albedo where the surface faces the camera: velvet is darkest head-on.", category: "Fabric" }),
    P.float("weaveScale", "Weave Scale", { default: 120, min: 20, max: 300, tooltip: "Threads per UV unit.", category: "Weave" }),
    P.float("weaveAmount", "Weave Amount", { default: 0.12, min: 0, max: 0.4, tooltip: "Brightness difference between the two thread directions (0 = smooth cloth).", category: "Weave" }),
    P.color("sheenColor", "Sheen Color", { default: [1.7, 0.55, 0.45], hdr: true, tooltip: "HDR colour of the grazing-angle sheen (linear).", category: "Sheen" }),
    P.float("sheenPower", "Sheen Power", { default: 3, min: 0.5, max: 8, tooltip: "Exponent of (1 − N·V): higher = thinner sheen at the silhouette.", category: "Sheen" }),
    P.float("sheenIntensity", "Sheen Intensity", { default: 1, min: 0, max: 3, tooltip: "Brightness of the sheen.", category: "Sheen" }),
    P.vec3("lightDir", "Light Direction", { default: [0.45, 0.8, 0.4], tooltip: "Direction FROM the surface TOWARDS the light (world space, normalised in the graph). Lit side gets more sheen.", category: "Sheen" }),
    P.float("anisotropy", "Anisotropy", { default: 0, min: 0, max: 1, tooltip: "Blend towards a satin-like streak along the tangent (0 = isotropic velvet).", category: "Anisotropic Option" }),
    P.float("anisoExponent", "Streak Tightness", { default: 40, min: 10, max: 120, tooltip: "Exponent of the Kajiya–Kay streak (larger = narrower).", category: "Anisotropic Option" }),
    P.float("anisoShift", "Streak Shift", { default: 0.15, min: -1, max: 1, tooltip: "Moves the streak along the normal.", category: "Anisotropic Option" }),
  );
  s.use(anisoSpec());

  const i = s.block("inputs", "Surface inputs", "World normal, view direction and tangent, mesh UV and the light direction (normalised once).", { col: 0, color: COLORS.blue });
  i.n("nrm", "normal", { params: { space: "world" } });
  i.n("vd", "viewDirection", { params: { space: "world" } });
  i.n("tan", "meshTangent", { params: { space: "world" } });
  i.n("uv", "uv", {});
  i.n("ld", "normalize", {});
  i.n("nv", "dot", {});
  i.n("nvs", "saturate", {});
  s.w(i.po("lightDir"), "ld.in").w("nrm.out", "nv.a").w("vd.out", "nv.b").w("nv.out", "nvs.in");

  const sh = s.block("sheen", "Grazing sheen lobe", "Velvet fibres stand up and scatter light sideways, so the cloth is brightest where `N·V` is small: `sheen = (1 − N·V)^power`. A half-Lambert term `½·N·L + ½` (weighted `0.35 + 0.65·wrap`) keeps the unlit side from glowing as much.", { col: 1, row: 0, color: COLORS.pink });
  sh.n("inv", "oneMinus", {});
  sh.n("pw", "power", {});
  sh.n("nl", "dot", {});
  sh.n("hl", "multiply", { values: { b: 0.5 } });
  sh.n("wrap", "add", { values: { b: 0.5 } });
  sh.n("ws", "saturate", {});
  sh.n("wm", "multiply", { values: { b: 0.65 } });
  sh.n("wl", "add", { values: { b: 0.35 } });
  sh.n("iso", "multiply", {});
  s.w("nvs.out", "inv.in").w("inv.out", "pw.a").w(sh.po("sheenPower"), "pw.b").w("nrm.out", "nl.a").w("ld.out", "nl.b").w("nl.out", "hl.a").w("hl.out", "wrap.a").w("wrap.out", "ws.in").w("ws.out", "wm.a").w("wm.out", "wl.a")
    .w("pw.out", "iso.a").w("wl.out", "iso.b");

  const an = s.block("aniso", "Anisotropic option", "The shared **Anisotropic Highlight** kit returns a Kajiya–Kay streak along the tangent. `streak = lerp(1, 0.25 + saturate(spec), anisotropy)` modulates the sheen: with Anisotropy 0 nothing changes, at 1 the sheen collapses into tangent-aligned bands (satin, brushed silk).", { col: 1, row: 1, color: COLORS.cyan });
  an.sub("kk", "ks_aniso_spec", { label: "Streak" });
  an.n("ss", "saturate", {});
  an.n("sa", "add", { values: { b: 0.25 } });
  an.n("streak", "lerp", { values: { a: 1 } });
  s.w("tan.out", "kk.tangent").w("nrm.out", "kk.normal").w("vd.out", "kk.viewDir").w("ld.out", "kk.lightDir").w(an.po("anisoExponent"), "kk.exponent").w(an.po("anisoShift"), "kk.shift")
    .w("kk.spec", "ss.in").w("ss.out", "sa.a").w("sa.out", "streak.b").w(an.po("anisotropy"), "streak.t");

  const w = s.block("weave", "Thread weave + face-on darkening", "A checker at *Weave Scale* threads per UV unit: `weave = lerp(1, checker, amount)`. `darken = 1 − faceDarken × (N·V)²`. Albedo = fabric × weave × darken.", { col: 2, row: 1, color: COLORS.green });
  w.n("ws2", "combine", {});
  w.n("chk", "patternChecker", {});
  w.n("wv", "lerp", { values: { a: 1 } });
  w.n("nv2", "multiply", {});
  w.n("dk", "multiply", {});
  w.n("dark", "oneMinus", {});
  w.n("alb0", "multiply", {});
  w.n("alb", "multiply", {});
  s.w(w.po("weaveScale"), "ws2.r").w(w.po("weaveScale"), "ws2.g").w("uv.out", "chk.p").w("ws2.rg", "chk.frequency").w("chk.out", "wv.b").w(w.po("weaveAmount"), "wv.t")
    .w("nvs.out", "nv2.a", "NdotV").w("nvs.out", "nv2.b", "NdotV").w("nv2.out", "dk.a").w(w.po("faceDarken"), "dk.b").w("dk.out", "dark.in")
    .w(w.po("fabricColor"), "alb0.a").w("wv.out", "alb0.b").w("alb0.out", "alb.a").w("dark.out", "alb.b");

  const e = s.block("emit", "Sheen emission", "`emission = sheenColor × sheen × streak × intensity` — added as emissive so it works on every target.", { col: 2, row: 0, color: COLORS.orange });
  e.n("s1", "multiply", {});
  e.n("s2", "multiply", {});
  e.n("em", "multiply", {});
  s.w("iso.out", "s1.a").w("streak.out", "s1.b").w("s1.out", "s2.a").w(e.po("sheenIntensity"), "s2.b").w(e.po("sheenColor"), "em.a").w("s2.out", "em.b");

  const o = s.block("out", "Master output (URP Lit)", "Albedo, low smoothness and the sheen as emission.", { col: 3, color: COLORS.violet });
  s.master(o);
  s.w("alb.out", "master.baseColor").w(o.po("smoothness"), "master.smoothness").w("em.out", "master.emission");
  return s;
}
export const clothSheenSample: SampleModule = { meta, build };
