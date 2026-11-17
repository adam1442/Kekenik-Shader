import { BUILTIN_ENTRIES } from "../../engine/builtinEntries";
import { fillEngineTemplate } from "../../engine/template";
import { BACKEND_TRAITS } from "../../ir/traits";
import type { IRExpr, Stage } from "../../ir/types";
import type { Property } from "../../properties/model";
import type { HelperDef } from "../base/helpers";
import { GODOT_IHASH_HELPERS } from "../base/ihashHelpers";
import { BUILTIN_ENGINE_PREFIX, type BuiltinDep } from "../../ir/lowerEngine";
import type { StorageType } from "../../types/shaderType";
import { type ExplicitUniform, type LangPack } from "../dialect/generate";
import type { InputSyntax } from "../dialect/inputs";
import { plain } from "../dialect/ops";
import { type Dialect, type RenderApi, type Text, UnsupportedError } from "../dialect/types";
import { BUILTIN_UNIFORMS, type BuiltinUniformName } from "../glsl/builtins";
import { glslDialect } from "../glsl/dialect";
import { glslSyntax } from "../glsl/syntax";
import { builtinsFor } from "./data/builtins";
import { RESERVED_GODOT } from "./data/language";
import { godotUniformRead } from "./uniforms";

/** State shared between the pack (while generating) and the assembler (afterwards). */
export interface GodotPackState {
  canvas: boolean;
  /** property id → final Godot reference name. */
  names: ReadonlyMap<string, string>;
  /** Properties bound to the built-in `TEXTURE` (CanvasItem sprite texture). */
  spriteProps: ReadonlySet<string>;
  /** Texture uniform name → tiling / offset uniforms. */
  tiling: Set<string>;
  /** Runtime keyword uniform id (`kw:<id>`) → { name, kind }. */
  keywordNames: Map<string, { name: string; kind: "boolean" | "enum" }>;
  engineTemplates: Set<string>;
  engineHelpers: Set<string>;
  /** Built-ins with no Godot equivalent (replaced by a typed zero). */
  missing: Set<string>;
  /** Hint-textures the engine templates need (declared once by the assembler). */
  screenTextures: Set<"screen" | "depth" | "normal_roughness">;
  missingAttrs: Set<string>;
}

export const newGodotState = (
  canvas: boolean,
  names: ReadonlyMap<string, string>,
  spriteProps: ReadonlySet<string>,
): GodotPackState => ({
  canvas,
  names,
  spriteProps,
  tiling: new Set(),
  keywordNames: new Map(),
  engineTemplates: new Set(),
  engineHelpers: new Set(),
  missing: new Set(),
  screenTextures: new Set(),
  missingAttrs: new Set(),
});

/** Spelling of the portable `ks_*` host uniforms in Godot. `undefined` = no Godot equivalent (typed zero + warning). */
const GODOT_UNIFORM: Readonly<Record<string, string | undefined>> = {
  ks_Model: "MODEL_MATRIX",
  ks_WorldToObject: "inverse(MODEL_MATRIX)",
  ks_View: "VIEW_MATRIX",
  ks_Projection: "PROJECTION_MATRIX",
  ks_ViewInverse: "INV_VIEW_MATRIX",
  ks_ProjectionInverse: "INV_PROJECTION_MATRIX",
  ks_NormalMatrix: "transpose(inverse(mat3(MODEL_MATRIX)))",
  ks_CameraPos: "INV_VIEW_MATRIX[3].xyz",
  ks_ScreenParams: "vec4(VIEWPORT_SIZE, 1.0 / VIEWPORT_SIZE)",
  ks_Time: "TIME",
  ks_CameraParams: undefined,
  ks_FogColor: undefined,
  ks_FogParams: undefined,
  ks_MainLightDir: undefined,
  ks_MainLightColor: undefined,
  ks_AmbientColor: undefined,
  ks_SpriteRect: undefined,
  ks_SpriteInfo: undefined,
  ks_DeltaTime: undefined,
  ks_SmoothDeltaTime: undefined,
};
const ZERO: Record<string, string> = {
  mat4: "mat4(1.0)",
  mat3: "mat3(1.0)",
  vec4: "vec4(0.0)",
  vec3: "vec3(0.0)",
  vec2: "vec2(0.0)",
  float: "0.0",
};

