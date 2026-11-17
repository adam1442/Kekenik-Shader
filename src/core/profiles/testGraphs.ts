import { SampleBuilder } from "../samples/builder";
import { makeProperty } from "../properties/model";
import type { Graph, ParamValue } from "../graph/types";

/** Five reusable sample graphs (; reuses them for Godot). Every graph is built with real graph operations. */
export interface ProfileTestGraph {
  id: string;
  name: string;
  /** Profiles the graph is meaningful for. */
  profiles: string[];
  build: (profileId?: string) => Graph;
}

const cat = (
  name: string,
  profileId: string,
  settings: Record<string, ParamValue>,
  properties: ReturnType<typeof makeProperty>[],
  keywords: Graph["keywords"] = [],
): SampleBuilder =>
  new SampleBuilder({ name, profileId, settings, properties, keywords }).n("master", "masterOutput", {}, 8);

const prop = (b: SampleBuilder, id: string, p: string, col: number, row: number): SampleBuilder =>
  b.n(id, "property", { params: { property: p } }, col, row);

/** (1) HDR colour, ranged float, texture with default, Boolean (keyword-flagged), Vector, Int. */
function unlitTextured(profileId = "unity.urp.unlit"): Graph {
  const props = [
    makeProperty("tint", "Tint", "color4", { default: [1, 0.6, 0.2, 1], hdr: true, category: "Surface" }),
    makeProperty("albedo", "Albedo", "texture2D", { textureDefault: "white", category: "Surface" }),
    makeProperty("strength", "Strength", "float", { default: 0.75, min: 0, max: 2, slider: true, category: "Surface" }),
    makeProperty("useTint", "Use Tint", "bool", {
      default: true,
      keyword: { definition: "shader_feature" },
      category: "Options",
    }),
    makeProperty("scroll", "Scroll", "vec2", { default: [0.1, 0], category: "Options" }),
    makeProperty("steps", "Steps", "int", { default: 4, category: "Options" }),
  ];
  const b = cat("Unlit Textured", profileId, {}, props);
  for (const [i, p] of ["tint", "albedo", "strength", "useTint", "scroll", "steps"].entries())
    prop(b, `p_${p}`, p, 0, i);
  return b
    .n("tex", "sampleTexture2D", {}, 1, 1)
    .n("tinted", "multiply", {}, 2, 0)
    .n("scaled", "multiply", {}, 3, 0)
    .n("pick", "lerp", {}, 4, 0)
    .n("time", "time", {}, 1, 4)
    .n("steps2", "multiply", {}, 2, 5)
    .w("p_albedo.out", "tex.tex")
    .w("tex.rgba", "tinted.a")
    .w("p_tint.out", "tinted.b")
    .w("tinted.out", "scaled.a")
    .w("p_strength.out", "scaled.b")
    .w("tex.rgba", "pick.a")
    .w("scaled.out", "pick.b")
    .w("p_useTint.out", "pick.t")
    .w("pick.out", "master.baseColor")
    .w("tex.a", "master.alpha")
    .build();
}

/** (2) Lit PBR: albedo / normal / metallic / smoothness / occlusion / emission. */
function litPbr(profileId = "unity.urp.lit"): Graph {
  const props = [
    makeProperty("albedo", "Albedo", "texture2D", { textureDefault: "white", category: "Surface" }),
    makeProperty("normalMap", "Normal Map", "texture2D", { textureDefault: "bump", category: "Surface" }),
    makeProperty("metal", "Metallic", "float", { default: 0.2, min: 0, max: 1, slider: true, category: "Surface" }),
    makeProperty("smooth", "Smoothness", "float", { default: 0.6, min: 0, max: 1, slider: true, category: "Surface" }),
    makeProperty("occl", "Occlusion", "float", { default: 1, min: 0, max: 1, slider: true, category: "Surface" }),
    makeProperty("glow", "Glow", "color", { default: [0.1, 0.4, 1], hdr: true, category: "Emission" }),
  ];
  const b = cat("Lit PBR", profileId, {}, props);
  for (const [i, p] of ["albedo", "normalMap", "metal", "smooth", "occl", "glow"].entries()) prop(b, `p_${p}`, p, 0, i);
  return b
    .n("tex", "sampleTexture2D", {}, 1, 0)
    .n("nrm", "normalFromTexture", {}, 1, 1)
    .w("p_albedo.out", "tex.tex")
    .w("p_normalMap.out", "nrm.tex")
    .w("tex.rgb", "master.baseColor")
    .w("nrm.out", "master.normalTS")
    .w("p_metal.out", "master.metallic")
    .w("p_smooth.out", "master.smoothness")
    .w("p_occl.out", "master.occlusion")
    .w("p_glow.out", "master.emission")
    .build();
}

