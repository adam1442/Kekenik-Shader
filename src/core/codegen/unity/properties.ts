import type { Property } from "../../properties/model";
import { UNITY_TEX_MACROS } from "./data/textureKinds";

/** Parameter manifest → ShaderLab `Properties {}` + `CBUFFER` + texture declarations (brief §7). Pure; deterministic. */
export interface UnityPropertyOut {
  /** ShaderLab property line(s) including attributes. */
  lines: string[];
  /** HLSL lines inside `CBUFFER_START(UnityPerMaterial)`. */
  cbuffer: string[];
  /** `TEXTURE2D(...)` / `SAMPLER(...)` lines (outside the CBUFFER). */
  textures: string[];
  header?: string;
}

const num = (n: number): string => {
  if (!Number.isFinite(n)) return "0";
  const t = Number(n.toFixed(6));
  return Object.is(t, -0) ? "0" : String(t);
};
const label = (s: string): string =>
  s
    .replace(/["\\\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const headerText = (s: string): string => s.replace(/[^A-Za-z0-9 _.-]+/g, " ").trim();
const TEX_DEFAULT: Record<string, string> = {
  white: "white",
  black: "black",
  grey: "gray",
  bump: "bump",
  red: "red",
  none: "white",
};

/** Value list of a vector-like default (`(x, y, z, w)`), padded with `pad` (alpha 1 for colours, 0 for vectors). */
const vec4 = (v: unknown, n: number, alphaOne: boolean): string => {
  const a = Array.isArray(v) ? (v as number[]) : [];
  const c = [0, 1, 2, 3].map((i) => (i < n ? (a[i] ?? 0) : i === 3 && alphaOne ? 1 : 0));
  return `(${c.map(num).join(", ")})`;
};

export function unityProperty(
  p: Property,
  name: string,
  opts: { keyword?: string | undefined } = {},
): UnityPropertyOut {
  const attrs: string[] = [];
  if (!p.exposed) attrs.push("[HideInInspector]");
  if (p.perInstance) attrs.push("[PerRendererData]");
  const disp = label(p.displayName);
  const pre = (): string => (attrs.length ? `${attrs.join(" ")} ` : "");
  const out: UnityPropertyOut = { lines: [], cbuffer: [], textures: [] };
  if (p.category && p.exposed) out.header = headerText(p.category);
  const d = p.default;
  switch (p.type) {
    case "float": {
      const dv = typeof d === "number" ? d : 0;
      if (p.enumValues && p.enumValues.length)
        attrs.push(
          `[Enum(${p.enumValues.map((e) => `${label(e.name).replace(/[^A-Za-z0-9_ ]/g, "")},${num(e.value)}`).join(",")})]`,
        );
      if (p.slider && p.min !== undefined && p.max !== undefined)
        out.lines.push(`${pre()}${name}("${disp}", Range(${num(p.min)}, ${num(p.max)})) = ${num(dv)}`);
      else out.lines.push(`${pre()}${name}("${disp}", Float) = ${num(dv)}`);
      out.cbuffer.push(`float ${name};`);
      break;
    }
    case "int": {
      const dv = Math.round(typeof d === "number" ? d : 0);
      if (p.enumValues && p.enumValues.length)
        attrs.push(
          `[Enum(${p.enumValues.map((e) => `${label(e.name).replace(/[^A-Za-z0-9_ ]/g, "")},${Math.round(e.value)}`).join(",")})]`,
        );
      if (p.slider && p.min !== undefined && p.max !== undefined) {
        attrs.unshift("[IntRange]");
        out.lines.push(`${pre()}${name}("${disp}", Range(${Math.round(p.min)}, ${Math.round(p.max)})) = ${dv}`);
        out.cbuffer.push(`float ${name};`);
      } else {
        out.lines.push(`${pre()}${name}("${disp}", Integer) = ${dv}`);
        out.cbuffer.push(`int ${name};`);
      }
      break;
    }
    case "bool":
      attrs.push(opts.keyword ? `[Toggle(${opts.keyword})]` : "[ToggleUI]");
      out.lines.push(`${pre()}${name}("${disp}", Float) = ${d === true || d === 1 ? 1 : 0}`);
      out.cbuffer.push(`float ${name};`);
      break;
    case "vec2":
    case "vec3":
    case "vec4": {
      const n = p.type === "vec2" ? 2 : p.type === "vec3" ? 3 : 4;
      out.lines.push(`${pre()}${name}("${disp}", Vector) = ${vec4(d, n, false)}`);
      out.cbuffer.push(`float4 ${name};`);
      break;
    }
    case "color":
    case "color4": {
      if (p.hdr) attrs.push("[HDR]");
      out.lines.push(`${pre()}${name}("${disp}", Color) = ${vec4(d, p.type === "color" ? 3 : 4, true)}`);
      out.cbuffer.push(`float4 ${name};`);
      break;
    }
    case "texture2DArray":
    case "texture3D":
    case "textureCube": {
      // Non-2D kinds: no Tiling/Offset, no default texture keyword (an empty string is always valid ShaderLab; Unity binds its own default).
      const m = UNITY_TEX_MACROS[p.type];
      attrs.push("[NoScaleOffset]");
      out.lines.push(`${pre()}${name}("${disp}", ${m.shaderLab}) = "" {}`);
      out.textures.push(`${m.decl}(${name});`, `SAMPLER(sampler${name});`);
      break;
    }
    case "texture2D": {
      const normal = p.textureDefault === "bump";
      if (name === "_MainTex") attrs.push("[MainTexture]"); // the sprite / main texture (SpriteRenderer, Material.mainTexture)
      if (!p.tilingOffset) attrs.push("[NoScaleOffset]");
      if (normal) attrs.push("[Normal]");
      out.lines.push(`${pre()}${name}("${disp}", 2D) = "${TEX_DEFAULT[p.textureDefault ?? "white"] ?? "white"}" {}`);
      out.textures.push(`TEXTURE2D(${name});`, `SAMPLER(sampler${name});`);
      if (p.tilingOffset) out.cbuffer.push(`float4 ${name}_ST;`);
      break;
    }
  }
  return out;
}

/** HLSL read expression of a property uniform from its CBUFFER storage (`float4` for every vector / colour). */
export function unityUniformRead(storage: string, name: string): string {
  switch (storage) {
    case "bool":
      return `(${name} != 0.0)`;
    case "vec2":
      return `${name}.xy`;
    case "vec3":
      return `${name}.xyz`;
    default:
      return name;
  }
}
