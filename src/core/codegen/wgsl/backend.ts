import { WGSL_IHASH_HELPERS } from "../base/ihashHelpers";
import type { Backend } from "../../compile/backend";
import { BACKEND_TRAITS } from "../../ir/traits";
import type { HelperDef } from "../base/helpers";
import { formatFloat } from "../base/literals";
import { engineExpr } from "../dialect/engine";
import { type TextEmitOptions, singleFileEmit } from "../dialect/emitBackend";
import type { LangPack } from "../dialect/generate";
import type { InputSyntax } from "../dialect/inputs";
import type { DialectOptions } from "../dialect/types";
import { wgslDialect } from "./dialect";
import { WGSL_FRAME_MEMBER, WGSL_NAMES, assembleWgsl } from "./text";

/** Options understood by `wgslBackend.emit` (all optional). */
export type WgslEmitOptions = TextEmitOptions;

const SHAPES: Array<{ id: string; t: string }> = [
  { id: "f32", t: "f32" },
  { id: "vec2", t: "vec2<f32>" },
  { id: "vec3", t: "vec3<f32>" },
  { id: "vec4", t: "vec4<f32>" },
];

/** WGSL has no overloading and `%` truncates: one floor-mod helper per operand shape (`ks_mod_vec3`, `ks_mod_vec3_f32`, …). */
const WGSL_MOD_HELPERS: readonly HelperDef[] = SHAPES.flatMap((s, i): HelperDef[] => [
  {
    id: `ks_mod_${s.id}`,
    code: `${i === 0 ? "// Floor-mod (sign follows y): WGSL % truncates toward zero.\n" : ""}fn ks_mod_${s.id}(x: ${s.t}, y: ${s.t}) -> ${s.t} { return x - y * floor(x / y); }`,
  },
  ...(i === 0
    ? []
    : [
        {
          id: `ks_mod_${s.id}_f32`,
          code: `fn ks_mod_${s.id}_f32(x: ${s.t}, y: f32) -> ${s.t} { return x - y * floor(x / y); }`,
        },
      ]),
]);

/**
 * `ks_rt_*`: identity functions that turn a literal into a RUNTIME value. WGSL evaluates expressions of literals at shader-creation time
 * and rejects non-finite results (`1.0 / 0.0` ⇒ "Float literal is infinite"); GLSL / HLSL yield ±inf at run time .
 */
const WGSL_RT_HELPERS: readonly HelperDef[] = SHAPES.map((s, i): HelperDef => ({
  id: `ks_rt_${s.id}`,
  code: `${i === 0 ? "// Opaque identity: keeps a literal divisor a run-time value (no const-evaluation overflow).\n" : ""}fn ks_rt_${s.id}(x: ${s.t}) -> ${s.t} { return x; }`,
}));

/** Floor-mod helpers + the portable integer hash (O8) + run-time identity helpers. */
const WGSL_HELPERS: readonly HelperDef[] = [...WGSL_MOD_HELPERS, ...WGSL_IHASH_HELPERS, ...WGSL_RT_HELPERS];

const syntax = (o: DialectOptions): InputSyntax => ({
  vec: (n) => `vec${n}<f32>`,
  v3: (a, b, c) => `vec3<f32>(${a}, ${b}, ${c})`,
  v4: (xyz, w) => `vec4<f32>(${xyz}, ${w})`,
  attr: (a) => a,
  uni: (u) => `${WGSL_NAMES.frame}.${WGSL_FRAME_MEMBER[u]}`,
  // Always parenthesised: callers append swizzles (`(M * v).xyz`) and WGSL has no `mul()`.
  mulM4V4: (m, v) => `(${m} * ${v})`,
  mulM3V3: (m, v) => `(${m} * ${v})`,
  mat3: (m) => `mat3x3<f32>(${m}[0].xyz, ${m}[1].xyz, ${m}[2].xyz)`,
  normalize: (x) => `normalize(${x})`,
  cross: (a, b) => `cross(${a}, ${b})`,
  dot: (a, b) => `dot(${a}, ${b})`,
  num: formatFloat,
  faceSign: "select(-1.0f, 1.0f, ks_front_facing)",
  vertexId: "ks_vertex_index",
  instanceId: "ks_instance_index",
  flipUvV: o.flipUvV,
  oneMinus: (x) => `(1.0 - ${x})`,
});

const pack: LangPack = {
  dialect: wgslDialect,
  traits: BACKEND_TRAITS.wgsl,
  target: "wgsl",
  syntax,
  helpers: WGSL_HELPERS,
  reserved: [
    "ks_vertex_index",
    "ks_instance_index",
    "ks_front_facing",
    "VertexInput",
    "VertexOutput",
    "FragmentInput",
    "KsFrame",
    "KsMaterial",
    "vs_in",
    "vs_out",
    "fs_in",
    WGSL_NAMES.vsMain,
    WGSL_NAMES.fsMain,
    WGSL_NAMES.frame,
    WGSL_NAMES.material,
    "main",
  ],
  uniformExpr: (u) =>
    u.kind !== "value"
      ? u.name
      : u.ty === "bool"
        ? `(${WGSL_NAMES.material}.${u.name} != 0u)`
        : `${WGSL_NAMES.material}.${u.name}`,
  engine: engineExpr,
};

const emit = singleFileEmit(pack, "shader.wgsl", "wgsl", assembleWgsl);

/** WGSL (WebGPU) backend. One file `shader.wgsl` with `vs_main` + `fs_main`. */
export const wgslBackend: Backend = { id: "wgsl", traits: BACKEND_TRAITS.wgsl, emit };
