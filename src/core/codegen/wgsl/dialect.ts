import type { IRExpr } from "../../ir/types";
import { isTextureType, type StorageType } from "../../types/shaderType";
import { BACKEND_TRAITS } from "../../ir/traits";
import { formatFloat, formatInt } from "../base/literals";
import { renderCommon } from "../dialect/commonRender";
import { neg, op, plain } from "../dialect/ops";
import { type Dialect, type RenderApi, type Text, UnsupportedError, samplerOf } from "../dialect/types";

/** WGSL spelling of a value type. */
export function wgslType(ty: StorageType): string {
  switch (ty) {
    case "float":
      return "f32";
    case "int":
      return "i32";
    case "bool":
      return "bool";
    case "vec2":
      return "vec2<f32>";
    case "vec3":
      return "vec3<f32>";
    case "vec4":
      return "vec4<f32>";
    case "mat2":
      return "mat2x2<f32>";
    case "mat3":
      return "mat3x3<f32>";
    case "mat4":
      return "mat4x4<f32>";
    case "texture2D":
      return "texture_2d<f32>";
    case "texture2DArray":
      return "texture_2d_array<f32>";
    case "texture3D":
      return "texture_3d<f32>";
    case "textureCube":
      return "texture_cube<f32>";
    case "sampler":
      return "sampler";
  }
}

const F32_MAX = "3.4028235e38";
const isVec = (ty: StorageType): boolean => ty === "vec2" || ty === "vec3" || ty === "vec4";

/** f32 literal. WGSL rejects constant expressions that overflow, so ±Infinity clamp to ±f32::MAX and NaN becomes 0 (with a warning). */
function wgslFloat(v: number, warn: (m: string) => void): string {
  if (Number.isNaN(v)) {
    warn(
      "A NaN constant has no WGSL literal form (WGSL const-evaluation rejects non-finite values): it was replaced by 0.0.",
    );
    return "0.0";
  }
  if (!Number.isFinite(v)) {
    warn(
      "An infinite constant has no WGSL literal form (WGSL const-evaluation rejects non-finite values): it was replaced by ±3.4028235e38.",
    );
    return v > 0 ? F32_MAX : `-${F32_MAX}`;
  }
  return formatFloat(v);
}

function renderConst(ty: StorageType, value: readonly number[], warn: (m: string) => void): Text {
  // Scalar literals carry an explicit `f` suffix: a purely-constant intrinsic call would otherwise stay an abstract-float expression, which WGSL rejects at run time.
  if (ty === "float") return neg(`${wgslFloat(value[0]!, warn)}f`);
  if (ty === "int") return neg(`${formatInt(value[0]!)}i`);
  if (ty === "bool") return plain(value[0] ? "true" : "false");
  const parts = value.map((x) => wgslFloat(x, warn));
  if (!ty.startsWith("mat") && value.every((x) => x === value[0])) return plain(`${wgslType(ty)}(${parts[0]})`);
  return plain(`${wgslType(ty)}(${parts.join(", ")})`); // matrices: column-major, exactly the IR layout
}

function renderIntrinsic(e: Extract<IRExpr, { op: "intrinsic" }>, api: RenderApi): Text {
  const a = e.args.map((x) => api.bare(x));
  const tys = e.args.map((x) => api.ty(x));
  // WGSL has no scalar/vector mixing in min/max/clamp/step/smoothstep (strictIntrinsicShapes): splat the scalar operand first.
  const splat = (i: number): string => (tys[i] === "float" && isVec(e.ty) ? `${wgslType(e.ty)}(${a[i]})` : a[i]!);
  const call = (name: string, args: string[]): Text => plain(`${name}(${args.join(", ")})`);
  const names = BACKEND_TRAITS.wgsl.intrinsicNames;
  switch (e.fn) {
    case "round":
      return call("floor", [`${a[0]} + 0.5`]); // round-half-up, same as every other backend (WGSL round() is half-even)
    case "mod": {
      const t = tys[0] === "float" ? "f32" : tys[0]!;
      const id = tys[1] === tys[0] ? `ks_mod_${t}` : `ks_mod_${t}_f32`;
      api.svc.helpers.need(id);
      return call(id, a);
    }
    case "ihash": {
      const id = `ks_ihash_${tys[0] === "float" ? "f32" : tys[0]}`;
      api.svc.helpers.need(id);
      return call(id, a);
    }
    case "min":
    case "max":
      return call(e.fn, [a[0]!, splat(1)]);
    case "clamp":
      return call("clamp", [a[0]!, splat(1), splat(2)]);
    case "step":
      return call("step", [splat(0), a[1]!]);
    case "smoothstep":
      return call("smoothstep", [splat(0), splat(1), a[2]!]);
    case "dot":
      return tys[0] === "float" ? op(`${a[0]} * ${a[1]}`) : call("dot", a);
    case "normalize":
      return tys[0] === "float" ? call("sign", a) : call("normalize", a);
    case "distance":
      return tys[0] === "float" ? call("abs", [`${a[0]} - ${a[1]}`]) : call("distance", a);
    case "reflect":
    case "refract":
      if (tys[0] === "float")
        throw new UnsupportedError(`${e.fn}() on a scalar has no WGSL form (WGSL requires vector operands)`);
      return call(e.fn, a);
    default:
      return call(names[e.fn] ?? e.fn, a); // saturate, mix (vec,vec,f32 is legal), everything else maps by name
  }
}

