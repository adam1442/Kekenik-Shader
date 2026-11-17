import type { IRExpr } from "../../ir/types";
import { componentCount, isTextureType, type StorageType } from "../../types/shaderType";
import { formatFloat, formatInt } from "../base/literals";
import { helperName, intrinsicEmit } from "../base/intrinsicMap";
import { BACKEND_TRAITS } from "../../ir/traits";
import { cStyleStatements, cStyleWriteFunction } from "../dialect/cstyle";
import { renderCommon } from "../dialect/commonRender";
import { neg, op, plain } from "../dialect/ops";
import { type Dialect, type RenderApi, type Text, UnsupportedError, samplerOf } from "../dialect/types";

/** HLSL (Direct3D, Shader Model 5.0+) spelling of a value type. */
export function hlslType(ty: StorageType): string {
  switch (ty) {
    case "float":
    case "int":
    case "bool":
      return ty;
    case "vec2":
      return "float2";
    case "vec3":
      return "float3";
    case "vec4":
      return "float4";
    case "mat2":
      return "float2x2";
    case "mat3":
      return "float3x3";
    case "mat4":
      return "float4x4";
    case "texture2D":
      return "Texture2D";
    case "texture2DArray":
      return "Texture2DArray";
    case "texture3D":
      return "Texture3D";
    case "textureCube":
      return "TextureCube";
    case "sampler":
      return "SamplerState";
  }
}

const dim = (ty: StorageType): number => (ty === "vec2" ? 2 : ty === "vec3" ? 3 : ty === "vec4" ? 4 : 1);
const matDim = (ty: StorageType): number => (ty === "mat2" ? 2 : ty === "mat3" ? 3 : 4);

/** Float literal; non-finite values use `asfloat` bit patterns (constant division by zero is an error in HLSL compilers). */
function hlslFloat(v: number): string {
  if (Number.isNaN(v)) return "asfloat(0x7fc00000)";
  if (v === Infinity) return "asfloat(0x7f800000)";
  if (v === -Infinity) return "asfloat(0xff800000)";
  return formatFloat(v);
}

function renderConst(ty: StorageType, value: readonly number[]): Text {
  if (ty === "float") return neg(hlslFloat(value[0]!));
  if (ty === "int") return neg(formatInt(value[0]!));
  if (ty === "bool") return { t: value[0] ? "true" : "false", wrap: false };
  if (ty.startsWith("mat")) {
    const n = matDim(ty);
    const rows: string[] = []; // HLSL matrix constructors take ROWS; the IR stores columns
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) rows.push(hlslFloat(value[c * n + r]!));
    return { t: `${hlslType(ty)}(${rows.join(", ")})`, wrap: false };
  }
  return { t: `${hlslType(ty)}(${value.map(hlslFloat).join(", ")})`, wrap: false };
}

function renderIntrinsic(e: Extract<IRExpr, { op: "intrinsic" }>, api: RenderApi): Text {
  const args = e.args.map((a) => api.bare(a));
  const argTy = api.ty(e.args[0]!);
  switch (e.fn) {
    case "saturate":
      return plain(`saturate(${args[0]})`);
    // HLSL sign() returns int / intN: cast back to the float type.
    case "sign":
      return plain(`((${hlslType(e.ty)})sign(${args[0]}))`);
    case "normalize":
      if (argTy === "float") return plain(`((float)sign(${args[0]}))`);
      break;
    case "distance":
      if (argTy === "float") return plain(`abs(${args[0]} - ${args[1]})`);
      break;
    case "reflect":
    case "refract":
      if (argTy === "float") throw new UnsupportedError(`${e.fn}() on a scalar has no HLSL form`);
      break;
    default:
      break;
  }
  const how = intrinsicEmit(BACKEND_TRAITS.hlsl, e.fn);
  if (how.kind === "helper") {
    const id = helperName(how.id, e.fn, componentCount(argTy));
    api.svc.helpers.need(id);
    return plain(`${id}(${args.join(", ")})`);
  }
  if (how.kind === "inline") return plain(`saturate(${args[0]})`);
  return plain(`${how.name}(${args.join(", ")})`);
}