/** `a_*` vertex attributes → vertex() built-ins (Spatial). a_tangent.w (handedness) is rebuilt from BINORMAL. */
const SPATIAL_ATTR: Record<string, string | undefined> = {
  a_position: "VERTEX",
  a_normal: "NORMAL",
  a_uv0: "UV",
  a_uv1: "UV2",
  a_color: "COLOR",
  a_tangent: "vec4(TANGENT, (dot(cross(NORMAL, TANGENT), BINORMAL) < 0.0) ? -1.0 : 1.0)",
  a_uv2: undefined,
  a_uv3: undefined,
};
const CANVAS_ATTR: Record<string, string | undefined> = {
  a_position: "vec3(VERTEX, 0.0)",
  a_normal: "vec3(0.0, 0.0, 1.0)",
  a_uv0: "UV",
  a_color: "COLOR",
  a_tangent: "vec4(1.0, 0.0, 0.0, 1.0)",
  a_uv1: undefined,
  a_uv2: undefined,
  a_uv3: undefined,
};
export const attrTable = (canvas: boolean): Record<string, string | undefined> => (canvas ? CANVAS_ATTR : SPATIAL_ATTR);

const godotSyntax = (st: GodotPackState): InputSyntax => ({
  ...glslSyntax,
  attr: (a) => {
    const t = attrTable(st.canvas)[a];
    if (t === undefined) {
      st.missingAttrs.add(a);
      return "vec2(0.0)";
    }
    return t;
  },
  uni: (u) => {
    const t = GODOT_UNIFORM[u];
    if (t === undefined) {
      st.missing.add(u);
      return ZERO[BUILTIN_UNIFORMS[u as BuiltinUniformName]?.ty ?? "float"] ?? "0.0";
    }
    return t;
  },
  faceSign: "(FRONT_FACING ? 1.0 : -1.0)",
  vertexId: "VERTEX_ID",
  instanceId: "INSTANCE_ID",
  flipUvV: false,
});

/** Godot dialect = the GLSL dialect (same language family) with stage-aware sampling and tiling / offset. */
function makeGodotDialect(st: GodotPackState): Dialect {
  return {
    ...glslDialect,
    traits: BACKEND_TRAITS.godot,
    render(e: IRExpr, api: RenderApi): Text {
      if (e.op === "sample") {
        const tex = api.use(e.tex);
        let uv = api.bare(e.uv);
        if (st.tiling.has(tex)) uv = `(${uv}) * ${tex}_tiling + ${tex}_offset`;
        // Vertex stage: only textureLod is available.
        if (e.mode === "lod") return plain(`textureLod(${tex}, ${uv}, ${api.bare(e.lod!)})`);
        if (e.mode === "implicit")
          return plain(api.svc.stage === "vertex" ? `textureLod(${tex}, ${uv}, 0.0)` : `texture(${tex}, ${uv})`);
        return plain(`textureGrad(${tex}, ${uv}, ${api.bare(e.ddx!)}, ${api.bare(e.ddy!)})`);
      }
      return glslDialect.render(e, api);
    },
  };
}

/** Godot has function-like macros; one definition serves every type (no overloads needed). [K → manual check `unverified-api`] */
const GODOT_HELPERS: readonly HelperDef[] = [
  { id: "ks_round", code: "// Round half up: identical on every backend.\n#define ks_round(x) floor((x) + 0.5)" },
  ...GODOT_IHASH_HELPERS,
];

const identifiersOf = (code: string): string[] => [...new Set(code.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])];
const SCREEN_NAMES: Array<[RegExp, "screen" | "depth" | "normal_roughness", string]> = [
  [/\bnormal_roughness_texture\b/g, "normal_roughness", "kek_normal_roughness_texture"],
  [/\bscreen_texture\b/g, "screen", "kek_screen_texture"],
  [/\bdepth_texture\b/g, "depth", "kek_depth_texture"],
];

/** Non-global built-ins (VERTEX, PROJECTION_MATRIX, VIEWPORT_SIZE …) of one shader type, with their types. */
const processorBuiltins = (canvas: boolean): Map<string, string> => {
  const type = canvas ? "canvas_item" : "spatial";
  const globals = new Set(builtinsFor(type, "global").map((b) => b.name));
  const m = new Map<string, string>();
  for (const fn of ["vertex", "fragment", "light"] as const)
    for (const b of builtinsFor(type, fn)) if (!globals.has(b.name) && !m.has(b.name)) m.set(b.name, b.type);
  return m;
};

/**
 * Built-ins (in order of first appearance) that the Godot template of engine entry `name` reads. A helper function cannot read them (E7):
 * `lowerEngineBuiltins` turns each one into a hidden parameter when the engine op sits inside a function.
 */
