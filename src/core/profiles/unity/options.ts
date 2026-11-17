import type { SurfaceOptionDef, TargetVersion } from "../types";
import { UNITY_TARGETS } from "../../codegen/unity/data/targets";
import { BLEND_MODES, CULL_MODES, ZTEST_MODES } from "../../codegen/unity/data/renderState";

/** Option ids are also the keys stored in `graph.settings`. "Expose in Material" companions are `expose_<id>`. */
export const exposeKey = (optionId: string): string => `expose_${optionId}`;

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const BLEND_LABEL: Record<string, string> = {
  opaque: "Opaque",
  alpha: "Alpha",
  premultiply: "Premultiply",
  additive: "Additive",
  multiply: "Multiply",
};
const ZTEST_LABEL: Record<string, string> = {
  lequal: "Less Equal",
  less: "Less",
  greater: "Greater",
  gequal: "Greater Equal",
  equal: "Equal",
  notequal: "Not Equal",
  always: "Always",
};

export const blendOption = (def: string): SurfaceOptionDef => ({
  id: "blend",
  label: "Blend Mode",
  kind: "enum",
  default: def,
  group: "Surface",
  values: BLEND_MODES.map((id) => ({ id, label: BLEND_LABEL[id]! })),
});
export const alphaClipOption: SurfaceOptionDef = {
  id: "alphaClip",
  label: "Alpha Clip",
  kind: "bool",
  default: false,
  group: "Surface",
  tooltip: "Discard fragments whose Alpha is below the Alpha Clip Threshold (identical in every pass).",
};
export const alphaToCoverageOption: SurfaceOptionDef = {
  id: "alphaToCoverage",
  label: "Alpha To Coverage",
  kind: "bool",
  default: false,
  group: "Surface",
  shownWhen: { option: "alphaClip", equals: true },
  tooltip: "ShaderLab AlphaToMask On (needs MSAA).",
};
export const cullOption = (def: string): SurfaceOptionDef => ({
  id: "cull",
  label: "Render Face",
  kind: "enum",
  default: def,
  exposable: true,
  group: "Render State",
  values: CULL_MODES.map((id) => ({ id, label: cap(id === "off" ? "Both (Cull Off)" : id) })),
});
export const zwriteOption: SurfaceOptionDef = {
  id: "zwrite",
  label: "ZWrite",
  kind: "enum",
  default: "auto",
  exposable: true,
  group: "Render State",
  values: [
    { id: "auto", label: "Auto (by blend mode)" },
    { id: "on", label: "On" },
    { id: "off", label: "Off" },
  ],
};
export const ztestOption: SurfaceOptionDef = {
  id: "ztest",
  label: "ZTest",
  kind: "enum",
  default: "lequal",
  exposable: true,
  group: "Render State",
  values: ZTEST_MODES.map((id) => ({ id, label: ZTEST_LABEL[id]! })),
};
export const queueOption: SurfaceOptionDef = {
  id: "queueOffset",
  label: "Priority (Queue offset)",
  kind: "int",
  default: 0,
  min: -50,
  max: 50,
  group: "Render State",
};
export const castShadowsOption: SurfaceOptionDef = {
  id: "castShadows",
  label: "Cast Shadows",
  kind: "bool",
  default: true,
  group: "Lighting",
  tooltip: "Off removes the ShadowCaster pass.",
};
export const fogOption = (def: boolean): SurfaceOptionDef => ({
  id: "fog",
  label: "Fog",
  kind: "bool",
  default: def,
  group: "Lighting",
});
export const receiveShadowsOption: SurfaceOptionDef = {
  id: "receiveShadows",
  label: "Receive Shadows",
  kind: "bool",
  default: true,
  group: "Lighting",
};
export const specularOption: SurfaceOptionDef = {
  id: "specularHighlights",
  label: "Specular Highlights",
  kind: "bool",
  default: true,
  group: "Lighting",
};
export const reflectionsOption: SurfaceOptionDef = {
  id: "environmentReflections",
  label: "Environment Reflections",
  kind: "bool",
  default: true,
  group: "Lighting",
};
export const additionalLightsOption: SurfaceOptionDef = {
  id: "additionalLights",
  label: "Additional Lights",
  kind: "enum",
  default: "auto",
  group: "Lighting",
  tooltip:
    "Cost lever. Auto = compile every URP variant (follows the URP asset). Off = main light only (no variants). Per-Vertex = lit per vertex (cheap). Per-Pixel = full quality. A fixed choice removes variants.",
  values: [
    { id: "auto", label: "Auto (all variants)" },
    { id: "off", label: "Off (main light only)" },
    { id: "vertex", label: "Per-Vertex" },
    { id: "pixel", label: "Per-Pixel" },
  ],
};
export const softShadowsOption: SurfaceOptionDef = {
  id: "softShadows",
  label: "Soft Shadows",
  kind: "bool",
  default: true,
  group: "Lighting",
  shownWhen: { option: "receiveShadows", equals: true },
  tooltip: "Off strips the _SHADOWS_SOFT variants (hard shadow edges, cheaper).",
};
export const shPerVertexOption: SurfaceOptionDef = {
  id: "shPerVertex",
  label: "Ambient SH per Vertex",
  kind: "bool",
  default: false,
  group: "Lighting",
  tooltip:
    "Evaluate the ambient spherical harmonics in the vertex stage (cheaper per pixel; ignores the normal map for ambient).",
};
export const doubleSidedOption: SurfaceOptionDef = {
  id: "doubleSided",
  label: "Double-Sided Normals",
  kind: "enum",
  default: "none",
  group: "Lighting",
  tooltip: "Requires Render Face = Both (Cull Off).",
  values: [
    { id: "none", label: "None" },
    { id: "flip", label: "Flip" },
    { id: "mirror", label: "Mirror" },
  ],
};
export const softParticlesOption: SurfaceOptionDef = {
  id: "softParticles",
  label: "Soft Particles",
  kind: "bool",
  default: false,
  group: "Particles",
  tooltip: "Needs Depth Texture enabled in the URP asset.",
};

