import type { ExprId, IRExpr, IRModule } from "../ir/types";
import { MAIN_BODY, sourceKey } from "../ir/types";
import { operandsOf } from "../ir/walk";
import { type Range, isBounded, rangeOf } from "./range";

/**
 * Precision inference . Decides which FRAGMENT-stage temporaries may be declared in half precision
 * (`half` / `mediump` / `min16float`) and records them in `IRModule.half`.
 *
 *  - `full` — nothing is demoted (default, bit-exact with earlier versions).
 *  - `auto` — only values with a PROVEN small range (|x| ≤ 64) produced by a "safe" operation class (colour math, masks, unit vectors).
 *  - `half` — every eligible value with a proven range |x| ≤ 2048 (any operation class except the precision-sensitive ones below).
 *
 * Never demoted, in any mode: integers / booleans / matrices / textures, matmul results, UV cones that feed a texture sample (unless
 * `aggressive` = "Mobile-aggressive"), derivative inputs, values whose range is unbounded (positions, accumulating time, raw UVs, unknown
 * uniforms), vertex-stage values and hoisted (interpolated) values. A per-node override can force a node to `half` (the user takes the
 * responsibility; type / op eligibility still applies) or to `float`.
 *
 * This is a HEURISTIC with bounded error, not an exact rewrite — see docs/OPTIMIZATION.md ("Precision").
 */
export type PrecisionMode = "full" | "auto" | "half";
export const PRECISION_MODES: readonly PrecisionMode[] = ["full", "auto", "half"];

export interface PrecisionOptions {
  mode: PrecisionMode;
  /** Graph node ids forced to half (per-node override "Half"). */
  half?: ReadonlySet<string>;
  /** Graph node ids forced to float (per-node override "Float"). */
  float?: ReadonlySet<string>;
  /** Mobile-aggressive: UV cones feeding texture samples may be demoted too. */
  aggressive?: boolean;
}

export interface PrecisionReport {
  mode: PrecisionMode;
  /** Fragment-stage operations that could be demoted at all (eligible type + operation). */
  considered: number;
  demoted: number;
  /** Reasons the remaining considered operations stayed full precision. */
  kept: Record<string, number>;
}

const AUTO_LIMIT = 64;
const HALF_LIMIT = 2048;
/** binary16: largest finite value (11 significant bits). */
export const FP16_MAX = 65504;

const FLOATISH = new Set(["float", "vec2", "vec3", "vec4"]);
/** Operations that never get a declared precision (leaves, calls into functions, matrices, derivatives, casts). */
const NOT_DEMOTABLE = new Set([
  "const",
  "param",
  "input",
  "uniform",
  "samplerState",
  "textureSize",
  "call",
  "custom",
  "engine",
  "matmul",
  "deriv",
  "cast",
]);
/** Intrinsics whose result stays accurate when computed from 11-bit operands (Auto class). */
const SAFE_FNS = new Set([
  "mix",
  "clamp",
  "saturate",
  "min",
  "max",
  "abs",
  "smoothstep",
  "step",
  "sin",
  "cos",
  "dot",
  "normalize",
  "length",
  "sqrt",
  "fract",
  "sign",
]);
const SAFE_BINARY = new Set(["add", "sub", "mul"]);

const isSafeAuto = (e: IRExpr): boolean => {
  switch (e.op) {
    case "binary":
      return SAFE_BINARY.has(e.kind);
    case "intrinsic":
      return SAFE_FNS.has(e.fn);
    case "unary":
    case "select":
    case "construct":
    case "swizzle":
    case "sample":
      return true;
    default:
      return false;
  }
};

/** Range of a leaf under the precision heuristics: property ranges, colour textures, renormalised direction inputs. */
function leafRange(e: IRExpr, m: IRModule): Range | undefined {
  const mk = (lo: number, hi: number): Range => ({ lo, hi, nan: false, int: false, unitLen: false });
  if (e.op === "sample") return mk(0, 16); // colour-texture assumption (HDR up to 16); data textures need a per-node Float override
  if (e.op === "uniform") {
    const p = m.uniforms.find((u) => u.prop === e.prop)?.property;
    if (!p) return undefined;
    if (p.type === "color" || p.type === "color4") return mk(0, p.hdr ? 64 : 1);
    if (
      (p.type === "float" || p.type === "vec2" || p.type === "vec3" || p.type === "vec4") &&
      p.min !== undefined &&
      p.max !== undefined &&
      p.max >= p.min
    )
      return mk(p.min, p.max);
    return undefined;
  }
  if (e.op === "input") {
    if (e.input === "normal" || e.input === "tangent" || e.input === "bitangent" || e.input === "viewDir")
      return mk(-1, 1); // renormalised per pixel
    if (e.input === "vertexColor") return mk(0, 16);
  }
  return undefined;
}

