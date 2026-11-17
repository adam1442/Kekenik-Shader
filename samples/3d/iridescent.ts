import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { thinFilm } from "../lib";
import { ALL_TARGETS, defineMeta } from "./common";

const meta = defineMeta({
  id: "iridescent-thin-film", title: "Iridescent Thin Film",
  description: "Soap-bubble / oil-slick / beetle-shell colours from thin-film interference: a drifting fbm thickness field and the viewing angle select the hue through a reusable Thin Film subgraph, on a glossy metallic base with a faint rim glow.",
  tags: ["iridescent", "thin-film", "oil-slick", "interference", "fresnel", "metallic", "lit"], category: "3D / Lit", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["Art-directable approximation (3 wavelengths as phase offsets), not a spectral simulation.", "The film tint drives Base Color of a metallic surface, so reflections pick up the colour in every engine."],
  requiredFeatures: [], budgetClass: "Desktop", godotProfile: "godot.spatial", reusableSubgraphs: ["ks_thin_film"],
  previewConfig: { mode: "3d", mesh: "sphere", lighting: { lit: "lit", azimuth: 50, elevation: 40, intensity: 1.2, envIntensity: 1.2 }, background: { mode: "dark" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.lit" });
  s.add(
    P.color("baseTone", "Base Tone", { default: [0.03, 0.03, 0.05], tooltip: "Colour of the surface without the film (where Film Strength is low).", category: "Surface" }),
    P.float("strength", "Film Strength", { default: 1, min: 0, max: 1, tooltip: "Blend between the base tone and the interference colours.", category: "Surface" }),
    P.float("metallic", "Metallic", { default: 0.85, min: 0, max: 1, tooltip: "Metallic factor: high values make reflections carry the film colour.", category: "Surface" }),
    P.float("smoothness", "Smoothness", { default: 0.92, min: 0, max: 1, tooltip: "Surface smoothness.", category: "Surface" }),
    P.float("thickMin", "Thickness Min", { default: 0.15, min: 0, max: 1, tooltip: "Thinnest film (arbitrary units).", category: "Film" }),
    P.float("thickMax", "Thickness Max", { default: 0.85, min: 0, max: 1.5, tooltip: "Thickest film (arbitrary units).", category: "Film" }),
    P.float("ior", "Film IOR", { default: 1.45, min: 1, max: 2.6, tooltip: "Refractive index of the film (soap ≈ 1.33, oxide ≈ 2).", category: "Film" }),
    P.float("bands", "Colour Bands", { default: 2.2, min: 0.5, max: 8, tooltip: "How many colour cycles the thickness range sweeps.", category: "Film" }),
    P.float("noiseScale", "Pattern Scale", { default: 3.5, min: 0.5, max: 16, tooltip: "Size of the thickness swirls (UV space).", category: "Pattern" }),
    P.float("drift", "Drift Speed", { default: 0.05, min: 0, max: 0.5, tooltip: "How fast the thickness pattern flows (0 = frozen).", category: "Pattern" }),
    P.float("rimGlow", "Rim Glow", { default: 0.5, min: 0, max: 3, tooltip: "Emission of the film colour at grazing angles.", category: "Surface" }),
  );
  s.use(thinFilm());

  const g = s.block("geo", "Geometry", "World normal and view direction give `N·V`, the angle that shifts the interference colour. UV + time feed the thickness pattern.", { col: 0, color: COLORS.blue });
  g.n("wn", "normal", { params: { space: "world" } });
  g.n("v", "viewDirection", { params: { space: "world" } });
  g.n("uv", "uv", {});
  g.n("t", "time", {});
  g.n("nv0", "dot", {});
  g.n("nv", "saturate", {});
  s.w("wn.out", "nv0.a").w("v.out", "nv0.b").w("nv0.out", "nv.in");

  const th = s.block("thick", "Thickness field", "A slowly drifting 3-octave fbm (`uv + t × drift`) is remapped between *Thickness Min* and *Max*. Real soap films have exactly this kind of flowing thickness variation.", { col: 1, row: 0, color: COLORS.green });
  th.n("dt", "multiply", {});
  th.n("dr", "combine", {});
  th.n("d6", "multiply", { values: { b: 0.6 } });
  th.n("p", "add", {});
  th.n("n", "noiseFbm", { params: { basis: "value", octaves: 3 } });
  th.n("thick", "lerp", {});
  s.w("t.time", "dt.a", "Time").w(th.po("drift"), "dt.b").w("dt.out", "dr.r").w("dt.out", "d6.a").w("d6.out", "dr.g").w("uv.out", "p.a", "UV").w("dr.rg", "p.b")
    .w("p.out", "n.p").w(th.po("noiseScale"), "n.scale").w(th.po("thickMin"), "thick.a").w(th.po("thickMax"), "thick.b").w("n.out", "thick.t");

  const f = s.block("film", "Thin film", "The **Thin Film** subgraph turns thickness, IOR and `N·V` into an interference tint — open it to see the optical-path maths.", { col: 2, color: COLORS.pink });
  f.sub("film", "ks_thin_film", { label: "Film" });
  s.w("nv.out", "film.nDotV", "NdotV").w("thick.out", "film.thickness").w(f.po("ior"), "film.ior").w(f.po("bands"), "film.bands");

  const c = s.block("mix", "Colour + rim", "Base colour = `lerp(baseTone, film, strength)`. A cubic rim `(1 − N·V)³` adds a soft emissive edge in the film colour.", { col: 3, color: COLORS.orange });
  c.n("base", "lerp", {});
  c.n("rim0", "oneMinus", {});
  c.n("rim", "power", { values: { b: 3 } });
  c.n("rg", "multiply", {});
  c.n("em", "multiply", {});
  s.w(c.po("baseTone"), "base.a").w("film.color", "base.b").w(c.po("strength"), "base.t").w("nv.out", "rim0.in").w("rim0.out", "rim.a").w("rim.out", "rg.a").w(c.po("rimGlow"), "rg.b")
    .w("film.color", "em.a").w("rg.out", "em.b");

  const o = s.block("out", "Master output (URP Lit)", "Metallic, glossy surface tinted by the film; rim emission on top.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("base.out", "master.baseColor").w(o.po("metallic"), "master.metallic").w(o.po("smoothness"), "master.smoothness").w("em.out", "master.emission");
  return s;
}
export const iridescentSample: SampleModule = { meta, build };
