import type { FactStatus } from "./includes";

/** Surface-option → ShaderLab tables ( brief §5, exact). */
export type BlendMode = "opaque" | "alpha" | "premultiply" | "additive" | "multiply";
export const BLEND_MODES: readonly BlendMode[] = ["opaque", "alpha", "premultiply", "additive", "multiply"];

export interface BlendRow {
  blend: string;
  /** Sprite profiles use a separate alpha blend factor. */
  blendSprite?: string;
  zwrite: boolean;
  renderType: "Opaque" | "Transparent";
  queue: "Geometry" | "Transparent";
  /** Shader-side fix-up applied to the final colour (`{c}` = colour variable, `{a}` = alpha expression). */
  shader?: { unlit?: string; lit?: string };
  status: FactStatus;
}

export const BLEND_TABLE: Readonly<Record<BlendMode, BlendRow>> = {
  opaque: { blend: "Blend One Zero", zwrite: true, renderType: "Opaque", queue: "Geometry", status: "V" },
  alpha: {
    blend: "Blend SrcAlpha OneMinusSrcAlpha",
    blendSprite: "Blend SrcAlpha OneMinusSrcAlpha, One OneMinusSrcAlpha",
    zwrite: false,
    renderType: "Transparent",
    queue: "Transparent",
    status: "V",
  },
  premultiply: {
    blend: "Blend One OneMinusSrcAlpha",
    zwrite: false,
    renderType: "Transparent",
    queue: "Transparent",
    shader: { unlit: "{c}.rgb *= {a};", lit: "#define _ALPHAPREMULTIPLY_ON" },
    status: "K",
  },
  additive: {
    blend: "Blend SrcAlpha One",
    zwrite: false,
    renderType: "Transparent",
    queue: "Transparent",
    status: "K",
  },
  multiply: {
    blend: "Blend DstColor Zero",
    zwrite: false,
    renderType: "Transparent",
    queue: "Transparent",
    shader: { unlit: "{c}.rgb = lerp(1.0, {c}.rgb, {a});", lit: "{c}.rgb = lerp(1.0, {c}.rgb, {a});" },
    status: "K",
  },
};

/** `UnityEngine.Rendering.BlendMode` (Zero 0, One 1, DstColor 2, SrcAlpha 5, OneMinusSrcAlpha 10) → [src, dst] defaults of the exposed `_SrcBlend` / `_DstBlend`. */
export const BLEND_FACTOR_VALUE: Readonly<Record<BlendMode, readonly [number, number]>> = {
  opaque: [1, 0],
  alpha: [5, 10],
  premultiply: [1, 10],
  additive: [5, 1],
  multiply: [2, 0],
};

export const CULL_MODES = ["back", "front", "off"] as const;
export type CullMode = (typeof CULL_MODES)[number];
export const CULL_TEXT: Record<CullMode, string> = { back: "Cull Back", front: "Cull Front", off: "Cull Off" };
/** UnityEngine.Rendering.CullMode numeric values (Off=0, Front=1, Back=2). */
const CULL_ENUM_VALUE: Record<CullMode, number> = { off: 0, front: 1, back: 2 };

export const ZTEST_MODES = ["lequal", "less", "greater", "gequal", "equal", "notequal", "always"] as const;
export type ZTestMode = (typeof ZTEST_MODES)[number];
export const ZTEST_TEXT: Record<ZTestMode, string> = {
  lequal: "LEqual",
  less: "Less",
  greater: "Greater",
  gequal: "GEqual",
  equal: "Equal",
  notequal: "NotEqual",
  always: "Always",
};
/** UnityEngine.Rendering.CompareFunction values (LessEqual = 4). */
const ZTEST_ENUM_VALUE: Record<ZTestMode, number> = {
  lequal: 4,
  less: 2,
  greater: 5,
  gequal: 7,
  equal: 3,
  notequal: 6,
  always: 8,
};

/** ShaderLab-only material properties for the "Expose in Material" option (never declared in HLSL ⇒ legal for the SRP Batcher). */
export const EXPOSED_STATE_PROPS = {
  cull: (v: CullMode): string => `[Enum(UnityEngine.Rendering.CullMode)] _Cull("Cull", Float) = ${CULL_ENUM_VALUE[v]}`,
  zwrite: (on: boolean): string => `[Toggle] _ZWrite("ZWrite", Float) = ${on ? 1 : 0}`,
  ztest: (v: ZTestMode): string =>
    `[Enum(UnityEngine.Rendering.CompareFunction)] _ZTest("ZTest", Float) = ${ZTEST_ENUM_VALUE[v]}`,
} as const;

export const QUEUE_BASE = { Geometry: 2000, AlphaTest: 2450, Transparent: 3000 } as const;
export const QUEUE_OFFSET_RANGE = { min: -50, max: 50 } as const;
