import type { ExprId, IRBody, IRExpr } from "../../ir/types";
import { sourceKey } from "../../ir/types";
import { operandsOf } from "../../ir/walk";
import { isTextureType, type StorageType } from "../../types/shaderType";
import { snakeCase, type Namer } from "../base/names";
import type { CodeWriter } from "../base/writer";
import { type Dialect, type DialectServices, type RenderApi, type Text, UnsupportedError, samplerOf } from "./types";

export interface BodyEmitterOptions {
  dialect: Dialect;
  body: IRBody;
  bodyId: string;
  order: readonly ExprId[];
  uses: ReadonlyMap<ExprId, number>;
  namer: Namer;
  w: CodeWriter;
  /** Names of function parameters (`param` ops). */
  paramNames?: readonly string[];
  /** Expressions read from a varying instead of being evaluated (interpolation hint). */
  overrides?: ReadonlyMap<ExprId, string>;
  svc: DialectServices;
  /** Expressions that may be declared in half precision (`IRModule.half`, fragment stage only). */
  half?: ReadonlySet<ExprId>;
  /** Preview fp16 emulation: half-marked temporaries stay `float` but their value is rounded to binary16 (see `Dialect.quantizeHalf`). */
  emulateHalf?: boolean;
}

const LEAF = new Set(["const", "param", "input", "uniform", "samplerState", "engine"]);
const HEAVY = new Set(["sample", "call", "deriv", "custom", "textureSize"]);
/** Inline-size budget of an expression before it gets its own named temporary. */
const COST_LIMIT = 7;

/**
 * Emits the statements of one IR body in one stage. One policy for every language (so GLSL, WGSL and HLSL read alike):
 * leaves are inlined, values used more than once / heavy operations / large trees get a named temporary (named after the
 * originating node), everything else is inlined into its single consumer. All spelling is delegated to the `Dialect`.
 */
export class BodyEmitter {
  private names = new Map<ExprId, string>();
  private texts = new Map<ExprId, Text>();
  private cost = new Map<ExprId, number>();
  private callGroups = new Map<string, string[]>();
  private readonly api: RenderApi;

  constructor(private readonly o: BodyEmitterOptions) {
    this.api = {
      use: (id) => this.use(id),
      bare: (id) => this.bare(id),
      ty: (id) => this.e(id).ty,
      param: (i) => this.o.paramNames?.[i] ?? `p${i}`,
      callArgs: (args) => this.callArgs(args),
      svc: o.svc,
    };
  }

  private e(id: ExprId): IRExpr {
    return this.o.body.exprs[id]!;
  }

  use(id: ExprId): string {
    const x = this.textOf(id);
    return x.wrap ? `(${x.t})` : x.t;
  }

  bare(id: ExprId): string {
    return this.textOf(id).t;
  }

  /** Call arguments: where samplers are separate objects, a texture travels together with its sampler. */
  callArgs(args: readonly ExprId[]): string[] {
    const out: string[] = [];
    for (const a of args) {
      const t = this.bare(a);
      const d = this.o.dialect;
      if (d.separateSamplers && isTextureType(this.e(a).ty)) {
        const samp = d.samplerName ? d.samplerName(t) : samplerOf(t);
        out.push(...(d.textureArgs ? d.textureArgs(t, samp, this.e(a).ty) : [t, samp]));
      } else out.push(t);
    }
    return out;
  }

  private textOf(id: ExprId): Text {
    const named = this.names.get(id);
    if (named !== undefined) return { t: named, wrap: false };
    const hit = this.texts.get(id);
    if (hit) return hit;
    const override = this.o.overrides?.get(id);
    const x = override !== undefined ? { t: override, wrap: false } : this.render(id);
    this.texts.set(id, x);
    return x;
  }

  /** Render with unsupported-construct recovery: a typed zero placeholder + a node-level diagnostic. */
  private render(id: ExprId): Text {
    const e = this.e(id);
    try {
      return this.o.dialect.render(e, this.api);
    } catch (err) {
      if (!(err instanceof UnsupportedError)) throw err;
      this.o.svc.unsupported(err.message, this.o.bodyId, id);
      const ty = e.ty as StorageType;
      return { t: isTextureType(ty) || ty === "sampler" ? "0" : this.o.dialect.zero(ty), wrap: false };
    }
  }

  private isLeaf(id: ExprId): boolean {
    return LEAF.has(this.e(id).op) || this.o.overrides?.has(id) === true;
  }

  private costOf(id: ExprId): number {
    if (this.names.has(id) || this.isLeaf(id)) return 1;
    return this.cost.get(id) ?? 1;
  }

  private nameFor(id: ExprId, fallback: string): string {
    const ref = this.o.svc.sourceMap[sourceKey(this.o.bodyId, id)];
    const label = ref ? this.o.svc.labels?.get(ref.nodeId) : undefined;
    const base = label ? snakeCase(label) || fallback : fallback;
    return this.o.namer.fresh(base, "t");
  }

