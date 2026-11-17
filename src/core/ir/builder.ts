import {
  type StorageType,
  componentCount,
  floatVecOfSize,
  isTextureType,
  matrixDim,
  sampleCoordType,
  sampleGradType,
} from "../types/shaderType";
import type { Space } from "../types/semantics";
import { type Intrinsic, intrinsicResultType } from "./intrinsics";
import { type BuiltinInput, builtinInputType, resolveInputSpace } from "./inputs";
import {
  type BinaryOp,
  type DerivKind,
  type ExprId,
  type FilterMode,
  type IRBody,
  type IRCustomBlock,
  type IRExpr,
  type IRParam,
  type SampleMode,
  type SourceMap,
  type SourceRef,
  type UnaryOp,
  type WrapMode,
  sourceKey,
} from "./types";

export class IRBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IRBuildError";
  }
}

interface FunctionSig {
  params: IRParam[];
  returns: IRParam[];
}

/** Registry of callable signatures shared by all builders of one module. */
export interface BuilderEnv {
  functions: Map<string, FunctionSig>;
  customBlocks: Map<string, IRCustomBlock>;
  sourceMap: SourceMap;
}

export const createBuilderEnv = (): BuilderEnv => ({ functions: new Map(), customBlocks: new Map(), sourceMap: {} });

const SWIZZLE_INDEX: Record<string, number> = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 };
const NUMERIC_TYPES: readonly StorageType[] = ["float", "int", "vec2", "vec3", "vec4"];
const isVec = (t: StorageType) => t === "vec2" || t === "vec3" || t === "vec4";

/** Builds one IR body (main or a function) with structural CSE and type checking. */
export class IRBuilder {
  readonly body: IRBody = { exprs: [] };
  private intern = new Map<string, ExprId>();
  private source: SourceRef | undefined;

  constructor(
    readonly bodyId: string,
    readonly env: BuilderEnv,
  ) {}

  /** Attribute every newly created expression to this graph node/port (null clears). */
  setSource(ref: SourceRef | null): void {
    this.source = ref ?? undefined;
  }

  /** Current source attribution (see {@link setSource}); used by cone cloning to restore it. */
  getSource(): SourceRef | undefined {
    return this.source;
  }

  typeOf(id: ExprId): StorageType {
    const e = this.body.exprs[id];
    if (!e) throw new IRBuildError(`Expression %${id} does not exist`);
    return e.ty;
  }

  private emit(e: IRExpr): ExprId {
    const key = JSON.stringify(e);
    const hit = this.intern.get(key);
    if (hit !== undefined) return hit;
    const id = this.body.exprs.length;
    this.body.exprs.push(e);
    this.intern.set(key, id);
    if (this.source) this.env.sourceMap[sourceKey(this.bodyId, id)] = this.source;
    return id;
  }

  // ---- leaves -----------------------------------------------------------------------------------
  /** Constant; `value.length` must equal the component count (matrices: column-major). */
  constOf(ty: StorageType, value: readonly number[]): ExprId {
    const n = componentCount(ty);
    if (n === 0) throw new IRBuildError(`Cannot create a constant of type ${ty}`);
    if (value.length !== n) throw new IRBuildError(`Constant of type ${ty} needs ${n} values, got ${value.length}`);
    return this.emit({ op: "const", ty, value: value.map((v) => (Object.is(v, -0) ? 0 : v)) });
  }
  float(v: number): ExprId {
    return this.constOf("float", [v]);
  }
  int(v: number): ExprId {
    return this.constOf("int", [Math.trunc(v)]);
  }
  bool(v: boolean): ExprId {
    return this.constOf("bool", [v ? 1 : 0]);
  }
  param(index: number, ty: StorageType): ExprId {
    return this.emit({ op: "param", ty, index });
  }
  input(input: BuiltinInput, space?: Space): ExprId {
    let s: Space | undefined;
    try {
      s = resolveInputSpace(input, space);
    } catch (e) {
      throw new IRBuildError((e as Error).message);
    }
    const e: IRExpr = { op: "input", ty: builtinInputType(input, s), input };
    if (s) e.space = s;
    return this.emit(e);
  }
  uniform(prop: string, ty: StorageType): ExprId {
    return this.emit({ op: "uniform", ty, prop });
  }
  samplerState(filter: FilterMode, wrap: WrapMode): ExprId {
    return this.emit({ op: "samplerState", ty: "sampler", filter, wrap });
  }

  // ---- arithmetic -------------------------------------------------------------------------------
  unary(kind: UnaryOp, a: ExprId): ExprId {
    const t = this.typeOf(a);
    if (kind === "not" ? t !== "bool" : !NUMERIC_TYPES.includes(t))
      throw new IRBuildError(`${kind} does not accept ${t}`);
    return this.emit({ op: "unary", ty: t, kind, a });
  }

