import type { Property, PropertyValue } from "../../properties/model";
import type { ProfileProblem } from "../../profiles/types";
import { formatFloat } from "../base/literals";
import { INSTANCE_UNIFORM_TYPES, MAX_INSTANCE_UNIFORMS } from "./data/hints";

/** Parameter manifest → Godot `uniform` declarations (brief §3). Pure and deterministic. */
export interface GodotUniformOut {
  /** Declaration lines (doc comment first). */
  lines: string[];
  /** `group_uniforms` category (exposed properties only). */
  category?: string;
  instance: boolean;
  problems: ProfileProblem[];
}

const num = (n: number): string => formatFloat(Number.isFinite(n) ? Number(n.toFixed(6)) : 0);
const label = (s: string): string =>
  s
    .replace(/\*\//g, "* /")
    .replace(/[\r\n]+/g, " ")
    .trim();
const str = (s: string): string =>
  s
    .replace(/["\\\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const vecArr = (v: PropertyValue, n: number, alpha: number): number[] => {
  const a = Array.isArray(v) ? v : [];
  return Array.from({ length: n }, (_, i) => (typeof a[i] === "number" ? (a[i] as number) : i === 3 ? alpha : 0));
};

const toSrgb = (c: number): number => {
  const x = Math.min(Math.max(c, 0), 1);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
};
const toLinear = (c: number): number => {
  const x = Math.min(Math.max(c, 0), 1);
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};
/**
 * HDR split: `intensity = max(r, g, b, 1)`, `color = default / intensity` (LDR part) — `color * intensity` equals the graph's value.
 * The inspector colour is `source_color` (sRGB): a LINEAR graph colour is stored as its sRGB encoding so the shader sees the graph's linear value
 * (`colorSpace: "srgb"` colours are exported unchanged). Round-trip: `toLinear(ui) * intensity ≈ graph default` (linear colours).
 */
function hdrSplit(p: Property): { intensity: number; ui: number[]; effective: number[] } {
  const n = p.type === "color" ? 3 : 4;
  const v = vecArr(p.default, n, 1);
  const intensity = p.hdr ? Math.max(1, v[0] ?? 0, v[1] ?? 0, v[2] ?? 0) : 1;
  const ldr = v.map((c, i) => (i < 3 ? c / intensity : c));
  const linear = p.colorSpace !== "srgb";
  const ui = ldr.map((c, i) => (i < 3 && linear ? toSrgb(c) : c));
  const effective = ui.map((c, i) => (i < 3 ? (linear ? toLinear(c) : c) * intensity : c));
  return { intensity, ui, effective };
}

const TEXTURE_DEFAULT_HINT: Record<string, string> = {
  white: "hint_default_white",
  black: "hint_default_black",
  transparent: "hint_default_transparent",
  none: "hint_default_white",
  grey: "hint_default_white",
  red: "hint_default_white",
  bump: "hint_normal",
};

const ctor = (n: number, c: number[]): string => `vec${n}(${c.map(num).join(", ")})`;
const enumHint = (p: Property): string =>
  `hint_enum(${(p.enumValues ?? []).map((e) => `"${str(e.name).replace(/:/g, "")}${Math.round(e.value) === (p.enumValues ?? []).indexOf(e) ? "" : `:${Math.round(e.value)}`}"`).join(", ")})`;
const rangeHint = (p: Property, integer: boolean): string | undefined => {
  if (!p.slider || p.min === undefined || p.max === undefined) return undefined;
  const a = integer ? String(Math.round(p.min)) : num(p.min);
  const b = integer ? String(Math.round(p.max)) : num(p.max);
  return `hint_range(${a}, ${b}${p.step !== undefined && !integer ? `, ${num(p.step)}` : ""})`;
};

/** GLSL type a property is declared with in Godot (the enum properties become `int`). */
const godotStorageType = (p: Property): string => {
  switch (p.type) {
    case "float":
      return p.enumValues?.length ? "int" : "float";
    case "int":
      return "int";
    case "bool":
      return "bool";
    case "vec2":
      return "vec2";
    case "vec3":
      return "vec3";
    case "vec4":
      return "vec4";
    case "color":
      return "vec3";
    case "color4":
      return "vec4";
    case "texture2D":
      return "sampler2D";
    case "texture2DArray":
      return "sampler2DArray";
    case "texture3D":
      return "sampler3D";
    case "textureCube":
      return "samplerCube";
  }
};

export interface UniformOpts {
  /** `global uniform` (the global must exist in Project Settings → Shader Globals). */
  global?: boolean;
  /** Reserve an `instance uniform` slot (the caller enforces the limit of 16). */
  instanceAllowed?: boolean;
  /** Keyword-flagged Bool property → runtime uniform (+ warning `godot.keyword-runtime`). */
  keywordNote?: boolean;
}

export function godotUniform(p: Property, name: string, opts: UniformOpts = {}): GodotUniformOut {
  const problems: ProfileProblem[] = [];
  const type = godotStorageType(p);
  const instance = !!(
    p.perInstance &&
    opts.instanceAllowed !== false &&
    !opts.global &&
    INSTANCE_UNIFORM_TYPES.includes(type)
  );
  if (p.perInstance && !instance && !opts.global)
    problems.push({
      rule: "godot.instance-unsupported",
      severity: "warning",
      message: `"${p.displayName}": ${type.startsWith("sampler") ? "textures cannot be instance uniforms" : "instance uniform limit (16) reached"} — exported as a regular uniform`,
    });
  const prefix = opts.global ? "global uniform" : instance ? "instance uniform" : "uniform";
  const doc = `/** ${label(p.displayName)} */`;
  const d = p.default;
  const hints: string[] = [];
  let value = "";
  const lines: string[] = [];
  if (opts.keywordNote)
    problems.push({
      rule: "godot.keyword-runtime",
      severity: "warning",
      message: `"${p.displayName}": Godot has no per-material shader keywords — exported as a runtime uniform + if/switch`,
      manual: "keyword-runtime",
    });
  switch (p.type) {
    case "float": {
      if (p.enumValues?.length) {
        hints.push(enumHint(p));
        value = String(Math.round(typeof d === "number" ? d : 0));
        break;
      }
      const r = rangeHint(p, false);
      if (r) hints.push(r);
      value = num(typeof d === "number" ? d : 0);
      break;
    }
    case "int": {
      if (p.enumValues?.length) hints.push(enumHint(p));
      else {
        const r = rangeHint(p, true);
        if (r) hints.push(r);
      }
      value = String(Math.round(typeof d === "number" ? d : 0));
      break;
    }
    case "bool":
      value = d === true || d === 1 ? "true" : "false";
      break;
    case "vec2":
      value = ctor(2, vecArr(d, 2, 0));
      break;
    case "vec3":
      value = ctor(3, vecArr(d, 3, 0));
      break;
    case "vec4":
      value = ctor(4, vecArr(d, 4, 0));
      break;
    case "color":
    case "color4": {
      const n = p.type === "color" ? 3 : 4;
      hints.push("source_color");
      value = ctor(n, hdrSplit(p).ui);
      break;
    }
    case "texture2DArray":
    case "texture3D":
    case "textureCube": {
      // E9 [verify]: filter / repeat / source_color hints are valid for every sampler type (Godot 4 shading-language reference); the
      // `hint_default_*` / `hint_normal` family is sampler2D-only, so the default texture is left to the engine (white).
      if (p.colorSpace !== "linear") hints.push("source_color");
      hints.push(p.type === "texture3D" ? "filter_linear" : "filter_linear_mipmap");
      if (p.type !== "textureCube") hints.push(p.type === "texture3D" ? "repeat_disable" : "repeat_enable");
      break;
    }
    case "texture2D": {
      const def = p.textureDefault ?? "white";
      const normal = def === "bump";
      if (!normal && p.colorSpace !== "linear") hints.push("source_color");
      if (normal) hints.push("hint_normal");
      hints.push("filter_linear_mipmap", "repeat_enable");
      if (!normal) hints.push(TEXTURE_DEFAULT_HINT[def] ?? "hint_default_white");
      if (def === "grey" || def === "red")
        problems.push({
          rule: "godot.texture-default-approx",
          severity: "warning",
          message: `Texture default "${def}" of "${p.displayName}" has no Godot hint — exported as hint_default_white`,
        });
      break;
    }
  }
  if (opts.global) lines.push(doc, `${prefix} ${type} ${name};`);
  else
    lines.push(
      doc,
      `${prefix} ${type} ${name}${hints.length ? ` : ${hints.join(", ")}` : ""}${value ? ` = ${value}` : ""};`,
    );
  if ((p.type === "color" || p.type === "color4") && p.hdr) {
    lines.push(`${prefix} float ${name}_intensity : hint_range(0.0, 64.0, 0.01) = ${num(hdrSplit(p).intensity)};`);
  }
  if (p.type === "texture2D" && p.tilingOffset)
    lines.push(`uniform vec2 ${name}_tiling = vec2(1.0, 1.0);`, `uniform vec2 ${name}_offset = vec2(0.0, 0.0);`);
  return { lines, instance, ...(p.category && p.exposed ? { category: p.category } : {}), problems };
}

/** Expression that reads a property uniform in shader code. */
export function godotUniformRead(p: Property, name: string): string {
  if (p.type === "color" && p.hdr) return `(${name} * ${name}_intensity)`;
  if (p.type === "color4" && p.hdr) return `vec4(${name}.rgb * ${name}_intensity, ${name}.a)`;
  if (p.type === "float" && p.enumValues?.length) return `float(${name})`;
  return name;
}

/** `group_uniforms` section assembly: uncategorised first, then each category in first-use order. */
export function assembleUniformSections(
  items: ReadonlyArray<{ lines: string[]; category?: string | undefined }>,
): string[] {
  const out: string[] = [];
  const plain = items.filter((i) => !i.category);
  for (const i of plain) out.push(...i.lines);
  const cats = [...new Set(items.filter((i) => i.category).map((i) => i.category!))];
  for (const c of cats) {
    if (out.length) out.push("");
    out.push(`group_uniforms ${c.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "Group"};`);
    for (const i of items.filter((x) => x.category === c)) out.push(...i.lines);
    out.push("group_uniforms;");
  }
  return out;
}

export { MAX_INSTANCE_UNIFORMS };
