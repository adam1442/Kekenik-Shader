import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { anisoSpec } from "../lib";
import { ALL_TARGETS, defineMeta } from "./common";

const meta = defineMeta({
  id: "brushed-metal", title: "Brushed Anisotropic Metal",
  description: "Brushed steel on a torus: stretched streak noise modulates smoothness and tint, and two Kajiya–Kay highlights (a white primary and a tinted secondary, shifted along the normal) form the long anisotropic streak that follows the tangent direction.",
  tags: ["anisotropic", "brushed", "metal", "kajiya-kay", "tangent", "specular", "lit"], category: "3D / Lit", difficulty: "Advanced", targets: ALL_TARGETS,
  compatNotes: ["URP Lit and Godot have no anisotropy: the highlight is analytic and added as emission (portable). Light direction is a material parameter, like the Toon sample.", "Needs mesh tangents; the streak runs perpendicular to the brush direction (the U direction of the UVs)."],
  requiredFeatures: [], budgetClass: "Desktop", godotProfile: "godot.spatial", reusableSubgraphs: ["ks_aniso_spec"],
  previewConfig: { mode: "3d", mesh: "torus", lighting: { lit: "lit", azimuth: 40, elevation: 45, intensity: 1.2, envIntensity: 1 }, background: { mode: "dark" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.lit" });
  s.add(
    P.color("metalColor", "Metal Color", { default: [0.78, 0.8, 0.84], tooltip: "Tint of the metal (sRGB).", category: "Surface" }),
    P.float("metallic", "Metallic", { default: 1, min: 0, max: 1, tooltip: "Metallic factor.", category: "Surface" }),
    P.float("smoothness", "Base Smoothness", { default: 0.55, min: 0, max: 1, tooltip: "Average smoothness before the brush streaks.", category: "Surface" }),
    P.float("density", "Brush Density", { default: 160, min: 20, max: 600, tooltip: "Streaks across the brushing direction (V).", category: "Brush" }),
    P.float("stretch", "Brush Length", { default: 1.5, min: 0.25, max: 8, tooltip: "Noise cells along the brushing direction (U): lower = longer streaks.", category: "Brush" }),
    P.float("contrast", "Brush Contrast", { default: 0.35, min: 0, max: 1, tooltip: "How much the streaks vary smoothness and tint.", category: "Brush" }),
    P.vec3("lightDir", "Light Direction", { default: [0.5, 0.7, 0.5], tooltip: "Direction FROM the surface TOWARDS the light (world space, normalised in the graph). Drive it from your light's script.", category: "Highlight" }),
    P.color("lightColor", "Light Color", { default: [1.4, 1.35, 1.25], hdr: true, tooltip: "HDR colour of the highlight light.", category: "Highlight" }),
    P.float("exponent", "Highlight Tightness", { default: 90, min: 8, max: 400, tooltip: "Exponent of the primary highlight (higher = thinner streak).", category: "Highlight" }),
    P.float("shift", "Highlight Shift", { default: 0.15, min: -1, max: 1, tooltip: "Moves the primary highlight along the normal; the secondary uses the opposite sign.", category: "Highlight" }),
    P.float("intensity", "Highlight Intensity", { default: 1.4, min: 0, max: 6, tooltip: "Brightness of both highlights.", category: "Highlight" }),
    P.float("secondary", "Secondary Strength", { default: 0.6, min: 0, max: 2, tooltip: "Strength of the tinted second highlight (0 = off).", category: "Highlight" }),
  );
  s.use(anisoSpec());

  const g = s.block("geo", "Geometry", "World normal, view direction and the **tangent** (the brushing direction). The light direction parameter is normalised here.", { col: 0, color: COLORS.blue });
  g.n("wn", "normal", { params: { space: "world" } });
  g.n("v", "viewDirection", { params: { space: "world" } });
  g.n("tan", "meshTangent", { params: { space: "world" } });
  g.n("uv", "uv", {});
  g.n("l", "normalize", {});
  g.n("us", "split", {});
  s.w(g.po("lightDir"), "l.in").w("uv.out", "us.in");

  const b = s.block("brush", "Brush streaks", "Noise sampled at `(u × length, v × density)` — very stretched along U, very fine along V — gives parallel scratches. The value tints the metal slightly and shifts smoothness by `(n − ½) × contrast`.", { col: 1, row: 0, color: COLORS.green });
  b.n("px", "multiply", {});
  b.n("py", "multiply", {});
  b.n("p", "combine", {});
  b.n("n", "noiseValue", { values: { scale: 1 } });
  b.n("centered", "subtract", { values: { b: 0.5 } });
  b.n("dsm", "multiply", {});
  b.n("sm0", "add", {});
  b.n("sm", "saturate", {});
  b.n("tone0", "multiply", {});
  b.n("tone1", "add", { values: { b: 0.9 } });
  b.n("tone", "multiply", {});
  s.w("us.r", "px.a").w(b.po("stretch"), "px.b").w("us.g", "py.a").w(b.po("density"), "py.b").w("px.out", "p.r").w("py.out", "p.g").w("p.rg", "n.p")
    .w("n.out", "centered.a").w("centered.out", "dsm.a").w(b.po("contrast"), "dsm.b").w(b.po("smoothness"), "sm0.a").w("dsm.out", "sm0.b").w("sm0.out", "sm.in")
    .w("dsm.out", "tone0.a").w("tone0.out", "tone1.a").w("tone1.out", "tone.a").w(b.po("metalColor"), "tone.b");

  const h = s.block("spec", "Anisotropic highlights", "Two **Anisotropic Highlight** kits with opposite shifts: a tight primary and a wider secondary (exponent × ⅓) tinted with the metal colour. Both are masked by `saturate(N·L)` so the unlit side stays dark.", { col: 2, color: COLORS.cyan });
  h.sub("s1", "ks_aniso_spec", { label: "Primary" });
  h.sub("s2", "ks_aniso_spec", { label: "Secondary" });
  h.n("neg", "negate", {});
  h.n("e3", "multiply", { values: { b: 0.33 } });
  h.n("sec", "multiply", {});
  h.n("secTint", "multiply", {});
  h.n("sum", "add", {});
  h.n("nl0", "dot", {});
  h.n("nl", "saturate", {});
  h.n("lit", "multiply", {});
  h.n("gain", "multiply", {});
  h.n("em", "multiply", {});
  s.w("tan.out", "s1.tangent", "Tangent").w("wn.out", "s1.normal", "WorldNormal").w("v.out", "s1.viewDir", "ViewDir").w("l.out", "s1.lightDir", "LightDir").w(h.po("exponent"), "s1.exponent").w(h.po("shift"), "s1.shift")
    .w("tan.out", "s2.tangent").w("wn.out", "s2.normal").w("v.out", "s2.viewDir").w("l.out", "s2.lightDir").w("e3.out", "s2.exponent").w(h.po("exponent"), "e3.a").w(h.po("shift"), "neg.in").w("neg.out", "s2.shift")
    .w("s2.spec", "sec.a").w(h.po("secondary"), "sec.b").w("sec.out", "secTint.a").w("tone.out", "secTint.b").w("s1.spec", "sum.a").w("secTint.out", "sum.b")
    .w("wn.out", "nl0.a").w("l.out", "nl0.b").w("nl0.out", "nl.in").w("sum.out", "lit.a").w("nl.out", "lit.b").w("lit.out", "gain.a").w(h.po("intensity"), "gain.b").w("gain.out", "em.a").w(h.po("lightColor"), "em.b");

  const o = s.block("out", "Master output (URP Lit)", "Fully metallic base with streak-varied smoothness; the anisotropic highlight is added as emission.", { col: 3, color: COLORS.violet });
  s.master(o);
  s.w("tone.out", "master.baseColor").w(o.po("metallic"), "master.metallic").w("sm.out", "master.smoothness").w("em.out", "master.emission");
  return s;
}
export const brushedMetalSample: SampleModule = { meta, build };
