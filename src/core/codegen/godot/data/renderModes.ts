import type { FactStatus } from "./versions";

/** Render-mode whitelist (docs/EXPORT_TARGETS.md A.1 / A.2). Exclusivity groups: at most ONE mode per group in one `render_mode` statement. */
export interface RenderModeDef {
  id: string;
  group?: string;
  status: FactStatus;
  /** Never emitted by the generator (debug aids). */
  neverEmit?: boolean;
  /** Version gate id (see versions.ts). */
  gate?: string;
}

const V = "verified" as const;
const K = "unverified-by-doc" as const;
const m = (id: string, group?: string, status: FactStatus = V, extra: Partial<RenderModeDef> = {}): RenderModeDef => ({
  id,
  ...(group ? { group } : {}),
  status,
  ...extra,
});

const SPATIAL_RENDER_MODES: readonly RenderModeDef[] = [
  m("blend_mix", "blend"),
  m("blend_add", "blend"),
  m("blend_sub", "blend"),
  m("blend_mul", "blend"),
  m("blend_premul_alpha", "blend"),
  m("depth_draw_opaque", "depth_draw"),
  m("depth_draw_always", "depth_draw"),
  m("depth_draw_never", "depth_draw"),
  m("depth_prepass_alpha"),
  m("depth_test_disabled", "depth_test"),
  m("depth_test_default", "depth_test"),
  m("depth_test_inverted", "depth_test", K, { gate: "depth_test_inverted" }),
  m("cull_back", "cull"),
  m("cull_front", "cull"),
  m("cull_disabled", "cull"),
  m("unshaded"),
  m("wireframe", undefined, V, { neverEmit: true }),
  m("debug_shadow_splits", undefined, V, { neverEmit: true }),
  m("diffuse_burley", "diffuse"),
  m("diffuse_lambert", "diffuse"),
  m("diffuse_lambert_wrap", "diffuse"),
  m("diffuse_toon", "diffuse"),
  m("specular_schlick_ggx", "specular"),
  m("specular_toon", "specular"),
  m("specular_disabled", "specular"),
  m("skip_vertex_transform"),
  m("world_vertex_coords"),
  m("ensure_correct_normals"),
  m("shadows_disabled"),
  m("ambient_light_disabled"),
  m("shadow_to_opacity"),
  m("vertex_lighting"),
  m("particle_trails"),
  m("alpha_to_coverage"),
  m("alpha_to_coverage_and_one"),
  m("fog_disabled"),
  m("sss_mode_skin"),
];
/** alpha_to_coverage and alpha_to_coverage_and_one are alternatives: treated as one group. */
const CANVAS_RENDER_MODES: readonly RenderModeDef[] = [
  m("blend_mix", "blend"),
  m("blend_add", "blend"),
  m("blend_sub", "blend"),
  m("blend_mul", "blend"),
  m("blend_premul_alpha", "blend"),
  m("blend_disabled", "blend"),
  m("unshaded"),
  m("light_only"),
  m("skip_vertex_transform"),
  m("world_vertex_coords"),
];

export type GodotShaderType = "spatial" | "canvas_item";
export const SHADER_TYPES: readonly GodotShaderType[] = ["spatial", "canvas_item"];
export const renderModesOf = (type: string): readonly RenderModeDef[] =>
  type === "spatial" ? SPATIAL_RENDER_MODES : type === "canvas_item" ? CANVAS_RENDER_MODES : [];

export const groupOf = (type: string, mode: string): string | undefined => {
  if (mode === "alpha_to_coverage" || mode === "alpha_to_coverage_and_one") return "alpha_to_coverage";
  return renderModesOf(type).find((r) => r.id === mode)?.group;
};

/** Fixed emission order (deterministic): blend, depth_draw, depth_test, cull, shading … */
const RENDER_MODE_ORDER: readonly string[] = [
  "blend_mix",
  "blend_add",
  "blend_sub",
  "blend_mul",
  "blend_premul_alpha",
  "blend_disabled",
  "depth_draw_opaque",
  "depth_draw_always",
  "depth_draw_never",
  "depth_prepass_alpha",
  "depth_test_default",
  "depth_test_disabled",
  "depth_test_inverted",
  "cull_back",
  "cull_front",
  "cull_disabled",
  "unshaded",
  "light_only",
  "diffuse_burley",
  "diffuse_lambert",
  "diffuse_lambert_wrap",
  "diffuse_toon",
  "specular_schlick_ggx",
  "specular_toon",
  "specular_disabled",
  "vertex_lighting",
  "ambient_light_disabled",
  "fog_disabled",
  "shadows_disabled",
  "alpha_to_coverage",
  "alpha_to_coverage_and_one",
];
export const sortRenderModes = (modes: readonly string[]): string[] =>
  [...new Set(modes)].sort(
    (a, b) =>
      (RENDER_MODE_ORDER.indexOf(a) + 1 || 999) - (RENDER_MODE_ORDER.indexOf(b) + 1 || 999) || a.localeCompare(b),
  );
