import type { BuiltinEntry, TargetImpl } from "./builtinMap";

/**
 * Godot `light` stage built-ins . These values exist ONLY inside `light` (Godot runs it once per light that
 * affects the fragment), so every entry has `stage: "light"` (IR `LIGHT_BIT`: legal only for the Light-stage master blocks) and is
 * available on `godotSpatial` only. Spellings come from the Godot 4 "Spatial shaders" light() table and are NOT compiled from this
 * sandbox → `verify: true` + manual check `light-stage`.
 */
const X = (reason: string): TargetImpl => ({ availability: "unsupported", expr: "", reason });
const NO_LIGHT =
  "Per-light data exists only in Godot's light() function (Godot 4 spatial shaders, Surface Options ▸ Custom light()).";
const REQ = ["Godot 4 spatial: Surface Options ▸ Custom light() on (the data feeds the Light-stage slots only)"];
const entry = (name: string, ty: BuiltinEntry["ty"], doc: string, expr: string, note?: string): BuiltinEntry => ({
  id: `ks.lightstage.${name}`,
  kind: "engine",
  ty,
  args: [],
  doc,
  stage: "light",
  requires: REQ,
  targets: {
    glslPreview: X(NO_LIGHT),
    wgsl: X(NO_LIGHT),
    hlsl: X(NO_LIGHT),
    unity: X(NO_LIGHT),
    godotCanvas: X(NO_LIGHT),
    godotSpatial: { availability: "supported", expr, verify: true, ...(note ? { note } : {}) },
  },
});

export const LIGHT_STAGE_ENTRIES: BuiltinEntry[] = [
  entry(
    "direction",
    "vec3",
    "Unit direction from the fragment towards the light being shaded (Godot LIGHT, VIEW space).",
    "LIGHT",
    "View space (Godot light() convention); convert with the View Matrix for world space.",
  ),
  entry(
    "color",
    "vec3",
    "Colour of the light being shaded (Godot LIGHT_COLOR = colour × energy × PI).",
    "LIGHT_COLOR",
    "Godot multiplies by PI; divide by PI for the Unity-style 'colour × intensity'.",
  ),
  entry(
    "attenuation",
    "float",
    "Distance + shadow attenuation of the light being shaded (Godot ATTENUATION, 0…1).",
    "ATTENUATION",
  ),
  entry(
    "isDirectional",
    "float",
    "1 when the light being shaded is a DirectionalLight3D (the 'main' light), else 0.",
    "(LIGHT_IS_DIRECTIONAL ? 1.0 : 0.0)",
  ),
  entry("specularAmount", "float", "Specular amount of the light (Godot SPECULAR_AMOUNT).", "SPECULAR_AMOUNT"),
  entry("normal", "vec3", "Surface normal as seen by light() (Godot NORMAL, VIEW space).", "NORMAL", "View space."),
  entry("view", "vec3", "Unit vector from the fragment to the camera (Godot VIEW, VIEW space).", "VIEW", "View space."),
  entry("albedo", "vec3", "Albedo written by fragment() (Godot ALBEDO, read-only in light()).", "ALBEDO"),
  entry("roughness", "float", "Roughness written by fragment() (Godot ROUGHNESS, read-only in light()).", "ROUGHNESS"),
  entry("metallic", "float", "Metallic written by fragment() (Godot METALLIC, read-only in light()).", "METALLIC"),
];
