import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { smokeTex } from "../textures/gen-fx";
import { ALL_TARGETS, defineMeta } from "./common";

const meta = defineMeta({
  id: "stylized-clouds", title: "Stylized Clouds",
  description: "Soft toon cloud puff on a sphere: a precomputed tileable noise texture (what Bake To Texture produces) displaces the vertices into lumps and erodes the silhouette, a half-Lambert ramp shades it from a blue-grey underside to a warm top, a backlit rim adds the silver lining, and the alpha fades smoothly at the edge.",
  tags: ["clouds", "stylized", "noise", "vertex-displacement", "silver-lining", "rim", "soft-edge", "bake"], category: "3D / Lit", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["The noise is a texture, not per-pixel fbm: one vertex fetch (lumps) and one fragment fetch (shading + erosion) make the shader Mobile-class. Replace the texture with the output of a Bake To Texture node (or any tileable cloud noise) to change the cloud style.", "Alpha blended, ZWrite off, back faces culled: draw clouds back-to-front (sort by distance). Light direction is a material parameter (identical on every target); the vertex texture fetch needs vertex texture support (every desktop and modern mobile GPU)."],
  requiredFeatures: [], budgetClass: "Mobile", godotProfile: "godot.spatial",
  previewConfig: { mode: "3d", mesh: "sphere", lighting: { lit: "unlit", azimuth: 40, elevation: 45 }, background: { mode: "gradient", ground: "none" } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.unlit", settings: { blend: "alpha", zwrite: "off" } });
  s.add(
    P.tex("noiseMap", "Cloud Noise", { default: "grey", tooltip: "Tileable noise (grey) used for the lumps, the erosion and the shading. Linear data, wrap mode Repeat.", category: "Shape" }),
    P.float("lumps", "Lump Height", { default: 0.28, min: 0, max: 0.6, tooltip: "Vertex displacement along the normal, in object units.", category: "Shape" }),
    P.float("tiling", "Noise Tiling", { default: 2, min: 0.5, max: 6, tooltip: "Noise repeats around the mesh (bigger = smaller billows).", category: "Shape" }),
    P.float("erosion", "Edge Erosion", { default: 0.35, min: 0, max: 1, tooltip: "How much the noise bites into the silhouette (0 = clean round edge).", category: "Soft Edge" }),
    P.float("cutoff", "Edge Cutoff", { default: 0.08, min: 0, max: 0.6, tooltip: "Facing ratio (N·V) below which the cloud is fully transparent.", category: "Soft Edge" }),
    P.float("softness", "Edge Softness", { default: 0.4, min: 0.05, max: 1, tooltip: "Width of the alpha fade at the edge.", category: "Soft Edge" }),
    P.color("topColor", "Lit Color", { default: [1, 0.97, 0.92], tooltip: "Colour of the lit top (sRGB).", category: "Shading" }),
    P.color("bottomColor", "Shadow Color", { default: [0.55, 0.62, 0.78], tooltip: "Colour of the shaded underside (sRGB).", category: "Shading" }),
    P.float("rampSoftness", "Shade Softness", { default: 0.35, min: 0.02, max: 0.7, tooltip: "Width of the transition between shadow and lit colour.", category: "Shading" }),
    P.float("noiseShade", "Noise Shading", { default: 0.25, min: 0, max: 0.6, tooltip: "How much the noise darkens the cloud inside (billow detail).", category: "Shading" }),
    P.vec3("lightDir", "Light Direction", { default: [0.4, 0.8, 0.45], tooltip: "Direction FROM the cloud TOWARDS the sun (world space, normalised in the graph).", category: "Shading" }),
    P.color("liningColor", "Silver Lining", { default: [2.2, 1.9, 1.5], hdr: true, tooltip: "HDR colour of the backlit rim (linear).", category: "Silver Lining" }),
    P.float("liningPower", "Lining Power", { default: 3, min: 1, max: 8, tooltip: "Exponent of the rim: higher = thinner lining.", category: "Silver Lining" }),
    P.float("liningStrength", "Lining Strength", { default: 0.6, min: 0, max: 2, tooltip: "Brightness of the silver lining (0 = off).", category: "Silver Lining" }),
  );
  s.texture("noiseMap", "cloud-noise", smokeTex(128, 41));

  const i = s.block("inputs", "Inputs", "Mesh position / normal / UV for the vertex lumps, world normal and view direction for the shading.", { col: 0, color: COLORS.blue });
  i.n("pos", "position", { params: { space: "object" } });
  i.n("nos", "normal", { params: { space: "object" } });
  i.n("uv", "uv", {});
  i.n("nrm", "normal", { params: { space: "world" } });
  i.n("vd", "viewDirection", { params: { space: "world" } });
  i.n("ld", "normalize", {});
  i.n("tl", "combine", {});
  i.n("uvt", "uvTilingOffset", {});
  s.w(i.po("lightDir"), "ld.in").w(i.po("tiling"), "tl.r").w(i.po("tiling"), "tl.g").w("uv.out", "uvt.uv").w("tl.rg", "uvt.tiling");

  const v = s.block("lumps", "Vertex lumps (baked noise)", "**Displacement Texture** (vertex stage, LOD sample): `position += normal × (noise − ½) × height`. A texture lookup is far cheaper than evaluating fbm per vertex, and the same texture is reused in the fragment stage.", { col: 1, row: 0, color: COLORS.green });
  v.n("disp", "displacementTexture", { params: { channel: "r" }, values: { midpoint: 0.5 } });
  s.w("pos.out", "disp.position").w("nos.out", "disp.normal").w(v.po("noiseMap"), "disp.tex").w("uvt.out", "disp.uv").w(v.po("lumps"), "disp.scale");

  const sh = s.block("shade", "Half-Lambert ramp + noise shading", "`wrap = ½·N·L + ½`; colour = `lerp(shadow, lit, smoothstep(½ − soft/2, ½ + soft/2, wrap))`. The fragment noise sample darkens the inside: `colour × (1 − (1 − noise) × noiseShade)`.", { col: 1, row: 1, color: COLORS.orange });
  sh.n("nl", "dot", {});
  sh.n("hl", "multiply", { values: { b: 0.5 } });
  sh.n("wrap", "add", { values: { b: 0.5 } });
  sh.n("e1", "multiply", { values: { b: -0.5 } });
  sh.n("e1b", "add", { values: { b: 0.5 } });
  sh.n("e2", "multiply", { values: { b: 0.5 } });
  sh.n("e2b", "add", { values: { b: 0.5 } });
  sh.n("ramp", "smoothstep", {});
  sh.n("col", "lerp", {});
  sh.n("ns", "sampleTexture2D", {});
  sh.n("nr", "split", {});
  sh.n("ni", "oneMinus", {});
  sh.n("nk", "multiply", {});
  sh.n("nm", "oneMinus", {});
  sh.n("shaded", "multiply", {});
  s.w("nrm.out", "nl.a").w("ld.out", "nl.b").w("nl.out", "hl.a").w("hl.out", "wrap.a").w(sh.po("rampSoftness"), "e1.a").w("e1.out", "e1b.a").w(sh.po("rampSoftness"), "e2.a").w("e2.out", "e2b.a")
    .w("e1b.out", "ramp.edge1").w("e2b.out", "ramp.edge2").w("wrap.out", "ramp.in").w(sh.po("bottomColor"), "col.a").w(sh.po("topColor"), "col.b").w("ramp.out", "col.t")
    .w(sh.po("noiseMap"), "ns.tex").w("uvt.out", "ns.uv").w("ns.rgb", "nr.in").w("nr.r", "ni.in").w("ni.out", "nk.a").w(sh.po("noiseShade"), "nk.b").w("nk.out", "nm.in").w("col.out", "shaded.a").w("nm.out", "shaded.b");

  const l = s.block("lining", "Silver lining", "`lining = (1 − N·V)^power × saturate(dot(L, −V) + 0.3)`: the rim is bright only where the sun is behind the cloud as seen from the camera. Added in HDR on top of the shaded colour.", { col: 2, row: 0, color: COLORS.yellow });
  l.n("nv", "dot", {});
  l.n("nvs", "saturate", {});
  l.n("inv", "oneMinus", {});
  l.n("rim", "power", {});
  l.n("nvd", "negate", {});
  l.n("bl", "dot", {});
  l.n("bl2", "add", { values: { b: 0.3 } });
  l.n("bls", "saturate", {});
  l.n("lm", "multiply", {});
  l.n("ls", "multiply", {});
  l.n("lc", "multiply", {});
  l.n("sum", "add", {});
  s.w("nrm.out", "nv.a").w("vd.out", "nv.b").w("nv.out", "nvs.in").w("nvs.out", "inv.in").w("inv.out", "rim.a").w(l.po("liningPower"), "rim.b").w("vd.out", "nvd.in").w("ld.out", "bl.a").w("nvd.out", "bl.b").w("bl.out", "bl2.a").w("bl2.out", "bls.in")
    .w("rim.out", "lm.a").w("bls.out", "lm.b").w("lm.out", "ls.a").w(l.po("liningStrength"), "ls.b").w(l.po("liningColor"), "lc.a").w("ls.out", "lc.b").w("shaded.out", "sum.a").w("lc.out", "sum.b");

  const a = s.block("alpha", "Soft eroded edge", "`density = N·V + (noise − ½) × erosion`; `alpha = smoothstep(cutoff, cutoff + softness, density)`. Facing parts stay opaque; the silhouette dissolves along the noise instead of ending in a hard circle.", { col: 2, row: 1, color: COLORS.red });
  a.n("nc", "subtract", { values: { b: 0.5 } });
  a.n("ne", "multiply", {});
  a.n("dn", "add", {});
  a.n("c2", "add", {});
  a.n("al", "smoothstep", {});
  s.w("nr.r", "nc.a").w("nc.out", "ne.a").w(a.po("erosion"), "ne.b").w("nvs.out", "dn.a", "NdotV").w("ne.out", "dn.b").w(a.po("cutoff"), "c2.a").w(a.po("softness"), "c2.b").w(a.po("cutoff"), "al.edge1").w("c2.out", "al.edge2").w("dn.out", "al.in");

  const o = s.block("out", "Master output (URP Unlit, alpha)", "Alpha blend, ZWrite off; vertex position from the lump displacement.", { col: 3, color: COLORS.violet });
  s.master(o);
  s.w("sum.out", "master.baseColor").w("al.out", "master.alpha").w("disp.position", "master.positionOS");
  return s;
}
export const cloudsSample: SampleModule = { meta, build };