export function godotEngineDeps(name: string, canvas: boolean): BuiltinDep[] {
  const entry = BUILTIN_ENTRIES.find((e) => e.id === name);
  const t = entry ? (canvas ? entry.targets.godotCanvas : entry.targets.godotSpatial) : undefined;
  if (!entry || !t || t.availability === "unsupported") return [];
  const pb = processorBuiltins(canvas);
  const out: BuiltinDep[] = [];
  for (const id of identifiersOf(t.expr)) {
    const ty = pb.get(id);
    if (ty !== undefined && ty !== "sampler2D" && !out.some((d) => d.name === id)) out.push({ name: id, ty: ty as StorageType });
  }
  return out;
}

function engineFor(st: GodotPackState) {
  return (name: string, args?: readonly string[], stage?: Stage): string | undefined => {
    const proc = stage === "vertex" || stage === "fragment" || stage === "light" ? stage : undefined;
    const typeName = st.canvas ? "canvas_item" : "spatial";
    const available = (b: string): boolean => (proc === undefined ? true : builtinsFor(typeName, proc).some((x) => x.name === b));
    // `godot.builtin.X` = the bare built-in identifier, passed by the processor function to a helper (see core/ir/lowerEngine.ts).
    if (name.startsWith(BUILTIN_ENGINE_PREFIX)) {
      const b = name.slice(BUILTIN_ENGINE_PREFIX.length);
      if (!available(b)) throw new UnsupportedError(`${b} is not available in ${proc}() of shader_type ${typeName}`);
      return b;
    }
    const entry = BUILTIN_ENTRIES.find((e) => e.id === name);
    const t = entry ? (st.canvas ? entry.targets.godotCanvas : entry.targets.godotSpatial) : undefined;
    if (!entry || !t || t.availability === "unsupported") return undefined;
    if (entry.stage === "light" && stage !== "light") return undefined;
    if (entry.args.length > 0 && (args?.length ?? 0) < entry.args.length) return undefined;
    // Hint-texture names (`depth_texture`, …) in the template AND in its helper are renamed to the collision-free `kek_*` uniforms.
    const rename = (code: string): string => {
      let out = code;
      for (const [re, kind, to] of SCREEN_NAMES)
        if (re.test(out)) {
          st.screenTextures.add(kind);
          out = out.replace(re, to);
        }
      return out;
    };
    let expr = rename(t.expr);
    // Inside a helper function the built-ins the template reads arrive as hidden trailing arguments: substitute them.
    const deps = godotEngineDeps(name, st.canvas);
    for (const [i, d] of deps.entries())
      if (args?.[entry.args.length + i] === undefined && !available(d.name))
        throw new UnsupportedError(`${d.name} is not available in ${proc}() of shader_type ${typeName} (needed by ${name})`);
    deps.forEach((d, i) => {
      const a = args?.[entry.args.length + i];
      if (a !== undefined) expr = expr.replace(new RegExp(`\\b${d.name}\\b`, "g"), a);
    });
    for (const id of identifiersOf(expr)) st.engineTemplates.add(id);
    if (t.helper) st.engineHelpers.add(rename(t.helper));
    return fillEngineTemplate(expr, args);
  };
}

export function makeGodotPack(st: GodotPackState): LangPack {
  return {
    dialect: makeGodotDialect(st),
    traits: BACKEND_TRAITS.godot,
    target: "godot",
    syntax: () => godotSyntax(st),
    helpers: GODOT_HELPERS,
    reserved: [
      ...RESERVED_GODOT,
      "kek_modulate",
      "kek_depth_texture",
      "kek_screen_texture",
      "kek_normal_roughness_texture",
      "kek_alpha",
      "kek_color",
      "kek_scene_depth",
      "soft_near",
      "soft_far",
    ],
    uniformName: (id) => (st.spriteProps.has(id) ? "TEXTURE" : (st.names.get(id) ?? st.keywordNames.get(id)?.name)),
    uniformExpr: (u: ExplicitUniform) => {
      const kw = st.keywordNames.get(u.prop);
      if (kw) return kw.kind === "boolean" ? `(${u.name} ? 1 : 0)` : u.name;
      if (st.spriteProps.has(u.prop)) return "TEXTURE";
      return godotUniformRead(u.property as Property, u.name);
    },
    engine: (name, _syntax, args, stage) => engineFor(st)(name, args, stage),
  };
}
