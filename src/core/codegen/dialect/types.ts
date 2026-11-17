import type { BackendTraits } from "../../ir/traits";
import type { ExprId, IRExpr, SourceMap, Stage } from "../../ir/types";
import type { StorageType } from "../../types/shaderType";
import type { HelperRegistry } from "../base/helpers";
import type { CodeWriter } from "../base/writer";

/**
 * Shared machinery of every text backend (GLSL, WGSL, HLSL; Unity / Godot reuse it in ).
 * The scheduling policy (what gets a named temporary) lives in `emitter.ts`; everything that is spelled differently per
 * language lives in a `Dialect`.
 */

/** Rendered expression text; `wrap` = unparenthesised operator expression (needs parentheses as an operand). */
export interface Text {
  t: string;
  wrap: boolean;
}

/** Thrown by a dialect when an IR construct has no spelling in the language; surfaced as `E_NODE_UNSUPPORTED_TARGET` on the node. */
export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedError";
  }
}

export interface DialectOptions {
  /** Emit native `ddy` (D3D / WebGPU: pixel Y grows downward) instead of negating it to the canonical (GLSL, "up") sign. */
  nativeDerivatives: boolean;
  /** v' = 1 - v for every mesh UV input (use when textures are uploaded top-left AND the mesh UVs follow the canonical bottom-left origin). */
  flipUvV: boolean;
  /** Negate clip-space Y at the vertex output (render targets sampled with a flipped Y). */
  flipClipY: boolean;
}

export const DEFAULT_DIALECT_OPTIONS: DialectOptions = { nativeDerivatives: false, flipUvV: false, flipClipY: false };

/** What the surrounding stage provides to the emitter (names, inputs, uniforms, helpers, diagnostics). */
export interface DialectServices {
  traits: BackendTraits;
  stage: Stage;
  helpers: HelperRegistry;
  sourceMap: SourceMap;
  labels?: ReadonlyMap<string, string> | undefined;
  inputText(e: Extract<IRExpr, { op: "input" }>): string;
  uniformText(prop: string): string;
  functionName(id: string): string;
  functionReturns(id: string): readonly StorageType[];
  /** `engine` op: the expression text, or throws UnsupportedError. */
  engineText(name: string, args?: readonly string[]): string;
  /** Inline sampler (`samplerState` op): registers a static sampler binding and returns its identifier. */
  samplerStateText(e: Extract<IRExpr, { op: "samplerState" }>): string;
  warn(message: string): void;
  /** Record an unsupported construct (node-level diagnostic); generation continues with a placeholder. */
  unsupported(message: string, bodyId: string, id: ExprId): void;
  options: DialectOptions;
}

/** Callbacks a dialect uses while rendering one expression. */
export interface RenderApi {
  /** Operand form: parenthesised when needed. */
  use(id: ExprId): string;
  /** Right-hand-side / argument form. */
  bare(id: ExprId): string;
  ty(id: ExprId): StorageType;
  /** Identifier of function parameter `index`. */
  param(index: number): string;
  /** Arguments of a call; texture arguments expand to `tex, tex_sampler`. */
  callArgs(args: readonly ExprId[]): string[];
  svc: DialectServices;
}

interface FunctionSig {
  name: string;
  params: Array<{ name: string; ty: StorageType }>;
  returns: Array<{ name: string; ty: StorageType }>;
}

/** One language's spelling rules. */
export interface Dialect {
  lang: "glsl" | "hlsl" | "wgsl";
  traits: BackendTraits;
  /** Textures travel together with a separate sampler object (`tex, tex_sampler`); false for GLSL's combined `sampler2D`. */
  separateSamplers: boolean;
  /** Name of the sampler object that belongs to a texture expression (default `<tex>_sampler`). Unity binds `sampler<Texture>` for material textures. */
  samplerName?(texture: string): string;
  /** Call-site spelling of a texture + sampler pair (default `tex, sampler`). Unity: `TEXTURE2D_ARGS(tex, sampler)`. */
  textureArgs?(texture: string, sampler: string, ty?: StorageType): string[];
  /** Spelling of a value type (texture / sampler are binding / parameter types: see `writeFunction`). */
  typeName(ty: StorageType): string;
  /** Statement declaring an immutable temporary. */
  declare(ty: StorageType, name: string, rhs: string): string;
  /** Reduced-precision spelling of a value type (`half3`, `mediump vec3`, `min16float3`), or undefined when the type has none. Absent = the language has no half (WGSL without f16). */
  halfType?(ty: StorageType): string | undefined;
  /** Preview fp16 emulation: wraps `rhs` so the value is rounded to the nearest binary16 number (GLSL only: `packHalf2x16` / `unpackHalf2x16`). */
  quantizeHalf?(ty: StorageType, rhs: string, helpers: HelperRegistry): string | undefined;
  /** HLSL: `sin(x)` and `cos(x)` of the same operand are emitted as ONE `sincos(x, s, c)` statement . */
  sincos?: boolean;
  /** Statement declaring an uninitialised temporary (receives an output of a multi-return function). */
  declareUninit(ty: StorageType, name: string): string;
  /** Statement calling a multi-return function: ordinary args + output temporaries. */
  callOuts(fn: string, args: readonly string[], outs: readonly string[]): string;
  /** Typed zero value (placeholder for unsupported constructs). */
  zero(ty: StorageType): string;
  /** `vec4(a, b)` where a is a vec3 and b a float. */
  vec4Of(a: string, b: string): string;
  /** Statement(s) discarding the fragment when `cond` holds. */
  discardIf(cond: string): string[];
  /** Render one expression (the emitter handles naming / materialisation). */
  render(e: IRExpr, api: RenderApi): Text;
  /** Write a complete function definition. `body` holds the statements, `rets` the return expression texts. */
  writeFunction(w: CodeWriter, f: FunctionSig, body: CodeWriter, rets: readonly string[]): void;
}

/** Convention shared by the explicit backends: the sampler that belongs to a texture expression. */
export const samplerOf = (texture: string): string => `${texture}_sampler`;
