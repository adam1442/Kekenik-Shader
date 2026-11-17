import { block } from "../canonical";
import type { LockedPropertyDef, SurfaceOptionDef, TargetProfile } from "../types";
import * as o from "./options";

const clip = { option: "alphaClip", equals: true } as const;
const common = {
  engine: "unity-urp" as const,
  targetVersions: o.UNITY_VERSIONS,
  engineSettings: [...o.UNITY_ENGINE_SETTINGS],
};
/** SpriteRenderer binds the sprite to `_MainTex` (brief §6.4): an undeletable "Sprite Texture" property is created with every sprite profile. */
const SPRITE_TEXTURE: LockedPropertyDef = {
  id: "locked_sprite_texture",
  displayName: "Sprite Texture",
  referenceName: "_MainTex",
  type: "texture2D",
  textureDefault: "white",
  tooltip: "Bound by the SpriteRenderer (Unity _MainTex). Locked: it cannot be deleted or renamed in the shader.",
};
const base = (def: string, extra: SurfaceOptionDef[] = []): SurfaceOptionDef[] => [
  o.blendOption(def),
  o.alphaClipOption,
  o.alphaToCoverageOption,
  o.cullOption("back"),
  o.zwriteOption,
  o.ztestOption,
  o.queueOption,
  o.exposeSurfaceOption(false),
  ...extra,
];

const unityUnlit: TargetProfile = {
  ...common,
  id: "unity.urp.unlit",
  label: "Unity URP · Unlit",
  family: "unlit",
  blocks: [block("positionOS"), block("baseColor", true), block("alpha"), block("alphaClipThreshold", false, clip)],
  surfaceOptions: base("opaque", [o.castShadowsOption, o.fogOption(true)]),
};

const unityLit: TargetProfile = {
  ...common,
  id: "unity.urp.lit",
  label: "Unity URP · Lit",
  family: "lit",
  blocks: [
    block("positionOS"),
    block("normalOS"),
    block("tangentOS"),
    block("baseColor", true),
    block("normalTS"),
    block("metallic"),
    block("smoothness"),
    block("occlusion"),
    block("emission"),
    block("translucency"),
    block("thickness"),
    block("alpha"),
    block("alphaClipThreshold", false, clip),
  ],
  surfaceOptions: base("opaque", [
    o.castShadowsOption,
    o.receiveShadowsOption,
    o.softShadowsOption,
    o.specularOption,
    o.reflectionsOption,
    o.additionalLightsOption,
    o.shPerVertexOption,
    o.doubleSidedOption,
    o.fogOption(true),
    o.bakedGIOption,
    o.metaPassOption,
    o.motionVectorsOption,
    o.lodCrossFadeOption,
    o.decalsOption,
  ]),
};

/** Mobile profile: URP Simple Lit (Blinn-Phong via `UniversalFragmentBlinnPhong`). No metallic / occlusion / reflection probes — a fraction of the Lit cost. */
const UNITY_SIMPLE_LIT_ID = "unity.urp.simple-lit";
const unitySimpleLit: TargetProfile = {
  ...common,
  id: UNITY_SIMPLE_LIT_ID,
  label: "Unity URP · Simple Lit (mobile)",
  family: "lit",
  blocks: [
    block("positionOS"),
    block("normalOS"),
    block("tangentOS"),
    block("baseColor", true),
    block("normalTS"),
    block("specular"),
    block("smoothness"),
    block("emission"),
    block("alpha"),
    block("alphaClipThreshold", false, clip),
  ],
  surfaceOptions: base("opaque", [
    o.castShadowsOption,
    o.receiveShadowsOption,
    o.softShadowsOption,
    o.specularOption,
    o.additionalLightsOption,
    o.shPerVertexOption,
    o.doubleSidedOption,
    o.fogOption(true),
  ]),
};

const unitySpriteUnlit: TargetProfile = {
  ...common,
  id: "unity.urp.sprite-unlit",
  label: "Unity URP · Sprite Unlit",
  family: "sprite",
  lockedProperties: [SPRITE_TEXTURE],
  blocks: [block("positionOS"), block("baseColor", true), block("alpha")],
  surfaceOptions: [o.blendOption("alpha"), o.queueOption, o.exposeSurfaceOption(true)],
};

const unitySpriteLit: TargetProfile = {
  ...common,
  id: "unity.urp.sprite-lit",
  label: "Unity URP · Sprite Lit (2D Renderer)",
  family: "sprite",
  lockedProperties: [SPRITE_TEXTURE],
  blocks: [block("positionOS"), block("baseColor", true), block("alpha"), block("normalTS"), block("spriteMask")],
  surfaceOptions: [o.blendOption("alpha"), o.queueOption, o.exposeSurfaceOption(true)],
};

const unityVfxUnlit: TargetProfile = {
  ...common,
  id: "unity.urp.vfx-unlit",
  label: "Unity URP · VFX / Particles Unlit",
  family: "vfx",
  blocks: [block("positionOS"), block("baseColor", true), block("alpha"), block("alphaClipThreshold", false, clip)],
  surfaceOptions: [
    o.blendOption("alpha"),
    o.alphaClipOption,
    o.cullOption("off"),
    o.zwriteOption,
    o.ztestOption,
    o.queueOption,
    o.exposeSurfaceOption(true),
    o.softParticlesOption,
    o.flipbookOption,
    o.cameraFadeOption,
    o.distortionOption,
  ],
};

export const UNITY_PROFILES: readonly TargetProfile[] = [
  unityUnlit,
  unityLit,
  unitySpriteUnlit,
  unitySpriteLit,
  unityVfxUnlit,
  unitySimpleLit,
];
