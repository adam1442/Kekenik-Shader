import type { StorageType } from "../types/shaderType";

/**
 * Portable intrinsic enum. Every backend maps these to its own spelling (see BackendTraits.intrinsicNames).
 *
 * Semantics worth pinning down:
 *  - `mod(x, y)` is DEFINED as `x - y * floor(x / y)` (sign follows y; never truncated like HLSL fmod / WGSL `%`).
 *  - `fract(x)` is `x - floor(x)`; `saturate(x)` is `clamp(x, 0, 1)`.
 *  - `atan2(y, x)` takes the y argument first.
 *  - `round` at exact .5 is unspecified (backends may differ).
 */
export type Intrinsic =
  | "sin"
  | "cos"
  | "tan"
  | "asin"
  | "acos"
  | "atan"
  | "atan2"
  | "pow"
  | "exp"
  | "exp2"
  | "log"
  | "log2"
  | "sqrt"
  | "inversesqrt"
  | "abs"
  | "sign"
  | "floor"
  | "ceil"
  | "fract"
  | "round"
  | "trunc"
  | "mod"
  | "min"
  | "max"
  | "clamp"
  | "saturate"
  | "mix"
  | "step"
  | "smoothstep"
  | "radians"
  | "degrees"
  | "dot"
  | "cross"
  | "normalize"
  | "length"
  | "distance"
  | "reflect"
  | "refract"
  /** Portable integer hash (PCG on the float bit pattern): float / vec2 / vec3 / vec4 → float in [0, 1). See `ir/ihash.ts`. , O8. */
  | "ihash";

type IntrinsicKind = "cw" | "hash" | "dot" | "cross" | "normalize" | "length" | "distance" | "reflect" | "refract";

export interface IntrinsicSpec {
  kind: IntrinsicKind;
  arity: number;
  /** Component-wise intrinsics may also be used with int operands. */
  intOk?: boolean;
  /** Argument positions that may be a scalar float while the others are vectors (broadcast). */
  scalarArgs?: number[];
}

const cw = (arity: number, extra: Partial<IntrinsicSpec> = {}): IntrinsicSpec => ({ kind: "cw", arity, ...extra });

export const INTRINSICS: Readonly<Record<Intrinsic, IntrinsicSpec>> = {
  sin: cw(1),
  cos: cw(1),
  tan: cw(1),
  asin: cw(1),
  acos: cw(1),
  atan: cw(1),
  atan2: cw(2),
  pow: cw(2),
  exp: cw(1),
  exp2: cw(1),
  log: cw(1),
  log2: cw(1),
  sqrt: cw(1),
  inversesqrt: cw(1),
  abs: cw(1, { intOk: true }),
  sign: cw(1),
  floor: cw(1),
  ceil: cw(1),
  fract: cw(1),
  round: cw(1),
  trunc: cw(1),
  mod: cw(2, { scalarArgs: [1] }),
  min: cw(2, { intOk: true, scalarArgs: [1] }),
  max: cw(2, { intOk: true, scalarArgs: [1] }),
  clamp: cw(3, { intOk: true, scalarArgs: [1, 2] }),
  saturate: cw(1),
  mix: cw(3, { scalarArgs: [2] }),
  step: cw(2, { scalarArgs: [0] }),
  smoothstep: cw(3, { scalarArgs: [0, 1] }),
  radians: cw(1),
  degrees: cw(1),
  dot: { kind: "dot", arity: 2 },
  cross: { kind: "cross", arity: 2 },
  normalize: { kind: "normalize", arity: 1 },
  length: { kind: "length", arity: 1 },
  distance: { kind: "distance", arity: 2 },
  reflect: { kind: "reflect", arity: 2 },
  refract: { kind: "refract", arity: 3 },
  ihash: { kind: "hash", arity: 1 },
};

export const INTRINSIC_NAMES = Object.keys(INTRINSICS) as Intrinsic[];

const FLOATISH: readonly StorageType[] = ["float", "vec2", "vec3", "vec4"];
const isFloatish = (t: StorageType) => FLOATISH.includes(t);

/** Result type of an intrinsic call, or throws a descriptive Error. */
export function intrinsicResultType(fn: Intrinsic, args: readonly StorageType[]): StorageType {
  const spec = INTRINSICS[fn];
  if (!spec) throw new Error(`Unknown intrinsic "${fn}"`);
  if (args.length !== spec.arity) throw new Error(`${fn}() takes ${spec.arity} argument(s), got ${args.length}`);
  switch (spec.kind) {
    case "cw": {
      const scalarArgs = spec.scalarArgs ?? [];
      const baseIdx = args.findIndex((_, i) => !scalarArgs.includes(i));
      const base = args[baseIdx]!;
      if (!(isFloatish(base) || (spec.intOk && base === "int"))) throw new Error(`${fn}() does not accept ${base}`);
      args.forEach((a, i) => {
        const ok = a === base || (scalarArgs.includes(i) && a === "float");
        if (!ok)
          throw new Error(
            `${fn}() argument ${i + 1} must be ${base}${scalarArgs.includes(i) ? " or float" : ""}, got ${a}`,
          );
      });
      return base;
    }
    case "dot":
    case "distance": {
      const [a, b] = args as [StorageType, StorageType];
      if (!isFloatish(a) || a !== b) throw new Error(`${fn}() needs two equal float vectors, got ${a}, ${b}`);
      return "float";
    }
    case "hash": {
      if (!isFloatish(args[0]!)) throw new Error(`ihash() needs a float / vec2 / vec3 / vec4, got ${args[0]}`);
      return "float";
    }
    case "length": {
      if (!isFloatish(args[0]!)) throw new Error(`length() does not accept ${args[0]}`);
      return "float";
    }
    case "cross": {
      if (args[0] !== "vec3" || args[1] !== "vec3")
        throw new Error(`cross() needs two vec3, got ${args[0]}, ${args[1]}`);
      return "vec3";
    }
    case "normalize": {
      if (!isFloatish(args[0]!)) throw new Error(`normalize() does not accept ${args[0]}`);
      return args[0]!;
    }
    case "reflect":
    case "refract": {
      const [a, b, eta] = args;
      if (!isFloatish(a!) || a !== b) throw new Error(`${fn}() needs two equal float vectors, got ${a}, ${b}`);
      if (spec.kind === "refract" && eta !== "float") throw new Error(`refract() eta must be float, got ${eta}`);
      return a!;
    }
  }
}