  binary(kind: BinaryOp, a: ExprId, b: ExprId): ExprId {
    const ta = this.typeOf(a);
    const tb = this.typeOf(b);
    const fail = (): never => {
      throw new IRBuildError(`${kind}(${ta}, ${tb}) is not a valid operation`);
    };
    let ty: StorageType;
    if (kind === "and" || kind === "or") {
      if (ta !== "bool" || tb !== "bool") fail();
      ty = "bool";
    } else if (kind === "lt" || kind === "le" || kind === "gt" || kind === "ge" || kind === "eq" || kind === "ne") {
      const scalar = ta === "float" || ta === "int" || (ta === "bool" && (kind === "eq" || kind === "ne"));
      if (!scalar || ta !== tb) fail();
      ty = "bool";
    } else {
      if (!NUMERIC_TYPES.includes(ta) || !NUMERIC_TYPES.includes(tb)) fail();
      if (ta === tb) ty = ta;
      else if (isVec(ta) && tb === "float") ty = ta;
      else if (ta === "float" && isVec(tb)) ty = tb;
      else return fail();
    }
    return this.emit({ op: "binary", ty, kind, a, b });
  }
  add = (a: ExprId, b: ExprId) => this.binary("add", a, b);
  sub = (a: ExprId, b: ExprId) => this.binary("sub", a, b);
  mul = (a: ExprId, b: ExprId) => this.binary("mul", a, b);
  div = (a: ExprId, b: ExprId) => this.binary("div", a, b);

  intrinsic(fn: Intrinsic, args: readonly ExprId[]): ExprId {
    let ty: StorageType;
    try {
      ty = intrinsicResultType(
        fn,
        args.map((a) => this.typeOf(a)),
      );
    } catch (e) {
      throw new IRBuildError((e as Error).message);
    }
    return this.emit({ op: "intrinsic", ty, fn, args: [...args] });
  }

  // ---- shape ------------------------------------------------------------------------------------
  construct(ty: StorageType, args: readonly ExprId[]): ExprId {
    const n = componentCount(ty);
    const dim = matrixDim(ty);
    if (!isVec(ty) && !dim) throw new IRBuildError(`Cannot construct ${ty}`);
    const types = args.map((a) => this.typeOf(a));
    if (dim) {
      const col = floatVecOfSize(dim);
      if (types.length !== dim || types.some((t) => t !== col))
        throw new IRBuildError(`${ty} needs ${dim} ${col} columns`);
    } else {
      if (types.some((t) => t !== "float" && !isVec(t)))
        throw new IRBuildError(`${ty} constructor takes float/vector arguments, got ${types.join(", ")}`);
      const total = types.reduce((s, t) => s + componentCount(t), 0);
      const splat = types.length === 1 && types[0] === "float";
      if (total !== n && !splat) throw new IRBuildError(`${ty} constructor needs ${n} components, got ${total}`);
    }
    return this.emit({ op: "construct", ty, args: [...args] });
  }

  swizzle(src: ExprId, mask: string): ExprId {
    const t = this.typeOf(src);
    if (!isVec(t)) throw new IRBuildError(`Cannot swizzle ${t}`);
    if (mask.length < 1 || mask.length > 4) throw new IRBuildError(`Bad swizzle mask "${mask}"`);
    const canon = mask
      .split("")
      .map((c) => {
        const i = SWIZZLE_INDEX[c];
        if (i === undefined) throw new IRBuildError(`Bad swizzle component "${c}"`);
        if (i >= componentCount(t)) throw new IRBuildError(`Swizzle "${mask}" is out of range for ${t}`);
        return "xyzw"[i]!;
      })
      .join("");
    return this.emit({ op: "swizzle", ty: floatVecOfSize(canon.length), src, mask: canon });
  }

  select(cond: ExprId, a: ExprId, b: ExprId): ExprId {
    if (this.typeOf(cond) !== "bool") throw new IRBuildError("select condition must be bool");
    const ta = this.typeOf(a);
    if (ta !== this.typeOf(b)) throw new IRBuildError(`select branches differ: ${ta} vs ${this.typeOf(b)}`);
    return this.emit({ op: "select", ty: ta, cond, a, b });
  }

  cast(src: ExprId, ty: StorageType): ExprId {
    const from = this.typeOf(src);
    const scalar = (t: StorageType) => t === "float" || t === "int" || t === "bool";
    if (!scalar(from) || !scalar(ty)) throw new IRBuildError(`cast is only defined between scalars (${from} → ${ty})`);
    return from === ty ? src : this.emit({ op: "cast", ty, src });
  }