/** (3) Alpha clip + vertex displacement + Cull Off + double-sided normals (proves the shared vertex / alpha slice across passes). */
function cutoutDoubleSided(profileId = "unity.urp.unlit"): Graph {
  const props = [
    makeProperty("albedo", "Albedo", "texture2D", { textureDefault: "white", category: "Surface" }),
    makeProperty("cutoff", "Cutoff", "float", { default: 0.4, min: 0, max: 1, slider: true, category: "Surface" }),
    makeProperty("wave", "Wave Height", "float", { default: 0.1, min: 0, max: 1, slider: true, category: "Vertex" }),
  ];
  const settings: Record<string, ParamValue> = {
    alphaClip: true,
    cull: "off",
    ...(profileId.endsWith("lit") && !profileId.includes("unlit") ? { doubleSided: "flip" } : {}),
  };
  const b = cat("Cutout Double Sided", profileId, settings, props);
  for (const [i, p] of ["albedo", "cutoff", "wave"].entries()) prop(b, `p_${p}`, p, 0, i);
  return b
    .n("tex", "sampleTexture2D", {}, 1, 0)
    .n("pos", "position", { params: { space: "object" } }, 0, 4)
    .n("nrm", "normal", { params: { space: "object" } }, 0, 5)
    .n("time", "time", {}, 0, 6)
    .n("amp", "multiply", {}, 2, 5)
    .n("off", "multiply", {}, 3, 5)
    .n("moved", "add", {}, 4, 5)
    .w("p_albedo.out", "tex.tex")
    .w("tex.rgb", "master.baseColor")
    .w("tex.a", "master.alpha")
    .w("p_cutoff.out", "master.alphaClipThreshold")
    .w("time.sine", "amp.a")
    .w("p_wave.out", "amp.b")
    .w("nrm.out", "off.a")
    .w("amp.out", "off.b")
    .w("pos.out", "moved.a")
    .w("off.out", "moved.b")
    .w("moved.out", "master.positionOS")
    .build();
}

/** (4) Sprite Lit: `_MainTex` + normal + mask. */
function spriteLitNormal(profileId = "unity.urp.sprite-lit"): Graph {
  // `_MainTex` / `_NormalMap` / `_MaskTex` are the names SpriteRenderer binds (main sprite + secondary textures).
  const props = [
    makeProperty("main", "Sprite Texture", "texture2D", { textureDefault: "white", referenceName: "_MainTex" }),
    makeProperty("normalMap", "Normal Map", "texture2D", { textureDefault: "bump", referenceName: "_NormalMap" }),
    makeProperty("mask", "Mask", "texture2D", { textureDefault: "white", referenceName: "_MaskTex" }),
  ];
  const b = cat("Sprite Lit Normal", profileId, {}, props);
  for (const [i, p] of ["main", "normalMap", "mask"].entries()) prop(b, `p_${p}`, p, 0, i);
  return b
    .n("tex", "sampleTexture2D", {}, 1, 0)
    .n("nrm", "normalFromTexture", {}, 1, 1)
    .n("msk", "sampleTexture2D", {}, 1, 2)
    .w("p_main.out", "tex.tex")
    .w("p_normalMap.out", "nrm.tex")
    .w("p_mask.out", "msk.tex")
    .w("tex.rgb", "master.baseColor")
    .w("tex.a", "master.alpha")
    .w("nrm.out", "master.normalTS")
    .w("msk.rgba", "master.spriteMask")
    .build();
}

/** (5) Particles: vertex colour + soft particles + additive. */
function particleAdditiveSoft(profileId = "unity.urp.vfx-unlit"): Graph {
  const props = [
    makeProperty("tex", "Particle Texture", "texture2D", { textureDefault: "white" }),
    makeProperty("boost", "Intensity", "float", { default: 2, min: 0, max: 8, slider: true }),
  ];
  const b = cat("Particle Additive Soft", profileId, { blend: "additive", softParticles: true }, props);
  prop(b, "p_tex", "tex", 0, 0);
  prop(b, "p_boost", "boost", 0, 1);
  return b
    .n("tex", "sampleTexture2D", {}, 1, 0)
    .n("vc", "vertexColor", {}, 1, 2)
    .n("c1", "multiply", {}, 2, 0)
    .n("c2", "multiply", {}, 3, 0)
    .n("a1", "multiply", {}, 3, 2)
    .w("p_tex.out", "tex.tex")
    .w("tex.rgb", "c1.a")
    .w("vc.rgb", "c1.b")
    .w("c1.out", "c2.a")
    .w("p_boost.out", "c2.b")
    .w("c2.out", "master.baseColor")
    .w("tex.a", "a1.a")
    .w("vc.a", "a1.b")
    .w("a1.out", "master.alpha")
    .build();
}

export const PROFILE_TEST_GRAPHS: ProfileTestGraph[] = [
  {
    id: "UnlitTextured",
    name: "Unlit Textured",
    profiles: ["unity.urp.unlit", "unity.urp.sprite-unlit", "unity.urp.vfx-unlit"],
    build: unlitTextured,
  },
  { id: "LitPBR", name: "Lit PBR", profiles: ["unity.urp.lit"], build: litPbr },
  {
    id: "CutoutDoubleSided",
    name: "Cutout Double Sided",
    profiles: ["unity.urp.unlit", "unity.urp.lit"],
    build: cutoutDoubleSided,
  },
  { id: "SpriteLitNormal", name: "Sprite Lit Normal", profiles: ["unity.urp.sprite-lit"], build: spriteLitNormal },
  {
    id: "ParticleAdditiveSoft",
    name: "Particle Additive Soft",
    profiles: ["unity.urp.vfx-unlit"],
    build: particleAdditiveSoft,
  },
];
