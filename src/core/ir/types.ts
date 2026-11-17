import type { StorageType } from "../types/shaderType";
import type { Space } from "../types/semantics";
import type { Property } from "../properties/model";
import type { Intrinsic } from "./intrinsics";
import type { BuiltinInput } from "./inputs";

/**
 * Kekenik Shader IR — typed SSA-style expression DAG.
 *
 *  - A body (`main` or a function) is an append-only array of expressions; an expression may only reference
 *    LOWER ids, so one forward pass is a valid topological order.
 *  - Expressions are pure and hash-consed by the builder (structural CSE).
 *  - IR types are StorageTypes (color semantics erased; uniforms keep the semantic on the IRUniform).
 *  - Column-vector convention: `matmul(M, v)` is M·v. Matrices are stored column-major in `const` values.
 */
export type ExprId = number;
export type Stage = "vertex" | "fragment" | "light";
export type BackendId = "ir" | "glsl" | "hlsl" | "wgsl" | "godot" | "unity";

export type UnaryOp = "neg" | "not";
export type BinaryOp = "add" | "sub" | "mul" | "div" | "lt" | "le" | "gt" | "ge" | "eq" | "ne" | "and" | "or";
export type SampleMode = "implicit" | "lod" | "grad";
export type DerivKind = "ddx" | "ddy" | "fwidth";
export type FilterMode = "point" | "linear" | "trilinear";
export type WrapMode = "repeat" | "clamp" | "mirror";

export type IRExpr =
  | { op: "const"; ty: StorageType; value: number[] }
  | { op: "param"; ty: StorageType; index: number }
  | { op: "unary"; ty: StorageType; kind: UnaryOp; a: ExprId }
  | { op: "binary"; ty: StorageType; kind: BinaryOp; a: ExprId; b: ExprId }
  | { op: "intrinsic"; ty: StorageType; fn: Intrinsic; args: ExprId[] }
  /** Constructor. Component counts must add up to the type, or a single scalar splats. Matrices take columns. */
  | { op: "construct"; ty: StorageType; args: ExprId[] }
  | { op: "swizzle"; ty: StorageType; src: ExprId; mask: string }
  | { op: "select"; ty: StorageType; cond: ExprId; a: ExprId; b: ExprId }
  /** Scalar cast between float / int / bool. */
  | { op: "cast"; ty: StorageType; src: ExprId }
  | { op: "matmul"; ty: StorageType; a: ExprId; b: ExprId }
  /** `samp` absent → the texture's own sampler. */
  | {
      op: "sample";
      ty: "vec4";
      tex: ExprId;
      samp?: ExprId;
      uv: ExprId;
      mode: SampleMode;
      lod?: ExprId;
      ddx?: ExprId;
      ddy?: ExprId;
    }
  | { op: "samplerState"; ty: "sampler"; filter: FilterMode; wrap: WrapMode }
  /** Size in texels of mip level 0 as a float vec2 (width, height). Legal in every stage. Added by . */
  | { op: "textureSize"; ty: "vec2"; tex: ExprId }
  | { op: "deriv"; ty: StorageType; kind: DerivKind; src: ExprId }
  | { op: "input"; ty: StorageType; input: BuiltinInput; space?: Space }
  | { op: "uniform"; ty: StorageType; prop: string }
  /** Call output `index` of function `fn`. Identical calls are CSE'd; backends should emit one call per (fn,args). */
  | { op: "call"; ty: StorageType; fn: string; args: ExprId[]; index: number }
  | { op: "custom"; ty: StorageType; block: string; args: ExprId[]; index: number }
  /** Engine intrinsic resolved by profile/backend, e.g. "unity.GetMainLight". */
  | { op: "engine"; ty: StorageType; name: string; args: ExprId[] };

export type IROpName = IRExpr["op"];

export interface IRBody {
  exprs: IRExpr[];
}

export interface IRParam {
  name: string;
  ty: StorageType;
}

export interface IRFunction {
  /** Unique id (the subgraph id). */
  id: string;
  /** Human-readable name (sanitised by the backend). */
  name: string;
  params: IRParam[];
  returns: IRParam[];
  body: IRBody;
  /** One expr id per `returns` entry. */
  ret: ExprId[];
  /**
   * Hand-written body (Custom Function node, ): statements in the TARGET language that read the parameters by
   * name and assign every `returns` entry by name. `body` / `ret` are empty for such functions.
   */
  native?: string;
  /** Include path emitted (as `#include "…"`, at global scope) right before this native function — Custom Function file mode. */
  include?: string;
}

export interface IRUniform {
  /** Property id. */
  prop: string;
  ty: StorageType;
  /** Snapshot of the exposed property (naming, ranges, HDR, ...). */
  property: Property;
}

/** Opaque per-backend code block (custom function). */
export interface IRCustomBlock {
  id: string;
  name: string;
  inputs: IRParam[];
  outputs: IRParam[];
  code: Partial<Record<BackendId, string>>;
  /** File mode: include path per backend; the native wrapper is emitted after `#include "<path>"` and calls the external function. */
  include?: Partial<Record<BackendId, string>>;
}

interface IROutput {
  /** Master block name. */
  slot: string;
  value: ExprId;
  stage: Stage;
}

export interface SourceRef {
  nodeId: string;
  portId?: string;
  /** Subgraph id when the node lives inside a subgraph definition. */
  scope?: string;
}

/** Key = `${bodyId}#${exprId}`, bodyId = "main" or a function id. */
export type SourceMap = Record<string, SourceRef>;
export const sourceKey = (bodyId: string, id: ExprId): string => `${bodyId}#${id}`;

export interface IRModule {
  irVersion: 1;
  profileId: string;
  uniforms: IRUniform[];
  customBlocks: IRCustomBlock[];
  /** Callee-first order. */
  functions: IRFunction[];
  main: IRBody;
  outputs: IROutput[];
  sourceMap: SourceMap;
  /**
   * Vertex hoisting : main-body expressions that every backend evaluates in the VERTEX stage and passes to the fragment
   * stage as an interpolator. Set by `applyHoist` (only for expressions proven affine in the interpolated leaves, so the image is unchanged);
   * absent = nothing hoisted. Read by `planStages` — the single place all five backends split stages.
   */
  hoist?: ExprId[];
  /**
   * Reduced precision : main-body expressions the FRAGMENT stage may evaluate in half precision (`half` / `mediump` /
   * `min16float`). Set by `applyPrecision` (core/opt/precision.ts); absent = everything full precision. Backends apply it to the named
   * temporaries they emit; WGSL ignores it (f16 needs `enable f16;` and explicit conversions — Deferred).
   */
  half?: ExprId[];
}

export const MAIN_BODY = "main";
