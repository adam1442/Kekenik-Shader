import { ihash } from "./ihash";
import { componentCount, matrixDim } from "../types/shaderType";
import type { Space } from "../types/semantics";
import { INTRINSICS, type Intrinsic } from "./intrinsics";
import type { BuiltinInput } from "./inputs";
import type { ExprId, IRBody, IRExpr, IRModule } from "./types";

/**
 * Reference CPU evaluator for the IR. It defines the *meaning* of every IR operation that does not need a
 * GPU (so `mod` negative semantics, swizzles, constructors, matmul … are executable & testable) and is the
 * future basis for constant folding. Values are flat `number[]` (bool = 0/1, matrices column-major).
 */
export type Value = number[];

/** Arguments of a texture fetch handed to `EvalEnv.sample` (texture / sampler are the evaluated operand values). */
interface EvalSample {
  tex: Value;
  samp?: Value;
  uv: Value;
  mode: "implicit" | "lod" | "grad";
  lod?: number;
  ddx?: Value;
  ddy?: Value;
}

export interface EvalEnv {
  input?: (input: BuiltinInput, space?: Space) => Value;
  uniform?: (prop: string) => Value;
  /** Optional texture provider (tests): without it `sample` / `textureSize` are not evaluable. Added by . */
  sample?: (s: EvalSample) => Value;
  textureSize?: (tex: Value) => Value;
  /** Optional engine-intrinsic provider (tests of engine-dependent nodes, ): without it `engine` ops are not evaluable. */
  engine?: (name: string, args: Value[]) => Value;
}

const cwArg = (v: Value, i: number): number => (v.length === 1 ? v[0]! : v[i]!);

function cwIntrinsic(fn: Intrinsic, args: Value[]): Value {
  const n = Math.max(...args.map((a) => a.length));
  const out: Value = [];
  for (let i = 0; i < n; i++) {
    const x = cwArg(args[0]!, i);
    const y = args[1] ? cwArg(args[1], i) : 0;
    const z = args[2] ? cwArg(args[2], i) : 0;
    let r: number;
    switch (fn) {
      case "sin":
        r = Math.sin(x);
        break;
      case "cos":
        r = Math.cos(x);
        break;
      case "tan":
        r = Math.tan(x);
        break;
      case "asin":
        r = Math.asin(x);
        break;
      case "acos":
        r = Math.acos(x);
        break;
      case "atan":
        r = Math.atan(x);
        break;
      case "atan2":
        r = Math.atan2(x, y);
        break;
      case "pow":
        r = Math.pow(x, y);
        break;
      case "exp":
        r = Math.exp(x);
        break;
      case "exp2":
        r = Math.pow(2, x);
        break;
      case "log":
        r = Math.log(x);
        break;
      case "log2":
        r = Math.log2(x);
        break;
      case "sqrt":
        r = Math.sqrt(x);
        break;
      case "inversesqrt":
        r = 1 / Math.sqrt(x);
        break;
      case "abs":
        r = Math.abs(x);
        break;
      case "sign":
        r = Math.sign(x);
        break;
      case "floor":
        r = Math.floor(x);
        break;
      case "ceil":
        r = Math.ceil(x);
        break;
      case "fract":
        r = x - Math.floor(x);
        break;
      case "round":
        r = Math.round(x);
        break;
      case "trunc":
        r = Math.trunc(x);
        break;
      case "mod":
        r = x - y * Math.floor(x / y);
        break; // defined semantics: sign follows y
      case "min":
        r = Math.min(x, y);
        break;
      case "max":
        r = Math.max(x, y);
        break;
      case "clamp":
        r = Math.min(Math.max(x, y), z);
        break;
      case "saturate":
        r = Math.min(Math.max(x, 0), 1);
        break;
      case "mix":
        r = x * (1 - z) + y * z;
        break;
      case "step":
        r = y < x ? 0 : 1;
        break;
      case "smoothstep": {
        const t = Math.min(Math.max((z - x) / (y - x), 0), 1);
        r = t * t * (3 - 2 * t);
        break;
      }
      case "radians":
        r = (x * Math.PI) / 180;
        break;
      case "degrees":
        r = (x * 180) / Math.PI;
        break;
      default:
        throw new Error(`Not component-wise: ${fn}`);
    }
    out.push(r);
  }
  return out;
}

const dot = (a: Value, b: Value) => a.reduce((s, v, i) => s + v * b[i]!, 0);

function vectorIntrinsic(fn: Intrinsic, a: Value[]): Value {
  const [x, y, z] = a as [Value, Value, Value];
  switch (fn) {
    case "dot":
      return [dot(x, y)];
    case "length":
      return [Math.sqrt(dot(x, x))];
    case "distance":
      return [
        Math.sqrt(
          dot(
            x.map((v, i) => v - y[i]!),
            x.map((v, i) => v - y[i]!),
          ),
        ),
      ];
    case "normalize": {
      const l = Math.sqrt(dot(x, x));
      return x.map((v) => v / l);
    }
    case "cross":
      return [x[1]! * y[2]! - x[2]! * y[1]!, x[2]! * y[0]! - x[0]! * y[2]!, x[0]! * y[1]! - x[1]! * y[0]!];
    case "reflect": {
      const d = 2 * dot(y, x);
      return x.map((v, i) => v - d * y[i]!);
    }
    case "refract": {
      const eta = z[0]!;
      const d = dot(y, x);
      const k = 1 - eta * eta * (1 - d * d);
      return k < 0 ? x.map(() => 0) : x.map((v, i) => eta * v - (eta * d + Math.sqrt(k)) * y[i]!);
    }
    default:
      throw new Error(`Not a vector intrinsic: ${fn}`);
  }
}