  /** Write the declaration of every expression that deserves a name. */
  emitStatements(): void {
    const pairs = this.o.dialect.sincos ? this.sincosPairs() : new Map<ExprId, { sin: ExprId; cos: ExprId }>();
    for (const id of this.o.order) {
      const e = this.e(id);
      if (this.isLeaf(id) || this.names.has(id)) continue;
      const pair = pairs.get(id);
      if (pair) {
        this.emitSincos(pair);
        continue;
      }
      if (e.op === "call" && this.emitCallGroup(id, e)) continue;
      const cost = 1 + operandsOf(e).reduce((s, o) => s + this.costOf(o), 0);
      this.cost.set(id, cost);
      const uses = this.o.uses.get(id) ?? 0;
      const trivial = e.op === "swizzle" && (this.isLeaf(e.src) || this.names.has(e.src));
      if (trivial || !(uses > 1 || HEAVY.has(e.op) || cost > COST_LIMIT)) continue;
      const name = this.nameFor(id, `t${id}`);
      const rhs = this.render(id).t;
      this.o.w.line(this.declareText(id, e.ty, name, rhs), this.o.svc.sourceMap[sourceKey(this.o.bodyId, id)]);
      this.names.set(id, name);
    }
  }

  /** `sin(x)` / `cos(x)` pairs over the same operand and type that are both emitted (keyed by whichever comes first in emission order). */
  private sincosPairs(): Map<ExprId, { sin: ExprId; cos: ExprId }> {
    const seen = new Map<string, { sin?: ExprId; cos?: ExprId }>();
    const inOrder = new Set(this.o.order);
    for (const id of this.o.order) {
      const e = this.e(id);
      if (
        e.op !== "intrinsic" ||
        (e.fn !== "sin" && e.fn !== "cos") ||
        e.args.length !== 1 ||
        this.o.half?.has(id) ||
        this.isLeaf(id)
      )
        continue;
      const k = `${e.args[0]}:${e.ty}`;
      const rec = seen.get(k) ?? {};
      rec[e.fn] ??= id;
      seen.set(k, rec);
    }
    const out = new Map<ExprId, { sin: ExprId; cos: ExprId }>();
    for (const rec of seen.values()) {
      if (rec.sin === undefined || rec.cos === undefined || !inOrder.has(rec.sin) || !inOrder.has(rec.cos)) continue;
      out.set(Math.min(rec.sin, rec.cos), { sin: rec.sin, cos: rec.cos });
    }
    return out;
  }

  private emitSincos(p: { sin: ExprId; cos: ExprId }): void {
    const d = this.o.dialect;
    const sinE = this.e(p.sin) as Extract<IRExpr, { op: "intrinsic" }>;
    const sName = this.nameFor(p.sin, `t${p.sin}`);
    const cName = this.nameFor(p.cos, `t${p.cos}`);
    const ref = this.o.svc.sourceMap[sourceKey(this.o.bodyId, p.sin)];
    this.o.w.line(d.declareUninit(sinE.ty as StorageType, sName), ref);
    this.o.w.line(d.declareUninit(sinE.ty as StorageType, cName), ref);
    this.o.w.line(d.callOuts("sincos", [this.bare(sinE.args[0]!)], [sName, cName]), ref);
    this.names.set(p.sin, sName);
    this.names.set(p.cos, cName);
  }

  /** `T name = rhs;`, in half precision (or emulated binary16) when the precision pass marked the expression. */
  private declareText(id: ExprId, ty: StorageType, name: string, rhs: string): string {
    const d = this.o.dialect;
    if (this.o.half?.has(id)) {
      if (this.o.emulateHalf) {
        const q = d.quantizeHalf?.(ty, rhs, this.o.svc.helpers);
        if (q !== undefined) return d.declare(ty, name, q);
      } else {
        const h = d.halfType?.(ty);
        if (h !== undefined) return `${h} ${name} = ${rhs};`;
      }
    }
    return d.declare(ty, name, rhs);
  }

  /** Multi-output calls become one statement with output temporaries. Returns true when `id` was handled. */
  private emitCallGroup(id: ExprId, e: Extract<IRExpr, { op: "call" }>): boolean {
    const svc = this.o.svc;
    const types = svc.functionReturns(e.fn);
    if (types.length === 1) return false;
    const key = `${e.fn}(${e.args.join(",")})`;
    let names = this.callGroups.get(key);
    if (!names) {
      const made: string[] = [];
      const base = this.nameFor(id, svc.functionName(e.fn));
      const ref = svc.sourceMap[sourceKey(this.o.bodyId, id)];
      types.forEach((ty, i) => {
        const nm = this.o.namer.fresh(`${base}_out${i}`, "t");
        made.push(nm);
        this.o.w.line(this.o.dialect.declareUninit(ty, nm), ref);
      });
      this.o.w.line(this.o.dialect.callOuts(svc.functionName(e.fn), this.callArgs(e.args), made), ref);
      this.callGroups.set(key, made);
      names = made;
    }
    this.names.set(id, names[e.index]!);
    return true;
  }
}
