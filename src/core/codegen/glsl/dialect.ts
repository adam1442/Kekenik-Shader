import type { IRExpr } from "../../ir/types";
import { BACKEND_TRAITS } from "../../ir/traits";
import { componentCount, type StorageType } from "../../types/shaderType";
import { helperName, intrinsicEmit } from "../base/intrinsicMap";
import { formatConst } from "../base/literals";
import { cStyleStatements, cStyleWriteFunction } from "../dialect/cstyle";
import { renderCommon } from "../dialect/commonRender";
import { neg, op, plain } from "../dialect/ops";
import { type Dialect, type RenderApi, type Text, UnsupportedError } from "../dialect/types";
import { GLSL_CTOR, glslType } from "./types";

function renderIntrinsic(e: Extract<IRExpr, { op: "intrinsic" }>, api: RenderApi): Text {
  const args = e.args.map((a) => api.bare(a));
  const how = intrinsicEmit(BACKEND_TRAITS.glsl, e.fn);
  if (how.kind === "helper") {
    const id = helperName(how.id, e.fn, componentCount(api.ty(e.args[0]!)));
    api.svc.helpers.need(id);
    return plain(`${id}(${args.join(", ")})`);
  }
  if (how.kind === "inline") return plain(`clamp(${args[0]}, 0.0, 1.0)`); // saturate
  return plain(`${how.name}(${args.join(", ")})`);
}

/** Optional behaviours of the GLSL dialect (the default dialect, used by Godot's wrapper, has none). */
export interface GlslDialectOptions {
  /** Texture uniform identifier → property id of its hidden `vec4` Tiling / Offset (`_ST`) uniform: `uv * st.xy + st.zw`, same as Unity / Godot. */
  tiling?: ReadonlyMap<string, string>;
  /** The preview applies Sampler State nodes to the bound texture object itself, so the "cannot be expressed" warning is not raised. */
  previewSampler?: boolean;
}

const FLOATISH = new Set<StorageType>(["float", "vec2", "vec3", "vec4"]);
/** Round to binary16 and back: `ks_q1..4` helpers (GLSL ES 3.00 `packHalf2x16` / `unpackHalf2x16`). */
const quantizeHalf: NonNullable<Dialect["quantizeHalf"]> = (ty, rhs, helpers) =>
  FLOATISH.has(ty)
    ? `${helpers.need(`ks_q${ty === "float" ? 1 : ty === "vec2" ? 2 : ty === "vec3" ? 3 : 4}`)}(${rhs})`
    : undefined;

function render(e: IRExpr, api: RenderApi, o: GlslDialectOptions): Text {
  const svc = api.svc;
  const list = (ids: readonly number[]): string => ids.map((a) => api.bare(a)).join(", ");
  switch (e.op) {
    case "const":
      return neg(formatConst(e.ty, e.value, GLSL_CTOR));
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
    case "construct":
      return plain(`${glslType(e.ty)}(${list(e.args)})`);
    case "select":
      return op(`${api.use(e.cond)} ? ${api.use(e.a)} : ${api.use(e.b)}`);
    case "cast":
      return plain(`${glslType(e.ty)}(${api.bare(e.src)})`);
    case "matmul":
      return op(`${api.use(e.a)} * ${api.use(e.b)}`);
    case "sample": {
      if (e.samp !== undefined && !o.previewSampler)
        svc.warn(
          "Inline sampler state cannot be expressed with a combined sampler2D in GLSL: filtering/wrapping come from the texture object set by the host.",
        );
      const tex = api.bare(e.tex);
      let uv = api.bare(e.uv);
      const stProp = o.tiling?.get(tex);
      if (stProp !== undefined) {
        const st = svc.uniformText(stProp);
        uv = `(${uv}) * ${st}.xy + ${st}.zw`;
      }
      if (e.mode === "implicit") return plain(`texture(${tex}, ${uv})`);
      if (e.mode === "lod") return plain(`textureLod(${tex}, ${uv}, ${api.bare(e.lod!)})`);
      return plain(`textureGrad(${tex}, ${uv}, ${api.bare(e.ddx!)}, ${api.bare(e.ddy!)})`);
    }
    case "textureSize":
      return plain(`vec2(textureSize(${api.bare(e.tex)}, 0))`);
    case "deriv":
      return plain(`${e.kind === "ddx" ? "dFdx" : e.kind === "ddy" ? "dFdy" : "fwidth"}(${api.bare(e.src)})`);
    case "call":
      return plain(`${svc.functionName(e.fn)}(${api.callArgs(e.args).join(", ")})`);
    case "custom":
      throw new UnsupportedError(`Custom code block "${e.block}" has no GLSL body`);
    case "engine":
      return plain(
        svc.engineText(
          e.name,
          e.args.map((a) => api.bare(a)),
        ),
      );
  }
}

/** Typed zero (placeholder for unsupported constructs). */
const zero = (ty: StorageType): string =>
  ty === "float" ? "0.0" : ty === "int" ? "0" : ty === "bool" ? "false" : `${glslType(ty)}(0.0)`;

/** GLSL ES 3.00 (WebGL2): the reference spelling — every IR construct maps 1:1, so nothing is ever adapted. */
export const makeGlslDialect = (o: GlslDialectOptions = {}): Dialect => ({
  lang: "glsl",
  separateSamplers: false,
  traits: BACKEND_TRAITS.glsl,
  typeName: glslType,
  halfType: (ty) => (FLOATISH.has(ty) ? `mediump ${glslType(ty)}` : undefined),
  quantizeHalf,
  ...cStyleStatements(glslType),
  zero,
  vec4Of: (a, b) => `vec4(${a}, ${b})`,
  render: (e, api) => render(e, api, o),
  writeFunction: cStyleWriteFunction(glslType, (p) => `${glslType(p.ty)} ${p.name}`),
});

export const glslDialect: Dialect = makeGlslDialect();
