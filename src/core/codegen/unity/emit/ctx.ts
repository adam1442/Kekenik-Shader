import type { Generated } from "../../dialect/generate";
import type { AttributeName } from "../../glsl/builtins";
import type { BlockDef, ProfileProblem, TargetProfile } from "../../../profiles/types";
import type { ProfileDef } from "../../../registry/profile";
import type { Property } from "../../../properties/model";
import type { UnityOptions } from "../options";
import type { UnityPackState } from "../pack";

/** Slice ids: which master outputs a generated function evaluates. */
export type SliceId = "forward" | "alpha" | "normals";

export interface UnityEmitOptions {
  graphName: string;
  settings: Record<string, import("../../../graph/types").ParamValue>;
  /** ALL graph properties (exposed ones always reach `Properties {}`). */
  properties: Property[];
  keywordCount?: number;
  /** Graph keywords (Boolean / Enum). Non-`static` ones become real `shader_feature_local` variants. */
  keywords?: import("../../../properties/model").Keyword[];
  labels?: Record<string, string>;
  /** Graph node ids evaluated per vertex and interpolated (Custom Interpolator / hint). */
  interpolate?: string[];
  /** Version printed in the header (the app passes APP_VERSION). */
  generatorVersion?: string;
}

export interface EmitCtx {
  o: UnityOptions;
  tp: TargetProfile;
  def: ProfileDef;
  st: UnityPackState;
  gens: Partial<Record<SliceId, Generated>>;
  /** Attributes any pass needs (union; one shared `KsAttributes`). */
  attrs: Set<AttributeName>;
  /** Fragment blocks active under the current options. */
  fragmentBlocks: BlockDef[];
  usesFace: boolean;
  usesVertexId: boolean;
  /** The graph reads the Instance ID input (`KS_INSTANCE_ID` macro is declared). */
  usesInstanceId: boolean;
  /** Keywords the graph reads (variants of every pass). */
  keywords: import("./keywords").UnityKeyword[];
  /** `#pragma shader_feature_local…` lines shared by every pass. */
  keywordPragmas: string[];
  problems: ProfileProblem[];
  /** Extra HLSL members appended to `KsAttributes` (e.g. `float3 positionOld : TEXCOORD4;`, flipbook AnimBlend). */
  extraAttrs: string[];
  /** Runtime alpha clip reads the material property `_Cutoff` (threshold block unconnected) instead of `s.alphaClipThreshold`. */
  cutoffProp: boolean;
  /** Properties implied by the options / graph (declared by `buildPropertySections`). */
  implied: { spriteRect: boolean };
  /** Flipbook blending plan (E2): the fragment varying carrying UV0 and the TEXCOORD index of AnimBlend. */
  flipbook?: { uvVarying: string; blendIndex: number };
}

export const ATTR_MEMBER: Record<AttributeName, string> = {
  a_position: "positionOS",
  a_normal: "normalOS",
  a_uv0: "uv0",
  a_color: "color",
  a_tangent: "tangentOS",
  a_uv1: "uv1",
  a_uv2: "uv2",
  a_uv3: "uv3",
};
export const ATTR_TYPE: Record<AttributeName, string> = {
  a_position: "float3",
  a_normal: "float3",
  a_uv0: "float2",
  a_color: "float4",
  a_tangent: "float4",
  a_uv1: "float2",
  a_uv2: "float2",
  a_uv3: "float2",
};

/** Sprite Lit = the 2D-renderer lit sprite profile (`unity.urp.sprite-lit`). */
export const isSpriteLit = (tp: TargetProfile): boolean => tp.family === "sprite" && tp.id.endsWith("sprite-lit");

export const indent = (text: string, n = 1): string =>
  text
    .replace(/\n+$/, "")
    .split("\n")
    .map((l) => (l === "" ? "" : "    ".repeat(n) + l))
    .join("\n");

export const HLSL_BLOCK_TYPE: Record<string, string> = {
  float: "float",
  vec2: "float2",
  vec3: "float3",
  color: "float3",
  vec4: "float4",
  color4: "float4",
};
export function defaultText(b: BlockDef): string {
  const t = HLSL_BLOCK_TYPE[b.type] ?? "float";
  const v = b.defaultValue;
  const f = (n: number): string => (Number.isInteger(n) ? n.toFixed(1) : String(n));
  if (Array.isArray(v)) return `${t}(${v.map(f).join(", ")})`;
  return typeof v === "number" ? f(v) : `((${t})0)`;
}
