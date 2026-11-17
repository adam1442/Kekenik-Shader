import { COLORS } from "../build/canvas";
import { P, Sample } from "../build/dsl";
import type { SampleModule } from "../build/emit";
import { brickTextures } from "../textures/gen-surface";
import { ALL_TARGETS, defineMeta } from "./common";

const meta = defineMeta({
  id: "parallax-brick", title: "Parallax Brick Wall",
  description: "Brick wall with steep parallax occlusion mapping: the height map is ray-marched along the tangent-space view vector so mortar joints sink behind the bricks with real depth. Normal map, mortar-aware smoothness and height-based occlusion complete the PBR set.",
  tags: ["parallax", "brick", "height-map", "normal-map", "pbr", "tangent-space", "lit"], category: "3D / Lit", difficulty: "Intermediate", targets: ALL_TARGETS,
  compatNotes: ["Needs mesh tangents (all preview primitives, Unity and Godot meshes provide them).", "Parallax ray-marches 12 steps per pixel — Desktop class. Lower the Depth value on grazing angles to avoid swimming."],
  requiredFeatures: [], budgetClass: "Desktop", godotProfile: "godot.spatial", reusableSubgraphs: [],
  previewConfig: { mode: "3d", mesh: "cube", lighting: { lit: "lit", azimuth: 60, elevation: 35, intensity: 1.3 } },
});

function build(): Sample {
  const s = new Sample({ id: meta.id, name: meta.title, profile: "unity.urp.lit" });
  const t = brickTextures(128, 7);
  s.add(
    P.tex("albedoMap", "Albedo Map", { default: "white", tooltip: "Brick colour (sRGB).", category: "Maps" }),
    P.tex("heightMap", "Height Map", { default: "grey", tooltip: "Height in R (1 = brick face, 0 = mortar bottom). Import as linear data.", category: "Maps" }),
    P.tex("normalMap", "Normal Map", { default: "bump", tooltip: "Tangent-space normal map. Import as normal map / linear data.", category: "Maps" }),
    P.color("tint", "Tint", { default: [1, 1, 1], tooltip: "Multiplies the albedo.", category: "Surface" }),
    P.float("tiling", "Tiling", { default: 3, min: 1, max: 12, step: 1, tooltip: "Number of brick-texture repeats across the UV range.", category: "Surface" }),
    P.float("smoothness", "Smoothness", { default: 0.3, min: 0, max: 1, tooltip: "Smoothness of the brick faces (mortar is rougher).", category: "Surface" }),
    P.float("normalStrength", "Normal Strength", { default: 1, min: 0, max: 3, tooltip: "Strength of the normal map.", category: "Surface" }),
    P.float("depth", "Parallax Depth", { default: 0.055, min: 0, max: 0.12, tooltip: "Apparent depth of the mortar joints (UV units).", category: "Parallax" }),
    P.float("aoStrength", "Occlusion", { default: 0.8, min: 0, max: 1, tooltip: "How strongly low (mortar) areas are darkened.", category: "Parallax" }),
  );
  s.texture("albedoMap", "brick-albedo", t.albedo).texture("heightMap", "brick-height", t.height).texture("normalMap", "brick-normal", t.normal);

  const g = s.block("uv", "UV + tangent-space view", "Tiled UV and the view vector in **tangent space** — the parallax node marches along its XY component.", { col: 0, color: COLORS.blue });
  g.n("uv", "uv", {});
  g.n("tile", "uvTilingOffset", {});
  g.n("pack", "combine", {});
  g.n("vt", "viewDirection", { params: { space: "tangent" } });
  s.w(g.po("tiling"), "pack.r").w(g.po("tiling"), "pack.g").w("uv.out", "tile.uv").w("pack.rg", "tile.tiling");

  const p = s.block("pom", "Steep parallax", "**Parallax (steep)**: 12 layers; at each layer the height is compared to the layer depth, then the intersection is interpolated. The result is the UV where the eye ray actually hits the brick surface — every texture below is read there.", { col: 1, color: COLORS.green });
  p.n("pom", "uvParallax", { params: { mode: "steep", steps: 12, channel: "r" } });
  s.w(p.po("heightMap"), "pom.height").w("tile.out", "pom.uv", "TiledUV").w(p.po("depth"), "pom.amplitude").w("vt.out", "pom.view", "ViewTS");

  const m = s.block("maps", "Texture fetch", "Albedo, height and normal map are sampled at the **parallax UV**. The normal map is unpacked and scaled with *Normal Strength*.", { col: 2, color: COLORS.yellow });
  m.n("alb", "sampleTexture2D", {});
  m.n("hgt", "sampleTexture2D", {});
  m.n("nrm", "sampleTexture2D", {});
  m.n("unpack", "normalUnpack", {});
  m.n("str", "normalStrength", {});
  m.n("col", "multiply", {});
  s.w(m.po("albedoMap"), "alb.tex").w("pom.out", "alb.uv", "ParallaxUV").w(m.po("heightMap"), "hgt.tex").w("pom.out", "hgt.uv").w(m.po("normalMap"), "nrm.tex").w("pom.out", "nrm.uv")
    .w("nrm.rgba", "unpack.in").w("unpack.out", "str.in").w(m.po("normalStrength"), "str.strength").w("alb.rgb", "col.a").w(m.po("tint"), "col.b");

  const r = s.block("rough", "Mortar-aware surface", "Height drives two cheap tricks: occlusion `lerp(1, h, strength)` darkens the joints, and smoothness is multiplied by `0.4 + 0.6·smoothstep(0.1, 0.4, h)` so mortar is rougher than brick.", { col: 3, color: COLORS.orange });
  r.n("h", "split", {});
  r.n("face", "smoothstep", { values: { edge1: 0.1, edge2: 0.4 } });
  r.n("hs", "saturate", {});
  r.n("ao", "lerp", { values: { a: 1 } });
  r.n("rf", "remap", { values: { inMin: 0, inMax: 1, outMin: 0.4, outMax: 1 } });
  r.n("sm", "multiply", {});
  s.w("hgt.rgb", "h.in").w("h.r", "hs.in").w("hs.out", "ao.b").w(r.po("aoStrength"), "ao.t").w("h.r", "face.in").w("face.out", "rf.in").w(r.po("smoothness"), "sm.a").w("rf.out", "sm.b");

  const o = s.block("out", "Master output (URP Lit)", "PBR set: albedo, tangent-space normal, smoothness, occlusion.", { col: 4, color: COLORS.violet });
  s.master(o);
  s.w("col.out", "master.baseColor").w("str.out", "master.normalTS").w("sm.out", "master.smoothness").w("ao.out", "master.occlusion");
  return s;
}
export const parallaxBrickSample: SampleModule = { meta, build };