function evalBinary(kind: string, a: Value, b: Value): Value {
  const n = Math.max(a.length, b.length);
  const out: Value = [];
  for (let i = 0; i < n; i++) {
    const x = cwArg(a, i);
    const y = cwArg(b, i);
    switch (kind) {
      case "add":
        out.push(x + y);
        break;
      case "sub":
        out.push(x - y);
        break;
      case "mul":
        out.push(x * y);
        break;
      case "div":
        out.push(x / y);
        break;
      case "lt":
        out.push(x < y ? 1 : 0);
        break;
      case "le":
        out.push(x <= y ? 1 : 0);
        break;
      case "gt":
        out.push(x > y ? 1 : 0);
        break;
      case "ge":
        out.push(x >= y ? 1 : 0);
        break;
      case "eq":
        out.push(x === y ? 1 : 0);
        break;
      case "ne":
        out.push(x !== y ? 1 : 0);
        break;
      case "and":
        out.push(x && y ? 1 : 0);
        break;
      case "or":
        out.push(x || y ? 1 : 0);
        break;
      default:
        throw new Error(`Unknown binary op ${kind}`);
    }
  }
  return out;
}

function evalMatmul(a: Value, b: Value): Value {
  const n = Math.round(Math.sqrt(a.length));
  const cols = b.length / n;
  const out: Value = [];
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < n; r++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += a[k * n + r]! * b[c * n + k]!;
      out.push(s);
    }
  return out;
}

class Evaluator {
  private memo = new Map<ExprId, Value>();
  constructor(
    private body: IRBody,
    private module: IRModule,
    private env: EvalEnv,
    private params: Value[],
  ) {}

  get(id: ExprId): Value {
    const hit = this.memo.get(id);
    if (hit) return hit;
    const v = this.compute(this.body.exprs[id]!);
    this.memo.set(id, v);
    return v;
  }

  private compute(e: IRExpr): Value {
    const g = (id: ExprId) => this.get(id);
    switch (e.op) {
      case "const":
        return [...e.value];
      case "param":
        return this.params[e.index]!;
      case "unary":
        return e.kind === "neg" ? g(e.a).map((v) => -v) : g(e.a).map((v) => (v ? 0 : 1));
      case "binary":
        return evalBinary(e.kind, g(e.a), g(e.b));
      case "intrinsic": {
        const args = e.args.map(g);
        const k = INTRINSICS[e.fn].kind;
        return k === "cw" ? cwIntrinsic(e.fn, args) : k === "hash" ? [ihash(args[0]!)] : vectorIntrinsic(e.fn, args);
      }
      case "construct": {
        const parts = e.args.map(g);
        const n = componentCount(e.ty);
        if (parts.length === 1 && parts[0]!.length === 1 && !matrixDim(e.ty))
          return new Array<number>(n).fill(parts[0]![0]!);
        return parts.flat();
      }
      case "swizzle": {
        const s = g(e.src);
        return e.mask.split("").map((c) => s["xyzw".indexOf(c)]!);
      }
      case "select":
        return g(e.cond)[0] ? g(e.a) : g(e.b);
      case "cast": {
        const v = g(e.src)[0]!;
        return [e.ty === "bool" ? (v ? 1 : 0) : e.ty === "int" ? Math.trunc(v) : v];
      }
      case "matmul":
        return evalMatmul(g(e.a), g(e.b));
      case "deriv":
        return g(e.src).map(() => 0);
      case "input":
        if (!this.env.input) throw new Error(`No input provider for "${e.input}"`);
        return this.env.input(e.input, e.space);
      case "uniform":
        if (!this.env.uniform) throw new Error(`No uniform provider for "${e.prop}"`);
        return this.env.uniform(e.prop);
      case "call": {
        const fn = this.module.functions.find((f) => f.id === e.fn);
        if (!fn) throw new Error(`Undefined function ${e.fn}`);
        const sub = new Evaluator(fn.body, this.module, this.env, e.args.map(g));
        return sub.get(fn.ret[e.index]!);
      }
      case "sample": {
        if (!this.env.sample)
          throw new Error('The reference evaluator cannot evaluate "sample" without an EvalEnv.sample provider');
        const s: EvalSample = { tex: g(e.tex), uv: g(e.uv), mode: e.mode };
        if (e.samp !== undefined) s.samp = g(e.samp);
        if (e.lod !== undefined) s.lod = g(e.lod)[0]!;
        if (e.ddx !== undefined) s.ddx = g(e.ddx);
        if (e.ddy !== undefined) s.ddy = g(e.ddy);
        return this.env.sample(s);
      }
      case "textureSize":
        if (!this.env.textureSize)
          throw new Error(
            'The reference evaluator cannot evaluate "textureSize" without an EvalEnv.textureSize provider',
          );
        return this.env.textureSize(g(e.tex));
      case "engine":
        if (this.env.engine)
          return this.env.engine(
            e.name,
            e.args.map((a) => g(a)),
          );
        throw new Error(
          `The reference evaluator cannot evaluate engine intrinsic "${e.name}" without an EvalEnv.engine provider`,
        );
      case "samplerState":
      case "custom":
        throw new Error(`The reference evaluator cannot evaluate "${e.op}"`);
    }
  }
}

/** Evaluate one expression of the main body. */
export function evalExpr(module: IRModule, id: ExprId, env: EvalEnv = {}): Value {
  return new Evaluator(module.main, module, env, []).get(id);
}

/** Evaluate every module output → map slot → value. */
export function evalOutputs(module: IRModule, env: EvalEnv = {}): Record<string, Value> {
  const ev = new Evaluator(module.main, module, env, []);
  const out: Record<string, Value> = {};
  for (const o of module.outputs) out[o.slot] = ev.get(o.value);
  return out;
}
