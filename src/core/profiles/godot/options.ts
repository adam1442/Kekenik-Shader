import type { SurfaceOptionDef, TargetVersion } from "../types";
import { GODOT_RENDERERS, GODOT_VERSION_IDS, DEFAULT_GODOT_VERSION, gateById } from "../../codegen/godot/data/versions";

/** Godot surface options. Ids shared with Unity (`blend`, `alphaClip`, `cull`, `zwrite`, `ztest`, `softParticles`, `fog`, …) carry over on engine switches. */
const GROUP = {
  surface: "Surface",
  render: "Render State",
  light: "Lighting",
  particles: "Particles",
  sprite: "Sprite",
} as const;
const NO_NODE_PROP =
  "Godot has no such shader setting: it is a property of the node / material (see the export README).";

const spatialBlend = [
  { id: "opaque", label: "Opaque" },
  { id: "alpha", label: "Alpha (blend_mix)" },
  { id: "additive", label: "Additive (blend_add)" },
  { id: "premultiply", label: "Premultiply (blend_premul_alpha)" },
  { id: "multiply", label: "Multiply (blend_mul)" },
  { id: "subtract", label: "Subtract (blend_sub)" },
];
const canvasBlend = [
  { id: "alpha", label: "Mix (blend_mix)" },
  { id: "additive", label: "Add (blend_add)" },
  { id: "subtract", label: "Subtract (blend_sub)" },
  { id: "multiply", label: "Multiply (blend_mul)" },
  { id: "premultiply", label: "Premultiplied alpha (blend_premul_alpha)" },
  { id: "opaque", label: "Disabled (blend_disabled)" },
];

