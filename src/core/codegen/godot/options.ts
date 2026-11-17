import type { ParamValue } from "../../graph/types";
import { optionValue } from "../../profiles/canonical";
import type { ProfileProblem, TargetProfile } from "../../profiles/types";
import { type GodotShaderType, groupOf, sortRenderModes } from "./data/renderModes";
import { stencilStatement } from "./data/stencil";
import { type GodotTarget, featureAvailable, gateById, normalizeRenderer, normalizeVersion } from "./data/versions";

/** Resolved Godot surface options (pure function of the profile + `graph.settings`). Templates read this, never the raw settings. */
export interface GodotOptions {
  profile: TargetProfile;
  shaderType: GodotShaderType;
  target: GodotTarget;
  vfx: boolean;
  blend: string;
  alphaClip: boolean;
  /** Written ALPHA: transparent blend or alpha clip (Godot: writing ALPHA makes the material transparent). */
  writesAlpha: boolean;
  transparent: boolean;
  modes: string[];
  billboard: boolean;
  softParticles: boolean;
  vertexColorTint: boolean;
  applyModulate: boolean;
  aoLightAffect: number;
  castShadows: boolean;
  /** `light()` is emitted (spatial + option `customLight`). */
  customLight: boolean;
  /** `stencil_mode` statement body (spatial, Godot ≥ 4.5, option on) — `undefined` = no statement. */
  stencil: string | undefined;
  problems: ProfileProblem[];
}

const BLEND_MODE: Record<string, string> = {
  alpha: "blend_mix",
  additive: "blend_add",
  premultiply: "blend_premul_alpha",
  multiply: "blend_mul",
  subtract: "blend_sub",
};
const str = (v: ParamValue, fallback: string): string => (typeof v === "string" ? v : fallback);
const problem = (rule: string, message: string, manual?: string): ProfileProblem => ({
  rule,
  severity: "warning",
  message,
  ...(manual ? { manual } : {}),
});

