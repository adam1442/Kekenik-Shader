import { formatFloat } from "../base/literals";
import type { Generated } from "../dialect/generate";
import type { GodotOptions } from "./options";
import { type GodotPackState, attrTable } from "./pack";

/** `vertex()` and `fragment()` bodies (brief §2 / §4 / Appendix B). Pure text assembly over the shared generator's output. */
const lines = (w: { toString(): string }): string[] =>
  w
    .toString()
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l !== "");
/** Operand form of a bare slot expression (`a ? b : c` must be parenthesised before `* 0.5 + 0.5`). */
const atom = (e: string): string => (/^[\w.]+$/.test(e) || /^\w+\([^()]*\)$/.test(e) ? e : `(${e})`);
/** Constants equal to the Godot built-in default are not written (identical result, shorter output). */
const GODOT_DEFAULT: Record<string, string> = {
  normalTS: "vec3(0.0, 0.0, 1.0)",
  metallic: "0.0",
  specular: "0.5",
  rim: "0.0",
  rimTint: "0.5",
  thickness: "0.0",
  translucency: "vec3(0.0)",
  occlusion: "1.0",
  emission: "vec3(0.0)",
};
const isDefault = (slot: string, e: string | undefined): boolean => e !== undefined && GODOT_DEFAULT[slot] === e;
const ind = (ls: readonly string[]): string[] => ls.map((l) => (l.startsWith("#") ? l : `    ${l}`));
const fn = (name: string, body: readonly string[]): string[] =>
  body.length ? [`void ${name}() {`, ...ind(body), "}"] : [];

const BILLBOARD =
  "MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);";

export function vertexFunction(g: Generated, o: GodotOptions, st: GodotPackState): string[] {
  const canvas = o.shaderType === "canvas_item";
  const L: string[] = [];
  if (o.billboard && !canvas) L.push(BILLBOARD);
  if (canvas && o.applyModulate) L.push("kek_modulate = COLOR;");
  // Derived-input globals become locals (Godot has no mutable globals; stage-bound subgraph functions are rejected by the backend).
  const globals = [...g.vertex.st.globals.values()];
  for (const l of lines(g.vertex.core)) {
    const gl = globals.find((x) => l.startsWith(`${x.name} = `));
    L.push(gl ? `${gl.ty} ${l}` : l);
  }
  for (const v of g.vertex.varyings) L.push(`${v.name} = ${v.expr};`);
  const base = attrTable(canvas).a_position ?? "VERTEX";
  if (g.vertex.pos !== base && g.vertex.pos !== "VERTEX")
    L.push(canvas ? `VERTEX = ${g.vertex.pos}.xy;` : `VERTEX = ${g.vertex.pos};`);
  const s = g.vertex.slotExprs;
  if (!canvas && s.normalOS) L.push(`NORMAL = ${s.normalOS};`);
  if (!canvas && s.tangentOS) L.push(`TANGENT = ${s.tangentOS};`);
  void st;
  return fn("vertex", L);
}

const SOFT = (): string[] => [
  "float kek_depth_raw = texture(kek_depth_texture, SCREEN_UV).x;",
  "#if CURRENT_RENDERER == RENDERER_COMPATIBILITY",
  "vec3 kek_ndc = vec3(SCREEN_UV, kek_depth_raw) * 2.0 - 1.0;",
  "#else",
  "vec3 kek_ndc = vec3(SCREEN_UV * 2.0 - 1.0, kek_depth_raw);",
  "#endif",
  "vec4 kek_view = INV_PROJECTION_MATRIX * vec4(kek_ndc, 1.0);",
  "kek_view.xyz /= kek_view.w;",
  "float kek_scene_depth = -kek_view.z;",
  "float kek_frag_depth = -VERTEX.z;",
  "kek_alpha *= clamp((kek_scene_depth - kek_frag_depth - soft_near) / max(soft_far - soft_near, 0.0001), 0.0, 1.0);",
];