export const blendOption = (def: string, canvas = false): SurfaceOptionDef => ({
  id: "blend",
  label: "Blend Mode",
  kind: "enum",
  default: def,
  group: GROUP.surface,
  values: canvas ? canvasBlend : spatialBlend,
});
export const alphaClipOption: SurfaceOptionDef = {
  id: "alphaClip",
  label: "Alpha Clip",
  kind: "bool",
  default: false,
  group: GROUP.surface,
  tooltip: "Writes ALPHA_SCISSOR_THRESHOLD (+ ALPHA); the object keeps rendering in the opaque pass.",
};
export const alphaToCoverageOption: SurfaceOptionDef = {
  id: "alphaToCoverage",
  label: "Alpha To Coverage",
  kind: "enum",
  default: "off",
  group: GROUP.surface,
  shownWhen: { option: "alphaClip", equals: true },
  tooltip: "alpha_to_coverage needs MSAA.",
  values: [
    { id: "off", label: "Off" },
    { id: "on", label: "alpha_to_coverage" },
    { id: "and_one", label: "alpha_to_coverage_and_one" },
  ],
};
export const cullOption = (def: string): SurfaceOptionDef => ({
  id: "cull",
  label: "Render Face",
  kind: "enum",
  default: def,
  group: GROUP.render,
  tooltip: "Both = cull_disabled (double-sided). Godot flips back-face normals automatically.",
  values: [
    { id: "back", label: "Front (cull_back)" },
    { id: "front", label: "Back (cull_front)" },
    { id: "off", label: "Both (cull_disabled)" },
  ],
});
export const zwriteOption: SurfaceOptionDef = {
  id: "zwrite",
  label: "Depth Draw",
  kind: "enum",
  default: "auto",
  group: GROUP.render,
  values: [
    { id: "auto", label: "Opaque only (depth_draw_opaque)" },
    { id: "on", label: "Always (depth_draw_always)" },
    { id: "off", label: "Never (depth_draw_never)" },
  ],
};
const inverted = gateById("depth_test_inverted");
export const ztestOption: SurfaceOptionDef = {
  id: "ztest",
  label: "Depth Test",
  kind: "enum",
  default: "lequal",
  group: GROUP.render,
  values: [
    { id: "lequal", label: "Default (depth_test_default)" },
    { id: "always", label: "Disabled (depth_test_disabled)" },
    { id: "greater", label: "Greater (depth_test_inverted)", since: inverted?.since ?? "4.5" },
    { id: "gequal", label: "Greater Equal (depth_test_inverted)", since: inverted?.since ?? "4.5" },
    { id: "less", label: "Less", unsupportedReason: "Godot has no such depth test" },
    { id: "equal", label: "Equal", unsupportedReason: "Godot has no such depth test" },
    { id: "notequal", label: "Not Equal", unsupportedReason: "Godot has no such depth test" },
  ],
};
export const depthPrepassOption: SurfaceOptionDef = {
  id: "depthPrepass",
  label: "Depth Prepass (alpha)",
  kind: "bool",
  default: false,
  group: GROUP.render,
  tooltip: "depth_prepass_alpha — only meaningful for transparent blend modes.",
};
export const castShadowsOption: SurfaceOptionDef = {
  id: "castShadows",
  label: "Cast Shadows",
  kind: "bool",
  default: true,
  group: GROUP.light,
  tooltip: `${NO_NODE_PROP} Cast shadows is GeometryInstance3D.cast_shadow.`,
};
export const receiveShadowsOption: SurfaceOptionDef = {
  id: "receiveShadows",
  label: "Receive Shadows",
  kind: "bool",
  default: true,
  group: GROUP.light,
  tooltip: "Off → shadows_disabled (will not receive shadows but can still cast them).",
};
export const specularOption: SurfaceOptionDef = {
  id: "specularHighlights",
  label: "Specular Highlights",
  kind: "bool",
  default: true,
  group: GROUP.light,
  tooltip: "Off → specular_disabled.",
};
export const fogOption = (def: boolean): SurfaceOptionDef => ({
  id: "fog",
  label: "Fog",
  kind: "bool",
  default: def,
  group: GROUP.light,
  tooltip: "Off → fog_disabled.",
});
export const unshadedOption = (def: boolean): SurfaceOptionDef => ({
  id: "unshaded",
  label: "Unshaded",
  kind: "bool",
  default: def,
  group: GROUP.light,
  tooltip:
    "render_mode unshaded: no lighting. Cost: cheapest — no light loop, no shadow / reflection sampling [verify in the Godot profiler].",
});
export const diffuseOption: SurfaceOptionDef = {
  id: "diffuse",
  label: "Diffuse Model",
  kind: "enum",
  default: "burley",
  group: GROUP.light,
  values: [
    { id: "burley", label: "Burley (default)" },
    { id: "lambert", label: "Lambert" },
    { id: "lambert_wrap", label: "Lambert Wrap" },
    { id: "toon", label: "Toon" },
  ],
  tooltip:
    "Cost per light (relative): Burley highest · Lambert Wrap ≈ Lambert < Burley · Toon ≈ Lambert. Lambert is the usual mobile choice (diffuse_lambert) [verify in the Godot profiler].",
};
export const specularModelOption: SurfaceOptionDef = {
  id: "specularModel",
  label: "Specular Model",
  kind: "enum",
  default: "schlick_ggx",
  group: GROUP.light,
  values: [
    { id: "schlick_ggx", label: "Schlick-GGX (default)" },
    { id: "toon", label: "Toon" },
    { id: "disabled", label: "Disabled" },
  ],
  tooltip:
    "Cost per light: Schlick-GGX highest · Toon lower · Disabled (specular_disabled) removes the specular term entirely [verify in the Godot profiler].",
};
export const vertexLightingOption: SurfaceOptionDef = {
  id: "vertexLighting",
  label: "Vertex Lighting",
  kind: "bool",
  default: false,
  group: GROUP.light,
  tooltip:
    "render_mode vertex_lighting: lights are evaluated per vertex instead of per pixel — much cheaper on mobile, visibly coarser on low-poly meshes [verify in the Godot profiler].",
};
export const ambientLightOption: SurfaceOptionDef = {
  id: "ambientLight",
  label: "Ambient Light",
  kind: "bool",
  default: true,
  group: GROUP.light,
  tooltip: "Off → ambient_light_disabled. Cost: skips the ambient / radiance sampling [verify in the Godot profiler].",
};
export const aoLightAffectOption: SurfaceOptionDef = {
  id: "aoLightAffect",
  label: "AO Light Affect",
  kind: "float",
  default: 0,
  min: 0,
  max: 1,
  group: GROUP.light,
  tooltip: "AO_LIGHT_AFFECT (only written when non-zero).",
};
/** 2 (E6): switches on the per-light `light` function and the three Light-stage master blocks. */
export const customLightOption: SurfaceOptionDef = {
  id: "customLight",
  label: "Custom light()",
  kind: "bool",
  default: false,
  group: GROUP.light,
  tooltip:
    "Emits a light() function: the Light-stage blocks (Diffuse Light / Specular Light / Light Alpha) are ADDED to DIFFUSE_LIGHT / SPECULAR_LIGHT once per light (toon shading, ramps). Godot ignores light() with Unshaded or Vertex Lighting. Not shown in the preview. [verify in Godot]",
};
/** 2 (E8): Godot 4.5+ `stencil_mode` (spatial only; default Off ⇒ the file is unchanged). Ids are Godot-only. */
export const stencilModeOption: SurfaceOptionDef = {
  id: "stencilMode",
  label: "Stencil",
  kind: "enum",
  default: "off",
  group: GROUP.render,
  values: [
    { id: "off", label: "Off" },
    { id: "write", label: "Write (mask)" },
    { id: "read", label: "Read (masked)" },
    { id: "readWrite", label: "Read + Write" },
  ],
  tooltip:
    "stencil_mode (Godot 4.5+, experimental). Write marks pixels with the reference value; Read only draws where the comparison passes. Reading works only in the transparent pass (set a transparent Blend Mode). With a Godot target older than 4.5 the statement is not emitted (warning).",
};
export const stencilCompareOption: SurfaceOptionDef = {
  id: "stencilCompare",
  label: "Stencil Compare",
  kind: "enum",
  default: "always",
  group: GROUP.render,
  values: [
    { id: "always", label: "Always" },
    { id: "equal", label: "Equal" },
    { id: "not_equal", label: "Not Equal" },
    { id: "less", label: "Less" },
    { id: "less_or_equal", label: "Less or Equal" },
    { id: "greater", label: "Greater" },
    { id: "greater_or_equal", label: "Greater or Equal" },
  ],
  tooltip:
    "compare_* operator: the reference value is compared with the value in the stencil buffer. Ignored while Stencil is Off.",
};
export const stencilReferenceOption: SurfaceOptionDef = {
  id: "stencilReference",
  label: "Stencil Reference",
  kind: "int",
  default: 1,
  min: 0,
  max: 255,
  group: GROUP.render,
  tooltip: "Reference value written / compared (0–255). Use the same value in the writing and the reading material.",
};
export const stencilDepthFailOption: SurfaceOptionDef = {
  id: "stencilDepthFail",
  label: "Stencil Write On Depth Fail",
  kind: "bool",
  default: false,
  group: GROUP.render,
  tooltip: "Adds write_if_depth_fail (and write): also writes where the depth test fails (X-ray / silhouette passes).",
};
export const billboardOption: SurfaceOptionDef = {
  id: "billboard",
  label: "Billboard",
  kind: "bool",
  default: false,
  group: GROUP.particles,
  tooltip: "Camera-facing quads: overrides MODELVIEW_MATRIX in vertex().",
};
export const softParticlesOption: SurfaceOptionDef = {
  id: "softParticles",
  label: "Soft Particles",
  kind: "bool",
  default: false,
  group: GROUP.particles,
  tooltip:
    "Reads the depth texture (the material renders in the transparent pass — requires a transparent blend mode). Adds soft_near / soft_far parameters.",
};
export const vertexColorOption: SurfaceOptionDef = {
  id: "vertexColorTint",
  label: "Multiply by vertex color",
  kind: "bool",
  default: true,
  group: GROUP.particles,
  tooltip: "Particle COLOR tint (skipped automatically when the graph already reads Vertex Color).",
};
export const lit2dOption: SurfaceOptionDef = {
  id: "lit2d",
  label: "Lit by 2D lights",
  kind: "bool",
  default: true,
  group: GROUP.sprite,
  tooltip: "Off → render_mode unshaded (Sprite Unlit analog).",
};
export const lightOnlyOption: SurfaceOptionDef = {
  id: "lightOnly",
  label: "Light only",
  kind: "bool",
  default: false,
  group: GROUP.sprite,
  tooltip: "render_mode light_only.",
};
export const modulateOption: SurfaceOptionDef = {
  id: "applyModulate",
  label: "Apply modulate / vertex color",
  kind: "bool",
  default: true,
  group: GROUP.sprite,
  tooltip: "Multiplies the result by COLOR as seen in vertex() (vertex color × modulate × self_modulate).",
};

export const GODOT_VERSIONS: TargetVersion[] = GODOT_VERSION_IDS.map((id) => ({
  id,
  label: `Godot ${id}${id === DEFAULT_GODOT_VERSION ? " (baseline)" : ""}`,
  ...(id === DEFAULT_GODOT_VERSION ? { default: true } : {}),
}));
export const GODOT_RENDERER_OPTIONS = GODOT_RENDERERS;
/** Engine-level (profile-independent) graph settings of the Godot target. */
export const GODOT_ENGINE_SETTINGS = ["godotVersion", "godotRenderer"] as const;