function render(e: IRExpr, api: RenderApi): Text {
  const svc = api.svc;
  switch (e.op) {
    case "const":
      return renderConst(e.ty, e.value);
    case "param":
    case "input":
    case "uniform":
    case "samplerState":
    case "unary":
    case "binary":
    case "swizzle":
      return renderCommon(e, api);
    case "intrinsic":
      return renderIntrinsic(e, api);
    case "construct": {
      if (e.ty.startsWith("mat"))
        return plain(`transpose(${hlslType(e.ty)}(${e.args.map((a) => api.bare(a)).join(", ")}))`);
      const single = e.args.length === 1 && dim(api.ty(e.args[0]!)) === 1 && dim(e.ty) > 1;
      if (single) return plain(`((${hlslType(e.ty)})${api.use(e.args[0]!)})`); // scalar → vector: explicit splat
      return plain(`${hlslType(e.ty)}(${e.args.map((a) => api.bare(a)).join(", ")})`);
    }
    case "select":
      return op(`${api.use(e.cond)} ? ${api.use(e.a)} : ${api.use(e.b)}`);
    case "cast":
      return plain(`((${hlslType(e.ty)})${api.use(e.src)})`);
    case "matmul":
      return plain(`mul(${api.bare(e.a)}, ${api.bare(e.b)})`);
    case "sample": {
      const tex = api.use(e.tex);
      const samp = e.samp !== undefined ? api.bare(e.samp) : samplerOf(api.bare(e.tex));
      const uv = api.bare(e.uv);
      if (e.mode === "implicit") return plain(`${tex}.Sample(${samp}, ${uv})`);
      if (e.mode === "lod") return plain(`${tex}.SampleLevel(${samp}, ${uv}, ${api.bare(e.lod!)})`);
      return plain(`${tex}.SampleGrad(${samp}, ${uv}, ${api.bare(e.ddx!)}, ${api.bare(e.ddy!)})`);
    }
    case "textureSize":
      return plain(`${svc.helpers.need("ks_texSize")}(${api.bare(e.tex)})`);
    case "deriv": {
      const x = api.bare(e.src);
      if (e.kind === "ddx") return plain(`ddx(${x})`);
      if (e.kind === "fwidth") return plain(`fwidth(${x})`);
      // D3D pixel Y grows downward, the canonical (GLSL) ddy points up: negate unless the native sign was requested.
      return svc.options.nativeDerivatives ? plain(`ddy(${x})`) : op(`-ddy(${x})`);
    }
    case "call":
      return plain(`${svc.functionName(e.fn)}(${api.callArgs(e.args).join(", ")})`);
    case "custom":
      throw new UnsupportedError(`Custom code block "${e.block}" has no HLSL body`);
    case "engine":
      return plain(
        svc.engineText(
          e.name,
          e.args.map((a) => api.bare(a)),
        ),
      );
  }
}

const paramDecl = (p: { name: string; ty: StorageType }): string =>
  isTextureType(p.ty)
    ? `${hlslType(p.ty)} ${p.name}, SamplerState ${samplerOf(p.name)}`
    : `${hlslType(p.ty)} ${p.name}`;

export const hlslDialect: Dialect = {
  lang: "hlsl",
  separateSamplers: true,
  traits: BACKEND_TRAITS.hlsl,
  typeName: hlslType,
  halfType: (ty) =>
    ty === "float"
      ? "min16float"
      : ty === "vec2"
        ? "min16float2"
        : ty === "vec3"
          ? "min16float3"
          : ty === "vec4"
            ? "min16float4"
            : undefined,
  sincos: true,
  ...cStyleStatements(hlslType),
  zero: (ty) => `((${hlslType(ty)})0)`,
  vec4Of: (a, b) => `float4(${a}, ${b})`,
  render,
  writeFunction: cStyleWriteFunction(hlslType, paramDecl),
};
