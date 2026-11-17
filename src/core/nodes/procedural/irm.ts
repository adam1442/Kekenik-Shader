import type { IRBuilder } from "../../ir/builder";
import type { Intrinsic } from "../../ir/intrinsics";
import type { ExprId } from "../../ir/types";
import type { StorageType } from "../../types/shaderType";

/**
 * Tiny fluent sugar over the IR builder used by every procedural node .
 * `V` wraps one IR expression; numbers are float literals. Everything compiles to portable IR (no engine intrinsics).
 */
export type Arg = V | number;

export class M {
  /** Procedural hashes use the portable integer hash (`ihash`) instead of the legacy float hashes (see `hashMode.ts`). */
  intHash = false;
  constructor(readonly b: IRBuilder) {}
  w(id: ExprId): V {
    return new V(this, id);
  }
  f(x: number): V {
    return new V(this, this.b.float(x));
  }
  of(a: Arg): V {
    return typeof a === "number" ? this.f(a) : a;
  }
  /** Constant of any float storage type, e.g. `m.k("vec2", 0.5, 0.5)`. */
  k(ty: StorageType, ...vals: number[]): V {
    return this.w(this.b.constOf(ty, vals));
  }
  vec(ty: "vec2" | "vec3" | "vec4", ...parts: Arg[]): V {
    return this.w(
      this.b.construct(
        ty,
        parts.map((p) => this.of(p).id),
      ),
    );
  }
  v2 = (x: Arg, y: Arg): V => this.vec("vec2", x, y);
  v3 = (x: Arg, y: Arg, z: Arg): V => this.vec("vec3", x, y, z);
  v4 = (x: Arg, y: Arg, z: Arg, w: Arg): V => this.vec("vec4", x, y, z, w);
  fn(name: Intrinsic, ...args: Arg[]): V {
    return this.w(
      this.b.intrinsic(
        name,
        args.map((a) => this.of(a).id),
      ),
    );
  }
  /** GLSL-style `step(edge, x)`: 0 where x < edge, otherwise 1. */
  step = (edge: Arg, x: Arg): V => this.fn("step", edge, x);
  min = (a: Arg, b: Arg): V => this.fn("min", a, b);
  max = (a: Arg, b: Arg): V => this.fn("max", a, b);
  sel(cond: V, a: Arg, b: Arg): V {
    return this.w(this.b.select(cond.id, this.of(a).id, this.of(b).id));
  }
  and(a: V, b: V): V {
    return this.w(this.b.binary("and", a.id, b.id));
  }
  /** Division that returns 0 instead of Inf/NaN where the divisor is exactly 0. */
  safeDiv(a: Arg, d: Arg): V {
    const dd = this.of(d);
    return this.sel(dd.ne(0), this.of(a).div(this.sel(dd.ne(0), dd, 1)), 0);
  }
  /** atan2(y, x) that never evaluates the undefined atan2(0, 0): returns 0 there. */
  atan2(y: Arg, x: Arg): V {
    const yy = this.of(y);
    const xx = this.of(x);
    const origin = this.and(yy.eq(0), xx.eq(0));
    return this.fn("atan2", yy, this.sel(origin, 1, xx));
  }
}

export class V {
  constructor(
    readonly m: M,
    readonly id: ExprId,
  ) {}
  get ty(): StorageType {
    return this.m.b.typeOf(this.id);
  }
  private bin(kind: "add" | "sub" | "mul" | "div", o: Arg): V {
    return this.m.w(this.m.b.binary(kind, this.id, this.m.of(o).id));
  }
  add = (o: Arg): V => this.bin("add", o);
  sub = (o: Arg): V => this.bin("sub", o);
  mul = (o: Arg): V => this.bin("mul", o);
  div = (o: Arg): V => this.bin("div", o);
  neg = (): V => this.m.w(this.m.b.unary("neg", this.id));
  private cmp(kind: "lt" | "le" | "gt" | "ge" | "eq" | "ne", o: Arg): V {
    return this.m.w(this.m.b.binary(kind, this.id, this.m.of(o).id));
  }
  lt = (o: Arg): V => this.cmp("lt", o);
  le = (o: Arg): V => this.cmp("le", o);
  gt = (o: Arg): V => this.cmp("gt", o);
  ge = (o: Arg): V => this.cmp("ge", o);
  eq = (o: Arg): V => this.cmp("eq", o);
  ne = (o: Arg): V => this.cmp("ne", o);
  sw = (mask: string): V => this.m.w(this.m.b.swizzle(this.id, mask));
  get x(): V {
    return this.sw("x");
  }
  get y(): V {
    return this.sw("y");
  }
  get z(): V {
    return this.sw("z");
  }
  get w(): V {
    return this.sw("w");
  }
  private f1 = (n: Intrinsic): V => this.m.fn(n, this);
  abs = (): V => this.f1("abs");
  floor = (): V => this.f1("floor");
  fract = (): V => this.f1("fract");
  sqrt = (): V => this.f1("sqrt");
  sin = (): V => this.f1("sin");
  cos = (): V => this.f1("cos");
  saturate = (): V => this.f1("saturate");
  length = (): V => this.f1("length");
  min = (o: Arg): V => this.m.fn("min", this, o);
  max = (o: Arg): V => this.m.fn("max", this, o);
  mod = (o: Arg): V => this.m.fn("mod", this, o);
  pow = (o: Arg): V => this.m.fn("pow", this, o);
  dot = (o: Arg): V => this.m.fn("dot", this, o);
  clamp = (lo: Arg, hi: Arg): V => this.m.fn("clamp", this, lo, hi);
  mix = (b: Arg, t: Arg): V => this.m.fn("mix", this, b, t);
  /** Float → vector of `ty` (splat). */
  splat = (ty: "vec2" | "vec3" | "vec4"): V => this.m.vec(ty, this);
}
