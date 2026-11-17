import { type ShaderType, isShaderType } from "../types/shaderType";

/** Targets a Custom Function node carries a body for. */
export const CUSTOM_TARGETS = ["glsl", "hlsl", "wgsl", "godot", "unity"] as const;
export type CustomTarget = (typeof CUSTOM_TARGETS)[number];

export const CUSTOM_TARGET_LABEL: Record<CustomTarget, string> = {
  glsl: "GLSL",
  hlsl: "HLSL",
  wgsl: "WGSL",
  godot: "Godot",
  unity: "Unity (HLSL)",
};

export interface CustomPort {
  name: string;
  type: ShaderType;
}

/** The whole definition of a Custom Function node (stored as JSON in the node param `spec`). */
export interface CustomFnSpec {
  name: string;
  inputs: CustomPort[];
  outputs: CustomPort[];
  bodies: Partial<Record<CustomTarget, string>>;
  /** Godot reuses the GLSL body (GLSL-family convenience). */
  sharedGlsl: boolean;
  /** Unity reuses the HLSL body (HLSL-family convenience). */
  sharedHlsl: boolean;
  /** "inline": bodies are pasted into the generated shader. "file": the function lives in an external include file (see `files`). */
  mode: CustomMode;
  /** File mode: include path per target (HLSL / Unity / Godot — GLSL ES and WGSL have no `#include`). The function `name` must be declared there. */
  files: Partial<Record<CustomTarget, string>>;
}

type CustomMode = "inline" | "file";
/** Targets that can reference an include file (the language has `#include`). */
export const FILE_TARGETS: readonly CustomTarget[] = ["hlsl", "unity", "godot"];
const PATH_RE = /^[A-Za-z0-9_./@:\- ]+$/;

export const CUSTOM_FN_PARAM = "spec";
export const CUSTOM_FN_DEF = "custom.function";

function defaultSpec(): CustomFnSpec {
  return {
    name: "MyFunction",
    inputs: [
      { name: "In", type: "vec3" },
      { name: "Gain", type: "float" },
    ],
    outputs: [{ name: "Out", type: "vec3" }],
    bodies: {
      glsl: "Out = In * Gain;",
      hlsl: "Out = In * Gain;",
      wgsl: "Out = In * Gain;",
      godot: "Out = In * Gain;",
      unity: "Out = In * Gain;",
    },
    sharedGlsl: true,
    sharedHlsl: true,
    mode: "inline",
    files: {},
  };
}

const port = (v: unknown): CustomPort | undefined => {
  const o = v as { name?: unknown; type?: unknown } | null;
  return o && typeof o.name === "string" && isShaderType(o.type) ? { name: o.name, type: o.type } : undefined;
};

/** Tolerant parser: anything malformed falls back to the default spec (never throws). */
export function parseSpec(json: unknown): CustomFnSpec {
  const d = defaultSpec();
  if (typeof json !== "string" || json === "") return d;
  try {
    const o = JSON.parse(json) as Partial<CustomFnSpec>;
    const ins = (Array.isArray(o.inputs) ? o.inputs : []).map(port).filter((p): p is CustomPort => !!p);
    const outs = (Array.isArray(o.outputs) ? o.outputs : []).map(port).filter((p): p is CustomPort => !!p);
    const bodies: CustomFnSpec["bodies"] = {};
    for (const t of CUSTOM_TARGETS) if (typeof o.bodies?.[t] === "string") bodies[t] = o.bodies[t]!;
    const files: CustomFnSpec["files"] = {};
    for (const t of CUSTOM_TARGETS) if (typeof o.files?.[t] === "string") files[t] = o.files[t]!;
    return {
      name: typeof o.name === "string" ? o.name : d.name,
      inputs: ins,
      outputs: outs,
      bodies,
      sharedGlsl: o.sharedGlsl !== false,
      sharedHlsl: o.sharedHlsl !== false,
      mode: o.mode === "file" ? "file" : "inline",
      files,
    };
  } catch {
    return d;
  }
}

export const serializeSpec = (s: CustomFnSpec): string => JSON.stringify(s);

/** Include path used for `target` in file mode (Unity reuses the HLSL path when `sharedHlsl`; Godot never reuses the GLSL one — GLSL ES has no `#include`). */
export function includeFor(spec: CustomFnSpec, target: CustomTarget): string | undefined {
  if (spec.mode !== "file" || !FILE_TARGETS.includes(target)) return undefined;
  const p = (target === "unity" && spec.sharedHlsl ? spec.files.hlsl : spec.files[target]) ?? "";
  return p.trim() === "" ? undefined : p.trim();
}

/** Statement calling the external function: `Name(In, Gain, Out);` (outputs are the wrapper's locals, passed as `out` arguments). */
const fileCallBody = (spec: CustomFnSpec): string =>
  `${spec.name}(${[...spec.inputs, ...spec.outputs].map((p) => p.name).join(", ")});`;

/** Body used for `target` after the mode and family convenience flags (undefined = missing). */
export function bodyFor(spec: CustomFnSpec, target: CustomTarget): string | undefined {
  if (spec.mode === "file") return includeFor(spec, target) ? fileCallBody(spec) : undefined;
  const own = spec.bodies[target];
  if (target === "godot" && spec.sharedGlsl) return spec.bodies.glsl;
  if (target === "unity" && spec.sharedHlsl) return spec.bodies.hlsl;
  return own;
}

const RESERVED = new Set(
  (
    "void bool int uint float double vec2 vec3 vec4 mat2 mat3 mat4 float2 float3 float4 float2x2 float3x3 float4x4 half sampler2D Texture2D SamplerState " +
    "if else for while do switch case default break continue return discard in out inout uniform const struct true false " +
    "fn var let ptr array f32 i32 u32 bool vec2f vec3f vec4f texture_2d sampler loop main"
  ).split(" "),
);

/** Static checks of the declaration (identifiers, duplicates, empty bodies). Missing bodies per target are reported by the compiler. */
export function validateSpec(spec: CustomFnSpec): string[] {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const p of [...spec.inputs, ...spec.outputs]) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.name)) errs.push(`"${p.name}" is not a valid identifier`);
    else if (RESERVED.has(p.name) || p.name.startsWith("ks_")) errs.push(`"${p.name}" is a reserved word`);
    if (seen.has(p.name)) errs.push(`Duplicate port name "${p.name}"`);
    seen.add(p.name);
  }
  for (const o of spec.outputs)
    if (o.type === "texture2D" || o.type === "sampler") errs.push(`Output "${o.name}" cannot be a texture / sampler`);
  if (spec.outputs.length === 0) errs.push("A custom function needs at least one output");
  if (spec.mode === "file") {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(spec.name) || RESERVED.has(spec.name))
      errs.push(`File mode calls "${spec.name}" by name — it must be a valid identifier`);
    for (const [t, p] of Object.entries(spec.files))
      if (p.trim() !== "" && !PATH_RE.test(p.trim()))
        errs.push(`Include path of ${t} contains characters that are not allowed (quotes, line breaks, …)`);
  }
  return errs;
}
