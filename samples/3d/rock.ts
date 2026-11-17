import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { heightBlend, triplanar } from "../lib";
import { rockTextures } from "../textures/gen";

const meta = {
  id: "pbr-triplanar-rock", title: "PBR Triplanar Rock + Moss",
  description: "World-space triplanar rock (albedo, height, normal) with moss that collects on up-facing surfaces and in crevices through a height-aware blend. No UVs needed — drop it on any mesh.",
  tags: ["pbr", "triplanar", "terrain", "height-blend", "moss", "procedural"], category: "3D / Lit" as const, difficulty: "Advanced" as const,
  targets: ["glsl", "hlsl", "wgsl", "unity", "godot"] as ("glsl" | "hlsl" | "wgsl" | "unity" | "godot")[],
  compatNotes: ["Textures are procedural 128² PNGs embedded in the sample (seeded, tileable)."], requiredFeatures: [],
  budgetClass: "Desktop" as const, godotProfile: "godot.spatial", reusableSubgraphs: ["ks_triplanar", "ks_height_blend"],
  previewConfig: { mode: "3d" as const, mesh: "sphere" as const, lighting: { lit: "lit" as const, azimuth: 40, elevation: 50, intensity: 1.1 } },
};

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.lit" });
  const R = "Rock", M = "Moss";
  s.add(
    P.tex("rockAlbedo", "Rock Albedo", { default: "grey", tooltip: "Rock colour (sRGB). Projected triplanar in world space.", category: R }),
    P.tex("rockHeight", "Rock Height", { default: "grey", tooltip: "Rock height field (R). Drives the moss blend and the cavity occlusion.", category: R }),
    P.tex("rockNormal", "Rock Normal", { default: "bump", tooltip: "Tangent-space normal map of the rock (OpenGL / +Y up).", category: R }),
    P.float("tile", "Tiling", { default: 0.6, min: 0.1, max: 4, tooltip: "Texture repeats per world unit.", category: R }),
    P.float("sharpness", "Blend Sharpness", { default: 4, min: 1, max: 16, tooltip: "Triplanar seam sharpness: 1 = soft, 16 = nearly hard.", category: R }),
    P.float("normalStrength", "Normal Strength", { default: 1, min: 0, max: 2, tooltip: "Strength of the rock normal map.", category: R }),
    P.float("rockSmoothness", "Rock Smoothness", { default: 0.28, min: 0, max: 1, tooltip: "Smoothness of bare rock (0 = rough).", category: R }),
    P.color("mossColor", "Moss Color", { default: [0.2, 0.38, 0.09], tooltip: "Base colour of the moss layer (sRGB).", category: M }),
    P.float("mossAmount", "Moss Amount", { default: 0.55, min: 0, max: 1, tooltip: "0 = bare rock, 1 = almost fully covered.", category: M }),
    P.float("mossScale", "Moss Patch Scale", { default: 1.8, min: 0.2, max: 8, tooltip: "Size of the moss patches (higher = smaller patches).", category: M }),
    P.float("mossDepth", "Height Influence", { default: 0.6, min: 0, max: 0.95, tooltip: "How much rock height steers the moss: higher = moss fills crevices first.", category: M }),
    P.float("mossSoftness", "Edge Softness", { default: 0.12, min: 0.01, max: 0.5, tooltip: "Transition width between rock and moss.", category: M }),
  );
  s.texture("rockAlbedo", "rock-albedo", rock.albedo).texture("rockHeight", "rock-height", rock.height).texture("rockNormal", "rock-normal", rock.normal);
  s.use(triplanar()).use(heightBlend());

  const g = s.block("geo", "Geometry inputs", "World-space position, normal and the tangent frame. These feed every other block through **portals**, so no wire crosses the canvas.", { col: 0, color: COLORS.blue });
  g.n("wpos", "position", { params: { space: "world" } });
  g.n("wnrm", "normal", { params: { space: "world" } });
  g.n("tbn", "tbnMatrix", { params: { space: "world", orthonormalize: true } });

  const t = s.block("tri", "Triplanar rock", "Three projections (YZ, XZ, XY) blended by `|n|^sharpness` — no UVs, no stretching.\nAlbedo and height use the **Triplanar** kit; the normal map uses the Whiteout blend node and is converted from world to tangent space for the Lit master.", { col: 1, color: COLORS.green });
  t.sub("triAlbedo", "ks_triplanar", { label: "Albedo" });
  t.sub("triHeight", "ks_triplanar", { label: "Height" });
  t.n("heightR", "split", {});
  t.n("triNormal", "uvTriplanarNormal", { params: { space: "world" }, label: "Normal (world)" });
  t.n("toTS", "matrixMultiply", { params: { size: 3, rhs: "vector" }, label: "World → Tangent" });
  t.n("nrmN", "normalize", {});
  s.w("wpos.out", "triAlbedo.pos", "WorldPos").w("wnrm.out", "triAlbedo.normal", "WorldNormal")
    .w("wpos.out", "triHeight.pos", "WorldPos").w("wnrm.out", "triHeight.normal", "WorldNormal")
    .w("wpos.out", "triNormal.pos", "WorldPos").w("wnrm.out", "triNormal.normal", "WorldNormal")
    .w(t.po("rockAlbedo"), "triAlbedo.tex").w(t.po("rockHeight"), "triHeight.tex").w(t.po("rockNormal"), "triNormal.tex")
    .w(t.po("tile"), "triAlbedo.tile").w(t.po("tile"), "triHeight.tile").w(t.po("tile"), "triNormal.tile")
    .w(t.po("sharpness"), "triAlbedo.sharpness").w(t.po("sharpness"), "triHeight.sharpness").w(t.po("sharpness"), "triNormal.blend")
    .w(t.po("normalStrength"), "triNormal.strength")
    .w("triHeight.rgb", "heightR.in").w("triNormal.out", "toTS.v").w("tbn.inverse", "toTS.m", "TBN").w("toTS.out", "nrmN.in");

  const m = s.block("mask", "Moss coverage", "Moss wants **up-facing** surfaces: `up = smoothstep(0.1, 0.9, n·Y)`.\nA triplanar-projected noise texture (world space) breaks the mask into patches; *Moss Amount* scales the whole thing.\nThe **Height Blend** kit then lets the rock height push moss into crevices.", { col: 2, color: COLORS.violet });
  m.n("up", "dot", { values: { b: [0, 1, 0] } });
  m.n("upS", "smoothstep", { values: { edge1: 0.1, edge2: 0.9 } });
  m.sub("patch", "ks_triplanar", { label: "Patch noise", values: { sharpness: 2 } });
  m.n("patchR", "split", {});
  m.n("patchTile", "multiply", { values: { b: 0.31 } });
  m.n("cover0", "multiply", {});
  m.n("amt2", "multiply", { values: { b: 2 } });
  m.n("cover1", "add", { values: { b: 0.15 } });
  m.n("cover2", "multiply", {});
  m.n("cover", "saturate", {});
  m.sub("blend", "ks_height_blend", { label: "Height Blend" });
  s.w("wnrm.out", "up.a", "WorldNormal").w("up.out", "upS.in")
    .w("wpos.out", "patch.pos", "WorldPos").w("wnrm.out", "patch.normal", "WorldNormal").w(m.po("rockHeight"), "patch.tex")
    .w(m.po("mossScale"), "patchTile.a").w("patchTile.out", "patch.tile").w("patch.rgb", "patchR.in")
    .w("upS.out", "cover0.a").w("patchR.r", "cover0.b").w(m.po("mossAmount"), "amt2.a").w("cover0.out", "cover1.a").w("amt2.out", "cover2.a").w("cover1.out", "cover2.b")
    .w("cover2.out", "cover.in").w("cover.out", "blend.mask").w("heightR.r", "blend.height", "RockHeight")
    .w(m.po("mossDepth"), "blend.depth").w(m.po("mossSoftness"), "blend.softness");

  const l = s.block("mix", "Layer mix", "The blend weight picks moss over rock for every output: **albedo** (moss tinted by the patch noise), **smoothness** (moss is rougher), **normal** (moss is softer: pulled 60 % towards flat), and cavity **occlusion** from the rock height.", { col: 3, color: COLORS.orange });
  l.n("mossTint", "multiply", {});
  l.n("mossVar", "remap", { values: { inMin: 0, inMax: 1, outMin: 0.7, outMax: 1.25 } });
  l.n("albedo", "lerp", {});
  l.n("smooth", "lerp", { values: { b: 0.08 } });
  l.n("soften", "multiply", { values: { b: 0.6 } });
  l.n("nrm0", "lerp", { values: { b: [0, 0, 1] } });
  l.n("nrm", "normalize", {});
  l.n("ao", "remap", { values: { inMin: 0, inMax: 1, outMin: 0.45, outMax: 1 } });
  s.w(l.po("mossColor"), "mossTint.a").w("patchR.r", "mossVar.in", "PatchNoise").w("mossVar.out", "mossTint.b")
    .w("triAlbedo.rgb", "albedo.a", "RockColor").w("mossTint.out", "albedo.b").w("blend.blend", "albedo.t", "MossBlend")
    .w(l.po("rockSmoothness"), "smooth.a").w("blend.blend", "smooth.t", "MossBlend")
    .w("blend.blend", "soften.a", "MossBlend").w("nrmN.out", "nrm0.a", "NormalTS").w("soften.out", "nrm0.t").w("nrm0.out", "nrm.in")
    .w("heightR.r", "ao.in", "RockHeight");

  const o = s.block("out", "Master output (URP Lit)", "Surface outputs: base colour, tangent-space normal, metallic 0 (rock + moss are dielectrics), smoothness and cavity occlusion.", { col: 4, color: COLORS.cyan });
  s.master(o);
  s.w("albedo.out", "master.baseColor").w("nrm.out", "master.normalTS").w("smooth.out", "master.smoothness").w("ao.out", "master.occlusion");
  return s;
}
const rock = rockTextures(128, 11);
export const rockSample: SampleModule = { meta, build };
