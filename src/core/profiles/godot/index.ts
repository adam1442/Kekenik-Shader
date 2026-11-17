import { block } from "../canonical";
import type { LockedPropertyDef, SurfaceOptionDef, TargetProfile } from "../types";
import * as o from "./options";

const clip = { option: "alphaClip", equals: true } as const;
const common = {
  engine: "godot" as const,
  targetVersions: o.GODOT_VERSIONS,
  engineSettings: [...o.GODOT_ENGINE_SETTINGS],
};

/** CanvasItem: the sprite texture is the built-in `TEXTURE` (not a uniform) — same locked `_MainTex` property as the Unity sprite profiles. */
const GODOT_SPRITE_TEXTURE: LockedPropertyDef = {
  id: "locked_sprite_texture",
  displayName: "Sprite Texture",
  referenceName: "_MainTex",
  type: "texture2D",
  textureDefault: "white",
  tooltip: "Bound by the node's texture (Godot built-in TEXTURE). Locked: it is not exported as a uniform.",
};

const lightOn = { option: "customLight", equals: true } as const;
const LIGHT_BLOCKS = () => [
  block("lightDiffuse", false, lightOn),
  block("lightSpecular", false, lightOn),
  block("lightAlpha", false, lightOn),
];
const spatialOptions = (vfx: boolean): SurfaceOptionDef[] => [
  o.blendOption(vfx ? "alpha" : "opaque"),
  o.alphaClipOption,
  o.alphaToCoverageOption,
  o.cullOption(vfx ? "off" : "back"),
  { ...o.zwriteOption, default: vfx ? "off" : "auto" },
  o.ztestOption,
  o.depthPrepassOption,
  o.stencilModeOption,
  o.stencilCompareOption,
  o.stencilReferenceOption,
  o.stencilDepthFailOption,
  o.castShadowsOption,
  o.receiveShadowsOption,
  o.specularOption,
  o.fogOption(!vfx),
  o.unshadedOption(vfx),
  ...(vfx ? [] : [o.customLightOption]),
  o.diffuseOption,
  o.specularModelOption,
  o.vertexLightingOption,
  o.ambientLightOption,
  o.aoLightAffectOption,
  ...(vfx ? [o.billboardOption, o.softParticlesOption, o.vertexColorOption] : []),
];
/** Spatial: canonical blocks + the Godot-native `specular` / `rim` / `rimTint` (SPECULAR, RIM, RIM_TINT; not in the VFX preset). */
const spatialBlocks = () => [
  block("positionOS"),
  block("normalOS"),
  block("tangentOS"),
  block("baseColor", true),
  block("normalTS"),
  block("metallic"),
  block("smoothness"),
  block("occlusion"),
  block("emission"),
  block("specular"),
  block("rim"),
  block("rimTint"),
  block("translucency"),
  block("thickness"),
  block("alpha"),
  block("alphaClipThreshold", false, clip),
  ...LIGHT_BLOCKS(),
];

const godotSpatial: TargetProfile = {
  ...common,
  id: "godot.spatial",
  label: "Godot 4 · Spatial (3D)",
  family: "lit",
  blocks: spatialBlocks(),
  surfaceOptions: spatialOptions(false),
};

const godotCanvasItem: TargetProfile = {
  ...common,
  id: "godot.canvasitem",
  label: "Godot 4 · CanvasItem (2D)",
  family: "sprite",
  lockedProperties: [GODOT_SPRITE_TEXTURE],
  blocks: [block("positionOS"), block("baseColor", true), block("alpha"), block("normalTS")],
  surfaceOptions: [o.blendOption("alpha", true), o.lit2dOption, o.lightOnlyOption, o.modulateOption],
};

/** Preset of Spatial: unshaded, no fog, depth_draw_never, cull_disabled, blend Alpha; draw-pass material of GPUParticles3D / CPUParticles3D. */
const godotSpatialVfx: TargetProfile = {
  ...common,
  id: "godot.spatial.vfx",
  label: "Godot 4 · VFX / Particles (Spatial preset)",
  family: "vfx",
  blocks: [block("positionOS"), block("baseColor", true), block("alpha"), block("alphaClipThreshold", false, clip)],
  surfaceOptions: spatialOptions(true).filter(
    (d) =>
      ![
        "castShadows",
        "receiveShadows",
        "specularHighlights",
        "diffuse",
        "specularModel",
        "vertexLighting",
        "ambientLight",
        "aoLightAffect",
      ].includes(d.id),
  ),
};

export const GODOT_PROFILES: readonly TargetProfile[] = [godotSpatial, godotCanvasItem, godotSpatialVfx];
export { GODOT_VERSIONS } from "./options";