export function fragmentFunction(g: Generated, o: GodotOptions): string[] {
  const s: Record<string, string | undefined> = { ...g.fragment.slotExprs };
  for (const k of Object.keys(GODOT_DEFAULT)) if (isDefault(k, s[k])) delete s[k];
  const L = lines(g.fragment.body);
  if (o.shaderType === "canvas_item") {
    L.push(`vec4 kek_color = vec4(${s.baseColor ?? "vec3(1.0)"}, ${s.alpha ?? "1.0"});`);
    L.push(o.applyModulate ? "COLOR = kek_color * kek_modulate;" : "COLOR = kek_color;");
    if (s.normalTS) L.push(`NORMAL_MAP = ${atom(s.normalTS)} * 0.5 + 0.5;`, "NORMAL_MAP_DEPTH = 1.0;");
    return fn("fragment", L);
  }
  const ownsVertexColor = g.fragment.st.varyings.has("vertexColor");
  const tint = o.vfx && o.vertexColorTint && !ownsVertexColor;
  L.push(
    `ALBEDO = ${tint ? atom(s.baseColor ?? "vec3(1.0)") : (s.baseColor ?? "vec3(1.0)")}${tint ? " * COLOR.rgb" : ""};`,
  );
  const alphaBase = s.alpha ?? (o.vfx || o.writesAlpha ? "1.0" : undefined);
  const alphaExpr = alphaBase === undefined ? undefined : tint ? `${atom(alphaBase)} * COLOR.a` : alphaBase;
  if (o.softParticles && o.vfx) {
    L.push(`float kek_alpha = ${alphaExpr ?? "1.0"};`, ...SOFT(), "ALPHA = kek_alpha;");
  } else if (alphaExpr !== undefined && (o.writesAlpha || o.vfx)) L.push(`ALPHA = ${alphaExpr};`);
  if (o.alphaClip) L.push(`ALPHA_SCISSOR_THRESHOLD = ${s.alphaClipThreshold ?? "0.5"};`);
  if (s.normalTS) L.push(`NORMAL_MAP = ${atom(s.normalTS)} * 0.5 + 0.5;`, "NORMAL_MAP_DEPTH = 1.0;");
  if (s.metallic) L.push(`METALLIC = ${s.metallic};`);
  if (o.profile.blocks.some((b) => b.id === "smoothness"))
    L.push(`ROUGHNESS = ${s.smoothness ? (s.smoothness === "0.5" ? "0.5" : `1.0 - ${atom(s.smoothness)}`) : "0.5"};`);
  if (s.specular) L.push(`SPECULAR = ${s.specular};`);
  if (s.rim) L.push(`RIM = ${s.rim};`);
  if (s.rimTint) L.push(`RIM_TINT = ${s.rimTint};`);
  if (s.translucency)
    L.push(
      `BACKLIGHT = ${s.thickness && s.thickness !== "0.0" ? `${atom(s.translucency)} * (1.0 - ${atom(s.thickness)})` : s.translucency};`,
    );
  if (s.occlusion) L.push(`AO = ${s.occlusion};`);
  if (o.aoLightAffect !== 0 && s.occlusion)
    L.push(`AO_LIGHT_AFFECT = ${formatFloat(Number(o.aoLightAffect.toFixed(4)))};`);
  if (s.emission) L.push(`EMISSION = ${s.emission};`);
  return fn("fragment", L);
}

/**
 * `light` : the Light-stage blocks are ADDED per light (`DIFFUSE_LIGHT` / `SPECULAR_LIGHT` accumulate over the lights),
 * `ALPHA` is assigned. Defining `light()` replaces Godot's default per-light shading, so an unconnected diffuse / specular block adds nothing.
 * Empty (no `light()` emitted) when the option is off or no Light-stage block is connected. [verify]
 */
export function lightFunction(g: Generated, o: GodotOptions): string[] {
  if (!o.customLight || !g.light) return [];
  const s = g.light.slotExprs;
  // Unconnected blocks carry their default constant: skip it (a zero `+=` / `ALPHA = 1.0` is noise) and emit nothing at all when
  // no block is connected — defining light() would REPLACE Godot's default per-light shading with nothing.
  const diffuse = s.lightDiffuse && s.lightDiffuse !== "vec3(0.0)" ? s.lightDiffuse : undefined;
  const specular = s.lightSpecular && s.lightSpecular !== "vec3(0.0)" ? s.lightSpecular : undefined;
  const alpha = s.lightAlpha && s.lightAlpha !== "1.0" ? s.lightAlpha : undefined;
  if (!diffuse && !specular && !alpha) return [];
  const L = lines(g.light.body);
  if (diffuse) L.push(`DIFFUSE_LIGHT += ${diffuse};`);
  if (specular) L.push(`SPECULAR_LIGHT += ${specular};`);
  if (alpha) L.push(`ALPHA = ${alpha};`);
  return fn("light", L);
}
