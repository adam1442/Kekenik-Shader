import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { fresnelKit, toonLight } from "../lib";
import { ALL_TARGETS, defineMeta } from "./common";

const meta = defineMeta({
  id: "stylized-toon", title: "Stylized Toon (Ramp + Rim + Outline)",
  description: "Three-band cel shading from the main light, a hard specular highlight, a fresnel rim and a view-dependent fake outline — all in one unlit pass, no extra geometry.",
  tags: ["toon", "cel", "rim", "outline", "stylized"], category: "3D / Lit", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["The light direction is a material parameter (not the engine light), so the look is identical on every target; to follow a scene light, replace the Light Direction property by the Main Light Direction node (Unity / generic targets only — Godot has no main-light node in fragment())."],
  requiredFeatures: [], budgetClass: "Mobile", godotProfile: "godot.spatial", reusableSubgraphs: ["ks_toon_light", "ks_fresnel_kit"],
  previewConfig: { mode: "3d", mesh: "sphere", lighting: { lit: "unlit", azimuth: 40, elevation: 45 }, background: { mode: "gradient" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.unlit" });
  s.add(
    P.vec3("lightDir", "Light Direction", { default: [0.45, 0.8, 0.4], tooltip: "Direction FROM the surface TOWARDS the light (world space; normalised in the graph). Drive it from your light's script — the shader is engine-light independent and identical on every target.", category: "Cel Shading" }),
    P.color("lit", "Lit Color", { default: [0.95, 0.62, 0.38], tooltip: "Colour of the brightest band (sRGB).", category: "Cel Shading" }),
    P.color("shadow", "Shadow Color", { default: [0.28, 0.2, 0.45], tooltip: "Colour of the darkest band (sRGB).", category: "Cel Shading" }),
    P.float("softness", "Band Softness", { default: 0.02, min: 0, max: 0.3, tooltip: "Width of the band edges: 0 = hard cel, 0.3 = painterly.", category: "Cel Shading" }),
    P.color("specColor", "Specular Color", { default: [1, 0.95, 0.85], tooltip: "Colour of the hard highlight (sRGB).", category: "Specular" }),
    P.float("specSize", "Specular Size", { default: 0.06, min: 0, max: 0.4, tooltip: "Size of the highlight (0 = off).", category: "Specular" }),
    P.color("rimColor", "Rim Color", { default: [1.2, 0.9, 0.7], hdr: true, tooltip: "HDR rim colour (values above 1 bloom).", category: "Rim" }),
    P.float("rimPower", "Rim Power", { default: 3.5, min: 0.5, max: 10, tooltip: "Rim falloff: higher = thinner rim.", category: "Rim" }),
    P.float("rimIntensity", "Rim Intensity", { default: 0.6, min: 0, max: 2, tooltip: "Strength of the rim light.", category: "Rim" }),
    P.color("outlineColor", "Outline Color", { default: [0.08, 0.05, 0.12], tooltip: "Colour of the fake outline (sRGB).", category: "Outline" }),
    P.float("outlineWidth", "Outline Width", { default: 0.16, min: 0, max: 0.5, tooltip: "Width of the silhouette line (0 = none). View-dependent: thicker on round shapes.", category: "Outline" }),
  );
  s.use(toonLight()).use(fresnelKit());

  const inp = s.block("inputs", "Light & view inputs", "Everything the shading needs: a **light direction** (a material parameter — swap in the engine's Main Light node if you prefer scene lighting), the world normal and the view direction. Shared by the next blocks through portals.", { col: 0, color: COLORS.blue });
  inp.n("ldir0", "property", { params: { property: "lightDir" } });
  inp.n("ldir", "normalize", {});
  inp.n("nrm", "normal", { params: { space: "world" } });
  inp.n("vdir", "viewDirection", { params: { space: "world" } });

  const cel = s.block("cel", "Cel shading", "The **Toon Light** kit: `N·L` → half-Lambert → 3 quantised bands, mixed between *Shadow* and *Lit*. ", { col: 1, row: 0, color: COLORS.orange });
  cel.sub("toon", "ks_toon_light", { label: "Toon Light" });
  s.w("ldir0.out", "ldir.in").w("nrm.out", "toon.normal", "N").w("ldir.out", "toon.lightDir", "L").w(cel.po("softness"), "toon.softness").w(cel.po("shadow"), "toon.shadow").w(cel.po("lit"), "toon.lit")
    ;

  const spec = s.block("spec", "Hard specular", "Blinn half-vector `H = normalize(L + V)`; the highlight is `step(1 − size, N·H)` (hard, cel-style) and only shows on the lit side (× toon level).", { col: 1, row: 1, color: COLORS.yellow });
  spec.n("sum", "add", {});
  spec.n("half", "normalize", {});
  spec.n("nh", "dot", {});
  spec.n("inv", "subtract", { values: { a: 1 } });
  spec.n("hl", "step", {});
  spec.n("lit", "multiply", {});
  spec.n("col", "multiply", {});
  s.w("ldir.out", "sum.a", "L").w("vdir.out", "sum.b", "V").w("sum.out", "half.in").w("nrm.out", "nh.a", "N").w("half.out", "nh.b")
    .w(spec.po("specSize"), "inv.b").w("inv.out", "hl.edge").w("nh.out", "hl.in")
    .w("hl.out", "lit.a").w("toon.level", "lit.b", "Level").w("lit.out", "col.a").w(spec.po("specColor"), "col.b");

  const rim = s.block("rim", "Rim light", "The **Fresnel kit** gives a thin glow on silhouettes; it is HDR so a Bloom post-effect picks it up.", { col: 2, row: 0, color: COLORS.cyan });
  rim.sub("fres", "ks_fresnel_kit", { label: "Rim" });
  s.w("nrm.out", "fres.normal", "N").w("vdir.out", "fres.viewDir", "V").w(rim.po("rimColor"), "fres.color").w(rim.po("rimPower"), "fres.power").w(rim.po("rimIntensity"), "fres.intensity");

  const ol = s.block("outline", "Fake outline", "No inverted hull needed: `1 − N·V` is ≈ 1 on the silhouette, so `smoothstep(1 − width, …)` paints a line exactly where the surface turns away from the camera.", { col: 2, row: 1, color: COLORS.red });
  ol.n("edge", "fresnel", { params: { mode: "power" }, values: { power: 1 } });
  ol.n("lo", "subtract", { values: { a: 1 } });
  ol.n("hi", "add", { values: { b: 0.03 } });
  ol.n("mask", "smoothstep", {});
  s.w("nrm.out", "edge.normal", "N").w("vdir.out", "edge.viewDir", "V").w(ol.po("outlineWidth"), "lo.b").w("lo.out", "hi.a").w("lo.out", "mask.edge1").w("hi.out", "mask.edge2").w("edge.out", "mask.in");

  const mix = s.block("mix", "Compose", "`final = lerp(cel + specular + rim, outline colour, outline mask)` — the outline always wins, so the silhouette stays crisp.", { col: 3, color: COLORS.green });
  mix.n("a1", "add", {});
  mix.n("a2", "add", {});
  mix.n("fin", "lerp", {});
  s.w("toon.color", "a1.a").w("col.out", "a1.b").w("a1.out", "a2.a").w("fres.glow", "a2.b").w("a2.out", "fin.a").w(mix.po("outlineColor"), "fin.b").w("mask.out", "fin.t");

  const out = s.block("out", "Master output (URP Unlit)", "Unlit master: the shading above is the final colour.", { col: 4, color: COLORS.violet });
  s.master(out);
  s.w("fin.out", "master.baseColor");
  return s;
}
export const toonSample: SampleModule = { meta, build };
