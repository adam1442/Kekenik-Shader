import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { matcapTex } from "../textures/gen-surface";
import { ALL_TARGETS, defineMeta } from "./common";

const meta = defineMeta({
  id: "crystal-gem", title: "Crystal Gem (Matcap + Fake Refraction)",
  description: "Faceted gem without ray tracing: the normal is quantised into flat facets, a matcap supplies the shell reflection, and three matcap lookups along per-channel bent directions fake the light refracted inside the stone — with chromatic dispersion — plus a fresnel-weighted outer reflection.",
  tags: ["gem", "crystal", "matcap", "refraction", "dispersion", "facets", "lit"], category: "3D / Lit", difficulty: "Advanced", targets: ALL_TARGETS,
  compatNotes: ["No scene-colour or screen-space resources are used: works on every target and in every render pipeline.", "Any matcap texture can be dropped into the Matcap Map slot (view-space normal lookup)."],
  requiredFeatures: [], budgetClass: "Desktop", godotProfile: "godot.spatial", thumbnailSlot: "emission",
  previewConfig: { mode: "3d", mesh: "sphere", lighting: { lit: "lit", azimuth: 40, elevation: 45, intensity: 1.2, envIntensity: 1 }, background: { mode: "dark" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.lit" });
  s.add(
    P.tex("matcapMap", "Matcap Map", { default: "grey", tooltip: "Sphere-shaded environment used for the reflection and the fake refraction.", category: "Maps" }),
    P.color("gemColor", "Gem Color", { default: [0.2, 0.65, 1], tooltip: "Colour of the stone (sRGB).", category: "Gem" }),
    P.float("facets", "Facet Count", { default: 4, min: 1.5, max: 12, tooltip: "Normal quantisation steps per axis: lower = bigger flat facets.", category: "Gem" }),
    P.float("facetBlend", "Facet Amount", { default: 1, min: 0, max: 1, tooltip: "0 = smooth sphere, 1 = fully faceted.", category: "Gem" }),
    P.float("bend", "Refraction Bend", { default: 0.72, min: 0, max: 1, tooltip: "How far the inner ray bends away from the view direction.", category: "Refraction" }),
    P.float("dispersion", "Dispersion", { default: 0.22, min: 0, max: 0.6, tooltip: "Per-channel difference of the bend (chromatic dispersion).", category: "Refraction" }),
    P.float("innerGain", "Inner Light", { default: 1.7, min: 0, max: 5, tooltip: "Brightness of the refracted light.", category: "Refraction" }),
    P.float("reflGain", "Reflection", { default: 1.2, min: 0, max: 4, tooltip: "Brightness of the shell reflection.", category: "Reflection" }),
    P.float("fresnelPower", "Fresnel Power", { default: 3, min: 0.5, max: 8, tooltip: "Falloff of the outer reflection towards the centre of the stone.", category: "Reflection" }),
    P.float("smoothness", "Smoothness", { default: 0.95, min: 0, max: 1, tooltip: "Specular smoothness (real light highlights on top of the matcap).", category: "Reflection" }),
  );
  s.texture("matcapMap", "gem-matcap", matcapTex(128));

  const g = s.block("geo", "Normals", "View-space normal (matcap space) and world normal / view direction (fresnel).", { col: 0, color: COLORS.blue });
  g.n("nv", "normal", { params: { space: "view" } });
  g.n("wn", "normal", { params: { space: "world" } });
  g.n("v", "viewDirection", { params: { space: "world" } });

  const f = s.block("facet", "Facets", "`round(N × count) / count` snaps the normal to a coarse grid of directions; every grid cell is one flat facet. A small epsilon avoids a zero vector; *Facet Amount* blends from the smooth to the faceted normal.", { col: 1, color: COLORS.green });
  f.n("sc", "multiply", {});
  f.n("rd", "round", {});
  f.n("eps", "add", { values: { b: 0.0001 } });
  f.n("qn", "normalize", {});
  f.n("mix", "lerp", {});
  f.n("fn", "normalize", {});
  s.w("nv.out", "sc.a").w(f.po("facets"), "sc.b").w("sc.out", "rd.in").w("rd.out", "eps.a").w("eps.out", "qn.in").w("nv.out", "mix.a").w("qn.out", "mix.b").w(f.po("facetBlend"), "mix.t").w("mix.out", "fn.in");

  const r = s.block("refl", "Shell reflection", "Matcap lookup with the faceted normal, weighted by fresnel `(1 − N·V)^power` so the reflection hugs the silhouette like a polished surface.", { col: 2, row: 0, color: COLORS.cyan });
  r.n("mc", "matcap", {});
  r.n("fr", "fresnel", {});
  r.n("rf", "multiply", {});
  r.n("rg", "multiply", {});
  s.w(r.po("matcapMap"), "mc.tex").w("fn.out", "mc.normal", "FacetNormal").w("wn.out", "fr.normal").w("v.out", "fr.viewDir").w(r.po("fresnelPower"), "fr.power")
    .w("mc.color", "rf.a").w("fr.out", "rf.b").w("rf.out", "rg.a").w(r.po("reflGain"), "rg.b");

  const i = s.block("inner", "Fake refraction", "Inner ray `d = normalize(lerp(I, −N, bend))` with `I = (0, 0, −1)` in view space. Red / green / blue use `bend × (1 − k)`, `bend`, `bend × (1 + k)` (k = dispersion), so the channels land on different matcap texels — the rainbow fringes of a real gem. One matcap fetch per channel.", { col: 2, row: 1, color: COLORS.pink });
  i.n("nn", "negate", {});
  i.n("omd", "oneMinus", {});
  i.n("opd", "add", { values: { b: 1 } });
  i.n("bR", "multiply", {});
  i.n("bB", "multiply", {});
  for (const ch of ["R", "G", "B"] as const) {
    i.n(`l${ch}`, "lerp", { values: { a: [0, 0, -1] } });
    i.n(`d${ch}`, "normalize", {});
    i.n(`m${ch}`, "matcap", {});
    i.n(`s${ch}`, "split", {});
  }
  i.n("rgb", "combine", {});
  i.n("tint", "multiply", {});
  i.n("inner", "multiply", {});
  s.w("fn.out", "nn.in").w(i.po("dispersion"), "omd.in").w(i.po("dispersion"), "opd.a").w(i.po("bend"), "bR.a").w("omd.out", "bR.b").w(i.po("bend"), "bB.a").w("opd.out", "bB.b");
  for (const [ch, bend] of [["R", "bR.out"], ["G", i.po("bend")], ["B", "bB.out"]] as const) {
    s.w("nn.out", `l${ch}.b`).w(bend, `l${ch}.t`).w(`l${ch}.out`, `d${ch}.in`).w(i.po("matcapMap"), `m${ch}.tex`).w(`d${ch}.out`, `m${ch}.normal`).w(`m${ch}.color`, `s${ch}.in`);
  }
  s.w("sR.r", "rgb.r").w("sG.g", "rgb.g").w("sB.b", "rgb.b").w("rgb.rgb", "tint.a").w(i.po("gemColor"), "tint.b").w("tint.out", "inner.a").w(i.po("innerGain"), "inner.b");

  const m = s.block("mix", "Combine", "`emission = inner × gem colour × gain + reflection`. The albedo is a dark version of the gem colour so real scene lights still add a glossy specular highlight.", { col: 3, color: COLORS.orange });
  m.n("em", "add", {});
  m.n("base", "multiply", { values: { b: 0.25 } });
  s.w("inner.out", "em.a").w("rg.out", "em.b").w(m.po("gemColor"), "base.a");

  const o = s.block("out", "Master output (URP Lit)", "Dark tinted base, very smooth, everything else is emission.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("base.out", "master.baseColor").w(o.po("smoothness"), "master.smoothness").w("em.out", "master.emission");
  return s;
}
export const crystalGemSample: SampleModule = { meta, build };