  matmul(a: ExprId, b: ExprId): ExprId {
    const ta = this.typeOf(a);
    const tb = this.typeOf(b);
    const d = matrixDim(ta);
    if (!d) throw new IRBuildError(`matmul left operand must be a matrix, got ${ta}`);
    if (tb !== floatVecOfSize(d) && tb !== ta) throw new IRBuildError(`matmul(${ta}, ${tb}) is not valid`);
    return this.emit({ op: "matmul", ty: tb, a, b });
  }

  // ---- textures / derivatives ---------------------------------------------------------------------
  /**
   * Texture fetch. The coordinate type follows the texture kind: `texture2D` → vec2, `texture2DArray` → vec3 (u, v, layer),
   * `texture3D` → vec3 (u, v, w), `textureCube` → vec3 (direction). Gradients: vec2 (2D / array) or vec3 (3D / cube).
   */
  sample(p: {
    tex: ExprId;
    samp?: ExprId;
    uv: ExprId;
    mode: SampleMode;
    lod?: ExprId;
    ddx?: ExprId;
    ddy?: ExprId;
  }): ExprId {
    const texTy = this.typeOf(p.tex);
    if (!isTextureType(texTy))
      throw new IRBuildError("sample: tex must be a texture (texture2D / texture2DArray / texture3D / textureCube)");
    const coord = sampleCoordType(texTy);
    const grad = sampleGradType(texTy);
    if (p.samp !== undefined && this.typeOf(p.samp) !== "sampler")
      throw new IRBuildError("sample: samp must be sampler");
    if (this.typeOf(p.uv) !== coord) throw new IRBuildError(`sample: uv must be ${coord} for ${texTy}`);
    if (p.mode === "lod" && (p.lod === undefined || this.typeOf(p.lod) !== "float"))
      throw new IRBuildError("sample(lod) needs a float lod");
    if (
      p.mode === "grad" &&
      (p.ddx === undefined || p.ddy === undefined || this.typeOf(p.ddx) !== grad || this.typeOf(p.ddy) !== grad)
    )
      throw new IRBuildError(`sample(grad) needs ${grad} ddx and ddy`);
    const e: IRExpr = { op: "sample", ty: "vec4", tex: p.tex, uv: p.uv, mode: p.mode };
    if (p.samp !== undefined) e.samp = p.samp;
    if (p.mode === "lod") e.lod = p.lod!;
    if (p.mode === "grad") {
      e.ddx = p.ddx!;
      e.ddy = p.ddy!;
    }
    return this.emit(e);
  }

  /** Texel size of mip level 0 of a texture as vec2 (width, height). */
  textureSize(tex: ExprId): ExprId {
    if (this.typeOf(tex) !== "texture2D")
      throw new IRBuildError("textureSize: tex must be texture2D (not defined for array / 3D / cube textures)");
    return this.emit({ op: "textureSize", ty: "vec2", tex });
  }

  deriv(kind: DerivKind, src: ExprId): ExprId {
    const t = this.typeOf(src);
    if (t !== "float" && !isVec(t)) throw new IRBuildError(`${kind} does not accept ${t}`);
    return this.emit({ op: "deriv", ty: t, kind, src });
  }

  // ---- functions / custom / engine ----------------------------------------------------------------
  call(fn: string, args: readonly ExprId[], index = 0): ExprId {
    const sig = this.env.functions.get(fn);
    if (!sig) throw new IRBuildError(`Call to undefined function "${fn}"`);
    this.checkArgs(`function ${fn}`, sig.params, args);
    const ret = sig.returns[index];
    if (!ret) throw new IRBuildError(`Function ${fn} has no output ${index}`);
    return this.emit({ op: "call", ty: ret.ty, fn, args: [...args], index });
  }

  custom(block: string, args: readonly ExprId[], index = 0): ExprId {
    const def = this.env.customBlocks.get(block);
    if (!def) throw new IRBuildError(`Unknown custom block "${block}"`);
    this.checkArgs(`custom block ${block}`, def.inputs, args);
    const out = def.outputs[index];
    if (!out) throw new IRBuildError(`Custom block ${block} has no output ${index}`);
    return this.emit({ op: "custom", ty: out.ty, block, args: [...args], index });
  }

  engine(name: string, ty: StorageType, args: readonly ExprId[] = []): ExprId {
    return this.emit({ op: "engine", ty, name, args: [...args] });
  }

  private checkArgs(what: string, params: readonly IRParam[], args: readonly ExprId[]): void {
    if (params.length !== args.length)
      throw new IRBuildError(`${what} takes ${params.length} argument(s), got ${args.length}`);
    params.forEach((p, i) => {
      const t = this.typeOf(args[i]!);
      if (t !== p.ty) throw new IRBuildError(`${what}: argument "${p.name}" expects ${p.ty}, got ${t}`);
    });
  }
}
