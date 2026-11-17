/** Uniform hints per type (docs/EXPORT_TARGETS.md A.4, [V]). Defaults go AFTER the hints: `uniform T n : hints = default;`. */
export interface HintDef {
  name: string;
  /** Types the hint is legal on (`sampler` = every sampler type). */
  types: readonly string[];
  /** Takes an argument list `hint(a, b)`. */
  args?: boolean;
}
const SAMPLER = ["sampler2D", "sampler2DArray", "sampler3D", "samplerCube"] as const;
const h = (name: string, types: readonly string[], args = false): HintDef => ({
  name,
  types,
  ...(args ? { args } : {}),
});

const HINTS: readonly HintDef[] = [
  h("source_color", ["vec3", "vec4", ...SAMPLER]),
  h("hint_enum", ["int"], true),
  h("hint_range", ["int", "float"], true),
  h("hint_normal", ["sampler2D"]),
  h("hint_default_white", ["sampler2D"]),
  h("hint_default_black", ["sampler2D"]),
  h("hint_default_transparent", ["sampler2D"]),
  h("hint_anisotropy", ["sampler2D"]),
  h("hint_roughness_r", ["sampler2D"]),
  h("hint_roughness_g", ["sampler2D"]),
  h("hint_roughness_b", ["sampler2D"]),
  h("hint_roughness_a", ["sampler2D"]),
  h("hint_roughness_normal", ["sampler2D"]),
  h("hint_roughness_gray", ["sampler2D"]),
  h("hint_screen_texture", ["sampler2D"]),
  h("hint_depth_texture", ["sampler2D"]),
  h("hint_normal_roughness_texture", ["sampler2D"]),
  h("filter_nearest", SAMPLER),
  h("filter_linear", SAMPLER),
  h("filter_nearest_mipmap", SAMPLER),
  h("filter_linear_mipmap", SAMPLER),
  h("filter_nearest_mipmap_anisotropic", SAMPLER),
  h("filter_linear_mipmap_anisotropic", SAMPLER),
  h("repeat_enable", SAMPLER),
  h("repeat_disable", SAMPLER),
  h("instance_index", ["float", "int", "bool", "vec2", "vec3", "vec4"], true),
];
export const hintByName = (n: string): HintDef | undefined => HINTS.find((x) => x.name === n);
export const HINT_NAMES: readonly string[] = HINTS.map((x) => x.name);

/** Only these uniform storage types may be `instance uniform` (never textures / arrays). */
export const INSTANCE_UNIFORM_TYPES: readonly string[] = [
  "float",
  "int",
  "bool",
  "vec2",
  "vec3",
  "vec4",
  "uint",
  "ivec2",
  "ivec3",
  "ivec4",
  "uvec2",
  "uvec3",
  "uvec4",
  "bvec2",
  "bvec3",
  "bvec4",
];
export const MAX_INSTANCE_UNIFORMS = 16;