/** Spatial / CanvasItem options → `render_mode` list (deterministic order, ≤ 1 mode per exclusivity group). */
export function resolveGodotOptions(tp: TargetProfile, settings: Readonly<Record<string, ParamValue>>): GodotOptions {
  const defs = tp.surfaceOptions;
  const has = (id: string): boolean => defs.some((d) => d.id === id);
  const val = (id: string): ParamValue => optionValue(defs, settings, id);
  const on = (id: string): boolean => has(id) && val(id) === true;
  const canvas = tp.id === "godot.canvasitem";
  const shaderType: GodotShaderType = canvas ? "canvas_item" : "spatial";
  const target: GodotTarget = {
    version: normalizeVersion(settings.godotVersion),
    renderer: normalizeRenderer(settings.godotRenderer),
  };
  const problems: ProfileProblem[] = [];
  const modes: string[] = [];
  const blend = str(val("blend"), canvas || tp.family === "vfx" ? "alpha" : "opaque");
  const alphaClip = !canvas && on("alphaClip");

  if (canvas) {
    if (blend === "opaque") modes.push("blend_disabled");
    else if (blend !== "alpha") modes.push(BLEND_MODE[blend] ?? "blend_mix");
    if (has("lit2d") && !on("lit2d")) modes.push("unshaded");
    if (on("lightOnly")) modes.push("light_only");
  } else {
    if (blend !== "opaque") modes.push(BLEND_MODE[blend] ?? "blend_mix");
    const zw = str(val("zwrite"), "auto");
    if (zw === "on") modes.push("depth_draw_always");
    else if (zw === "off") modes.push("depth_draw_never");
    if (on("depthPrepass") && blend !== "opaque") modes.push("depth_prepass_alpha");
    const zt = str(val("ztest"), "lequal");
    if (zt === "always") modes.push("depth_test_disabled");
    else if (zt === "greater" || zt === "gequal") {
      if (featureAvailable("depth_test_inverted", target.version)) modes.push("depth_test_inverted");
      else
        problems.push(
          problem(
            "profile.option-unsupported",
            `Depth Test "${zt}" needs depth_test_inverted (Godot ≥ ${gateById("depth_test_inverted")?.since}); the selected version is ${target.version}`,
            "depth-test-inverted",
          ),
        );
    } else if (zt !== "lequal")
      problems.push(problem("profile.option-unsupported", `Depth Test "${zt}": Godot has no such depth test`));
    const cull = str(val("cull"), "back");
    if (cull === "front") modes.push("cull_front");
    else if (cull === "off") modes.push("cull_disabled");
    if (on("unshaded")) modes.push("unshaded");
    const diffuse = str(val("diffuse"), "burley");
    if (diffuse !== "burley") modes.push(`diffuse_${diffuse}`);
    const spec = str(val("specularModel"), "schlick_ggx");
    if (has("specularHighlights") && !on("specularHighlights")) modes.push("specular_disabled");
    else if (spec !== "schlick_ggx") modes.push(`specular_${spec}`);
    if (on("vertexLighting")) modes.push("vertex_lighting");
    if (has("ambientLight") && !on("ambientLight")) modes.push("ambient_light_disabled");
    if (has("fog") && !on("fog")) modes.push("fog_disabled");
    if (has("receiveShadows") && !on("receiveShadows")) modes.push("shadows_disabled");
    const a2c = str(val("alphaToCoverage"), "off");
    if (alphaClip && a2c === "on") modes.push("alpha_to_coverage");
    else if (alphaClip && a2c === "and_one") modes.push("alpha_to_coverage_and_one");
  }
  // At most one mode per exclusivity group (first wins) — the table above never produces two, this is the safety net.
  const seen = new Set<string>();
  const unique = sortRenderModes(modes).filter((m) => {
    const g = groupOf(shaderType, m);
    if (!g) return true;
    if (seen.has(g)) return false;
    seen.add(g);
    return true;
  });
  const castShadows = !has("castShadows") || on("castShadows");
  if (has("castShadows") && !castShadows)
    problems.push(
      problem(
        "profile.option-unsupported",
        "Cast Shadows is a property of the node (GeometryInstance3D.cast_shadow), not of the shader — the value is kept but has no effect in the exported file",
      ),
    );
  let stencil: string | undefined;
  if (!canvas && has("stencilMode")) {
    const mode = str(val("stencilMode"), "off");
    stencil = stencilStatement(
      mode,
      str(val("stencilCompare"), "always"),
      Number(val("stencilReference") ?? 1),
      on("stencilDepthFail"),
    );
    if (stencil && !featureAvailable("stencil_mode", target.version)) {
      problems.push(
        problem(
          "profile.option-unsupported",
          `Stencil needs stencil_mode (Godot ≥ ${gateById("stencil_mode")?.since}); the selected version is ${target.version} — no stencil_mode statement is emitted`,
          "stencil-mode",
        ),
      );
      stencil = undefined;
    } else if (stencil) {
      if (/\bread\b/.test(stencil) && blend === "opaque")
        problems.push(
          problem(
            "godot.stencil-read-opaque",
            "Stencil Read works only in the transparent pass (Godot does not support reading the stencil buffer in the opaque pass) — set a transparent Blend Mode",
            "stencil-mode",
          ),
        );
      problems.push({
        rule: "godot.unverified-api",
        severity: "info",
        message:
          "stencil_mode is experimental in Godot 4.5+ (spelling taken from the official reference, not compiled here) — see the manual checklist",
        manual: "stencil-mode",
      });
    }
  }
  const transparent = canvas ? blend !== "opaque" : blend !== "opaque";
  return {
    profile: tp,
    shaderType,
    target,
    vfx: tp.family === "vfx",
    blend,
    alphaClip,
    writesAlpha: !canvas && (blend !== "opaque" || alphaClip),
    transparent,
    modes: unique,
    billboard: on("billboard"),
    softParticles: on("softParticles"),
    vertexColorTint: !has("vertexColorTint") || on("vertexColorTint"),
    applyModulate: !has("applyModulate") || on("applyModulate"),
    aoLightAffect: Number(val("aoLightAffect") ?? 0) || 0,
    castShadows,
    customLight: !canvas && on("customLight"),
    stencil,
    problems,
  };
}

/** Inverse of the table (tests, "both directions"): the option values a `render_mode` list implies for a shader type. */
export function optionsFromRenderModes(
  type: GodotShaderType,
  modes: readonly string[],
): Record<string, string | boolean> {
  const has = (m: string): boolean => modes.includes(m);
  if (type === "canvas_item") {
    const blend = has("blend_disabled")
      ? "opaque"
      : has("blend_add")
        ? "additive"
        : has("blend_sub")
          ? "subtract"
          : has("blend_mul")
            ? "multiply"
            : has("blend_premul_alpha")
              ? "premultiply"
              : "alpha";
    return { blend, lit2d: !has("unshaded"), lightOnly: has("light_only") };
  }
  const blend = has("blend_mix")
    ? "alpha"
    : has("blend_add")
      ? "additive"
      : has("blend_sub")
        ? "subtract"
        : has("blend_mul")
          ? "multiply"
          : has("blend_premul_alpha")
            ? "premultiply"
            : "opaque";
  return {
    blend,
    zwrite: has("depth_draw_always") ? "on" : has("depth_draw_never") ? "off" : "auto",
    ztest: has("depth_test_disabled") ? "always" : has("depth_test_inverted") ? "greater" : "lequal",
    cull: has("cull_disabled") ? "off" : has("cull_front") ? "front" : "back",
    unshaded: has("unshaded"),
    receiveShadows: !has("shadows_disabled"),
    fog: !has("fog_disabled"),
    specularHighlights: !has("specular_disabled"),
    diffuse: ["lambert_wrap", "lambert", "toon"].find((d) => has(`diffuse_${d}`)) ?? "burley",
  };
}