/** E3: material-driven surface options (`_SrcBlend/_DstBlend/_ZWrite/_Cull/_AlphaClip/_Cutoff`). Default on for Sprite / VFX profiles. */
export const exposeSurfaceOption = (def: boolean): SurfaceOptionDef => ({
  id: "exposeSurface",
  label: "Expose surface options",
  kind: "bool",
  default: def,
  group: "Render State",
  tooltip:
    "Adds _Surface / _Blend / _SrcBlend / _DstBlend / _ZWrite / _Cull (+ _AlphaClip / _Cutoff when the profile has Alpha Clip) as material properties and uses them in the ShaderLab state (Blend [_SrcBlend] [_DstBlend], ZWrite [_ZWrite], Cull [_Cull]). The Blend Mode option stays the default value. Colour maths (premultiply / multiply fix-ups) remains baked.",
});
/** E1 — Lit-only extras (all default off ⇒ output unchanged). */
export const bakedGIOption: SurfaceOptionDef = {
  id: "bakedGI",
  label: "Baked GI (lightmaps / SH)",
  kind: "bool",
  default: false,
  group: "Global Illumination",
  tooltip:
    "Samples baked lightmaps / light probes / shadow mask (LIGHTMAP_ON, DIRLIGHTMAP_COMBINED, SHADOWS_SHADOWMASK, LIGHTMAP_SHADOW_MIXING variants). Needs UV2 (lightmap UVs) on the mesh. Adds variants.",
};
export const metaPassOption: SurfaceOptionDef = {
  id: "metaPass",
  label: "Meta pass (bake lightmaps)",
  kind: "bool",
  default: false,
  group: "Global Illumination",
  tooltip: "Adds the Meta pass so Unity can bake this shader's albedo / emission into lightmaps and light probes.",
};
export const motionVectorsOption: SurfaceOptionDef = {
  id: "motionVectors",
  label: "Motion Vectors pass",
  kind: "bool",
  default: false,
  group: "Extra Passes",
  tooltip:
    "Adds the URP MotionVectors pass (TAA / motion blur / upscalers). Unity 6 (URP 17) only — ignored with a warning on 2022.3.",
};
export const lodCrossFadeOption: SurfaceOptionDef = {
  id: "lodCrossFade",
  label: "LOD cross-fade",
  kind: "bool",
  default: false,
  group: "Extra Passes",
  tooltip: "Dithered LOD cross-fade (LOD_FADE_CROSSFADE) in every pass.",
};
export const decalsOption: SurfaceOptionDef = {
  id: "decals",
  label: "DBuffer decals",
  kind: "bool",
  default: false,
  group: "Extra Passes",
  tooltip: "Applies URP DBuffer decals (_DBUFFER_MRT1..3) to the surface in ForwardLit.",
};
/** E2 — VFX extras. */
export const flipbookOption: SurfaceOptionDef = {
  id: "flipbook",
  label: "Flipbook frame blending",
  kind: "bool",
  default: false,
  group: "Particles",
  tooltip:
    "Blends the current and the next flipbook frame. Needs the custom vertex streams UV2 (next-frame UV) and AnimBlend — listed in the shader header. The graph is evaluated twice (cost x2).",
};
export const cameraFadeOption: SurfaceOptionDef = {
  id: "cameraFade",
  label: "Camera fade (near / far)",
  kind: "bool",
  default: false,
  group: "Particles",
  tooltip:
    "Fades the particle out close to the camera (_CameraNearFadeDistance .. _CameraFarFadeDistance, material properties).",
};
export const distortionOption: SurfaceOptionDef = {
  id: "distortion",
  label: "Distortion (opaque texture)",
  kind: "bool",
  default: false,
  group: "Particles",
  tooltip:
    "Base Color R,G = distortion vector (0.5 = none), Alpha = strength mask. Outputs the opaque scene colour at the distorted screen UV. Needs Opaque Texture in the URP asset; use Alpha blend.",
};

export const UNITY_VERSIONS: TargetVersion[] = UNITY_TARGETS.map((t) => ({
  id: t.id,
  label: t.label,
  ...(t.default ? { default: true } : {}),
}));

/** Engine-level (profile-independent) graph settings of the Unity target. */
export const UNITY_ENGINE_SETTINGS = [
  "unityVersion",
  "shaderName",
  "shaderTarget",
  "gpuInstancing",
  "precision",
] as const;