const nodeOf = (m: IRModule, id: ExprId): string | undefined => m.sourceMap[sourceKey(MAIN_BODY, id)]?.nodeId;

/** Select the expressions to demote. Pure; deterministic. */
function planPrecision(m: IRModule, opts: PrecisionOptions): { ids: ExprId[]; report: PrecisionReport } {
  const report: PrecisionReport = { mode: opts.mode, considered: 0, demoted: 0, kept: {} };
  // `full` demotes nothing, except nodes the user forced to Half (per-node override works under every graph mode).
  if (opts.mode === "full" && !(opts.half && opts.half.size > 0)) return { ids: [], report };
  const ex = m.main.exprs;
  const n = ex.length;
  const keep = (why: string): void => void (report.kept[why] = (report.kept[why] ?? 0) + 1);

  // Fragment-stage mask; hoisted expressions are evaluated per vertex (their cone is not part of the fragment stage).
  const hoisted = new Set(m.hoist ?? []);
  const mask = new Uint8Array(n);
  for (const o of m.outputs) if (o.stage === "fragment") mask[o.value] = 1;
  for (let i = n - 1; i >= 0; i--) {
    if (!mask[i] || hoisted.has(i)) continue;
    for (const o of operandsOf(ex[i]!)) mask[o] = 1;
  }

  // Precision-sensitive cones: everything feeding a derivative, and (unless aggressive) the coordinate of a texture sample.
  const sens = new Uint8Array(n); // 1 = derivative cone, 2 = sampling-uv cone
  const mark = (id: ExprId, why: number): void => {
    if (!sens[id]) sens[id] = why;
  };
  for (let i = n - 1; i >= 0; i--) {
    const e = ex[i]!;
    if (mask[i]) {
      if (e.op === "deriv") mark(e.src, 1);
      if (e.op === "intrinsic" && e.fn === "ihash") for (const o of e.args) mark(o, 3); // the hash reads BITS: 11-bit operands would change it
      if (e.op === "sample" && !opts.aggressive)
        for (const o of [e.uv, e.lod, e.ddx, e.ddy]) if (o !== undefined) mark(o, 2);
    }
    // A sample result is data, not a coordinate: the cone stops at the texture read.
    if (sens[i] && e.op !== "sample" && !hoisted.has(i)) for (const o of operandsOf(e)) mark(o, sens[i]!);
  }

  const ranges: Range[] = [];
  const ids: ExprId[] = [];
  for (let i = 0; i < n; i++) {
    const e = ex[i]!;
    ranges[i] = leafRange(e, m) ?? rangeOf(e, (id) => ranges[id]!);
    if (!mask[i] || hoisted.has(i) || NOT_DEMOTABLE.has(e.op) || !FLOATISH.has(e.ty)) continue;
    const node = nodeOf(m, i);
    const forced = node !== undefined && opts.half?.has(node) === true;
    if (opts.mode === "full" && !forced) continue;
    report.considered++;
    if (node && opts.float?.has(node)) {
      keep("override-float");
      continue;
    }
    if (sens[i] === 3) {
      keep("hash-input");
      continue;
    }
    if (!forced) {
      if (sens[i] === 1) {
        keep("derivative-input");
        continue;
      }
      if (sens[i] === 2) {
        keep("sampling-uv");
        continue;
      }
      const r = ranges[i]!;
      if (!isBounded(r)) {
        keep("unbounded");
        continue;
      }
      const limit = opts.mode === "auto" ? AUTO_LIMIT : HALF_LIMIT;
      if (Math.max(Math.abs(r.lo), Math.abs(r.hi)) > limit) {
        keep("range");
        continue;
      }
      if (opts.mode === "auto" && !isSafeAuto(e)) {
        keep("unsafe-op");
        continue;
      }
    }
    ids.push(i);
  }
  report.demoted = ids.length;
  return { ids, report };
}

/** Pure pass: returns `m` with `half` set (or `m` itself when nothing is demoted). Idempotent. */
export function applyPrecision(m: IRModule, opts: PrecisionOptions): { module: IRModule; report: PrecisionReport } {
  const { ids, report } = planPrecision(m, opts);
  if (ids.length === 0) return { module: m, report };
  return { module: { ...m, half: ids }, report };
}

/** Graph setting → mode: `precision` = "half" | "auto" (anything else = full). */
export const precisionModeOf = (settings: Readonly<Record<string, unknown>>): PrecisionMode =>
  settings.precision === "half" ? "half" : settings.precision === "auto" ? "auto" : "full";