/** Text of a literal zero (scalar or splat / vector of zeros), e.g. `0.0f`, `vec3<f32>(0.0f)`. */
const ZERO_LITERAL = /^(?:vec[234]<f32>\()?\(?-?0(?:\.0*)?f?(?:,\s*-?0(?:\.0*)?f?)*\)*$/;

function render(e: IRExpr, api: RenderApi): Text {
  const svc = api.svc;
  switch (e.op) {
    case "const":
      return renderConst(e.ty, e.value, svc.warn);
    case "binary": {
      if (e.kind === "div" && ZERO_LITERAL.test(api.bare(e.b))) {
        // x / 0.0 must not be const-evaluated by the WGSL front end
        const id = `ks_rt_${api.ty(e.b) === "float" ? "f32" : api.ty(e.b)}`;
        api.svc.helpers.need(id);
        return op(`${api.use(e.a)} / ${id}(${api.bare(e.b)})`);
      }
      return renderCommon(e, api);
    }
    case "param":
    case "input":
    case "uniform":
    case "samplerState":
    case "unary":
    case "swizzle":
      return renderCommon(e, api);
    case "intrinsic":
      return renderIntrinsic(e, api);
    case "construct":
      return plain(`${wgslType(e.ty)}(${e.args.map((x) => api.bare(x)).join(", ")})`); // explicit constructor; a lone scalar splats
    case "select":
      return plain(`select(${api.bare(e.b)}, ${api.bare(e.a)}, ${api.bare(e.cond)})`); // select(false_value, true_value, condition)
    case "cast":
      return plain(`${wgslType(e.ty)}(${api.bare(e.src)})`);
    case "matmul":
      return op(`${api.use(e.a)} * ${api.use(e.b)}`);
    case "sample": {
      const tex = api.bare(e.tex);
      const samp = e.samp !== undefined ? api.bare(e.samp) : samplerOf(tex);
      // texture_2d_array takes (coords, array_index): the IR coordinate is vec3 (u, v, layer); the layer rounds to nearest like GLSL / HLSL.
      const arr = api.ty(e.tex) === "texture2DArray";
      const uvt = api.use(e.uv);
      const uv = arr ? `${uvt}.xy, i32(floor(${uvt}.z + 0.5))` : api.bare(e.uv);
      if (e.mode === "lod") return plain(`textureSampleLevel(${tex}, ${samp}, ${uv}, ${api.bare(e.lod!)})`);
      if (e.mode === "grad")
        return plain(`textureSampleGrad(${tex}, ${samp}, ${uv}, ${api.bare(e.ddx!)}, ${api.bare(e.ddy!)})`);
      if (svc.stage === "vertex") {
        // textureSample needs derivatives: not available in the vertex stage.
        svc.warn(
          "Implicit-derivative texture sampling is not available in the WGSL vertex stage: textureSampleLevel(…, 0.0) was used instead.",
        );
        return plain(`textureSampleLevel(${tex}, ${samp}, ${uv}, 0.0)`);
      }
      // The generator never emits non-uniform control flow before a sample (alpha-clip `discard` comes last), so textureSample is always legal.
      return plain(`textureSample(${tex}, ${samp}, ${uv})`);
    }
    case "textureSize":
      return plain(`vec2<f32>(textureDimensions(${api.bare(e.tex)}))`);
    case "deriv": {
      const x = api.bare(e.src);
      if (e.kind === "ddx") return plain(`dpdx(${x})`);
      if (e.kind === "fwidth") return plain(`fwidth(${x})`);
      return svc.options.nativeDerivatives ? plain(`dpdy(${x})`) : op(`-dpdy(${x})`);
    }
    case "call":
      return plain(`${svc.functionName(e.fn)}(${api.callArgs(e.args).join(", ")})`);
    case "custom":
      throw new UnsupportedError(`Custom code block "${e.block}" has no WGSL body`);
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
  isTextureType(p.ty) ? `${p.name}: ${wgslType(p.ty)}, ${samplerOf(p.name)}: sampler` : `${p.name}: ${wgslType(p.ty)}`;

export const wgslDialect: Dialect = {
  lang: "wgsl",
  separateSamplers: true,
  traits: BACKEND_TRAITS.wgsl,
  typeName: wgslType,
  declare: (ty, name, rhs) => `let ${name}: ${wgslType(ty)} = ${rhs};`,
  declareUninit: (ty, name) => `var ${name}: ${wgslType(ty)};`,
  callOuts: (fn, args, outs) => `${fn}(${[...args, ...outs.map((o) => `&${o}`)].join(", ")});`,
  zero: (ty) => `${wgslType(ty)}()`,
  vec4Of: (a, b) => `vec4<f32>(${a}, ${b})`,
  discardIf: (cond) => [`if (${cond}) {`, "    discard;", "}"],
  render,
  writeFunction(w, f, body, rets) {
    const params = f.params.map(paramDecl);
    if (f.returns.length === 1) {
      w.line(`fn ${f.name}(${params.join(", ")}) -> ${wgslType(f.returns[0]!.ty)} {`);
      w.indent().append(body).dedent();
      w.indent().line(`return ${rets[0]};`).dedent().line("}");
    } else {
      const outs = f.returns.map((r) => `${r.name}: ptr<function, ${wgslType(r.ty)}>`);
      w.line(`fn ${f.name}(${[...params, ...outs].join(", ")}) {`);
      w.indent().append(body).dedent();
      f.returns.forEach((r, i) => w.indent().line(`*${r.name} = ${rets[i]};`).dedent());
      w.line("}");
    }
  },
};
