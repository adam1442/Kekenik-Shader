import type { RefTarget } from "../properties/names";
import type { BackendId } from "./types";
import type { Intrinsic } from "./intrinsics";

/**
 * Per-backend adaptation data (see the Convention Matrix in ARCHITECTURE.md). Backends read these instead of
 * hard-coding conventions, and refine the values when they implement real emitters.
 */
export interface BackendTraits {
  id: BackendId;
  displayName: string;
  /** Spelling strategy for exposed-parameter reference names. */
  nameTarget: RefTarget;
  /** Raw texel origin of the API: where (u,v)=(0,0) sits for a texture uploaded "as is". */
  textureOrigin: "bottom-left" | "top-left";
  /** Flip V (v' = 1 - v) when fetching mesh UVs so IR code can assume bottom-left origin. */
  uvInputFlipV: boolean;
  /** Language matrix storage for uniforms/constructors. */
  matrixStorage: "column-major" | "row-major";
  /** How M·v is spelled: operator `M * v` or function `mul(M, v)`. */
  mulStyle: "operator" | "mul-function";
  /** Do matrix constructors take columns (true) or rows (false)? */
  matrixCtorTakesColumns: boolean;
  /** Clip-space depth range after projection. */
  clipZRange: "zero-to-one" | "minus-one-to-one";
  /** Does +Y point up in NDC? */
  ndcYUp: boolean;
  /** Native `mod` already equals x - y*floor(x/y)? If false the backend must emit the formula. */
  modIsFloorMod: boolean;
  /** Single-scalar vector constructor splats (vec3(x))? If false emit (x,x,x). */
  scalarCtorSplats: boolean;
  /** Intrinsics reject scalar/vector mixes (WGSL min/max/clamp/mix…): backend must splat first. */
  strictIntrinsicShapes: boolean;
  /** Texture and sampler are separate objects. */
  separateTextureSampler: boolean;
  /** Intrinsic spelling overrides (anything missing keeps the portable name). */
  intrinsicNames: Partial<Record<Intrinsic, string>>;
}

const base = {
  matrixStorage: "column-major",
  mulStyle: "operator",
  matrixCtorTakesColumns: true,
  textureOrigin: "bottom-left",
  uvInputFlipV: false,
  clipZRange: "minus-one-to-one",
  ndcYUp: true,
  modIsFloorMod: true,
  scalarCtorSplats: true,
  strictIntrinsicShapes: false,
  separateTextureSampler: false,
  intrinsicNames: {},
} as const;

export const BACKEND_TRAITS: Readonly<Record<BackendId, BackendTraits>> = {
  ir: { ...base, id: "ir", displayName: "Kekenik IR (text)", nameTarget: "unity", intrinsicNames: {} },
  glsl: {
    ...base,
    id: "glsl",
    displayName: "GLSL ES 3.00 (WebGL2)",
    nameTarget: "glsl",
    intrinsicNames: { atan2: "atan" },
  },
  hlsl: {
    ...base,
    id: "hlsl",
    displayName: "HLSL",
    nameTarget: "hlsl",
    textureOrigin: "top-left",
    mulStyle: "mul-function",
    matrixCtorTakesColumns: false,
    clipZRange: "zero-to-one",
    modIsFloorMod: false,
    scalarCtorSplats: false,
    separateTextureSampler: true,
    intrinsicNames: { mix: "lerp", fract: "frac", inversesqrt: "rsqrt" },
  },
  wgsl: {
    ...base,
    id: "wgsl",
    displayName: "WGSL (WebGPU)",
    nameTarget: "wgsl",
    textureOrigin: "top-left",
    clipZRange: "zero-to-one",
    modIsFloorMod: false,
    strictIntrinsicShapes: true,
    separateTextureSampler: true,
    intrinsicNames: { mix: "mix", fract: "fract", inversesqrt: "inverseSqrt", atan2: "atan2" },
  },
  godot: {
    ...base,
    id: "godot",
    displayName: "Godot Shading Language 4.x",
    nameTarget: "godot",
    textureOrigin: "top-left",
    uvInputFlipV: true,
    clipZRange: "zero-to-one",
    ndcYUp: false,
    intrinsicNames: { atan2: "atan" },
  },
  unity: {
    ...base,
    id: "unity",
    displayName: "Unity URP (ShaderLab + HLSL)",
    nameTarget: "unity",
    textureOrigin: "bottom-left",
    mulStyle: "mul-function",
    matrixCtorTakesColumns: false,
    clipZRange: "zero-to-one",
    modIsFloorMod: false,
    scalarCtorSplats: false,
    separateTextureSampler: true,
    intrinsicNames: { mix: "lerp", fract: "frac", inversesqrt: "rsqrt" },
  },
};
