import { HLSL_IHASH_HELPERS } from "../base/ihashHelpers";
import type { Backend } from "../../compile/backend";
import { BACKEND_TRAITS } from "../../ir/traits";
import type { HelperDef } from "../base/helpers";
import { formatFloat } from "../base/literals";
import { engineExpr } from "../dialect/engine";
import { type TextEmitOptions, singleFileEmit } from "../dialect/emitBackend";
import type { LangPack } from "../dialect/generate";
import type { InputSyntax } from "../dialect/inputs";
import type { DialectOptions } from "../dialect/types";
import { hlslDialect } from "./dialect";
import { HLSL_NAMES, assembleHlsl } from "./text";

/** Options understood by `hlslBackend.emit` (all optional). */
export type HlslEmitOptions = TextEmitOptions;

const T = ["float", "float2", "float3", "float4"] as const;

/** `ks_mod` (floor-mod; `fmod` truncates) and `ks_round` (round-half-up; HLSL `round` is half-even). */
const MOD_SRC = [
  ...T.map((t) => `${t} ks_mod(${t} x, ${t} y) { return x - y * floor(x / y); }`),
  ...T.slice(1).map((t) => `${t} ks_mod(${t} x, float y) { return x - y * floor(x / y); }`),
].join("\n");
const ROUND_SRC = T.map((t) => `${t} ks_round(${t} x) { return floor(x + 0.5); }`).join("\n");

export const HLSL_HELPERS: readonly HelperDef[] = [
  { id: "ks_mod", code: `// Floor-mod (sign follows y): HLSL fmod() truncates toward zero.\n${MOD_SRC}` },
  {
    id: "ks_texSize",
    code: "// Texel size of mip 0 (GetDimensions is a statement in HLSL, so it lives in a helper).\nfloat2 ks_texSize(Texture2D t) { uint w; uint h; t.GetDimensions(w, h); return float2(w, h); }",
  },
  {
    id: "ks_round",
    code: `// Round half up: identical on every backend (HLSL round() is round-half-even).\n${ROUND_SRC}`,
  },
  ...HLSL_IHASH_HELPERS,
];

/** Input spelling of the HLSL family (Unity overrides only the host uniforms). */
export const hlslSyntax = (o: DialectOptions): InputSyntax => ({
  vec: (n) => `float${n}`,
  v3: (a, b, c) => `float3(${a}, ${b}, ${c})`,
  v4: (xyz, w) => `float4(${xyz}, ${w})`,
  attr: (a) => a,
  uni: (u) => u,
  mulM4V4: (m, v) => `mul(${m}, ${v})`,
  mulM3V3: (m, v) => `mul(${m}, ${v})`,
  mat3: (m) => `((float3x3)${m})`,
  normalize: (x) => `normalize(${x})`,
  cross: (a, b) => `cross(${a}, ${b})`,
  dot: (a, b) => `dot(${a}, ${b})`,
  num: formatFloat,
  faceSign: "(ks_front_facing ? 1.0 : -1.0)",
  vertexId: "ks_vertex_id",
  instanceId: "ks_instance_id",
  flipUvV: o.flipUvV,
  oneMinus: (x) => `(1.0 - ${x})`,
});

const pack: LangPack = {
  dialect: hlslDialect,
  traits: BACKEND_TRAITS.hlsl,
  target: "hlsl",
  syntax: hlslSyntax,
  helpers: HLSL_HELPERS,
  reserved: [
    "ks_vertex_id",
    "ks_instance_id",
    "ks_front_facing",
    "VSInput",
    "VSOutput",
    "PSInput",
    "VSMain",
    "PSMain",
    "vs_in",
    "vs_out",
    "ps_in",
    "vs_main",
    HLSL_NAMES.frame,
    HLSL_NAMES.material,
    "main",
  ],
  uniformExpr: (u) => u.name,
  engine: engineExpr,
};

const emit = singleFileEmit(pack, "shader.hlsl", "hlsl", assembleHlsl);

/** Generic Direct3D HLSL backend (SM 5.0+). One file `shader.hlsl` with `VSMain` + `PSMain`. Unity-specific output arrives in . */
export const hlslBackend: Backend = { id: "hlsl", traits: BACKEND_TRAITS.hlsl, emit };
