import { type PackPlan, packInterpolators } from "../opt/packInterpolators";
import { builtinInputType } from "../ir/inputs";
import type { ExprId, IRBody, IRExpr, IRModule, Stage } from "../ir/types";
import { MAIN_BODY, sourceKey } from "../ir/types";
import { operandsOf, reachableMask } from "../ir/walk";
import { VARYING_INPUTS, fragmentView } from "../opt/hoist";
import { componentCount, isOpaque, isTextureType } from "../types/shaderType";

/**
 * Cost model v2 . Units are "ALU-equivalent cycles per pixel/vertex" for a scalar lane. They are RELATIVE weights
 * (documented below), NOT measured GPU times: a texture sample costs `sample` ALU on this class, and so on. The Mobile class models
 * tile-based mobile GPUs (cheap-ish MAD, expensive special-function / texture / derivative units).
 */
export type CostClass = "desktop" | "mobile";

export interface CostTable {
  /** Per scalar component. */
  intrinsic: Readonly<Record<string, number>>;
  /** Component-wise fallback for intrinsics missing from `intrinsic`. */
  intrinsicDefault: number;
  add: number;
  mul: number;
  div: number;
  unary: number;
  select: number;
  cast: number;
  swizzle: number;
  construct: number;
  /** Per matrix column-dot (matmul of an n-vector costs n·n·matmul). */
  matmul: number;
  sample: number;
  /** Extra cost of a DEPENDENT texture read (uv computed from another sample) — defeats prefetch on mobile. */
  dependentRead: number;
  /** Extra for explicit-LOD / gradient variants. */
  sampleLod: number;
  sampleGrad: number;
  deriv: number;
  engine: number;
  custom: number;
  /** Multiplier of the ALU cost of an operation evaluated in half precision (texture samples / derivatives keep their weight). */
  half: number;
}

const TRANSC = {
  sin: 4,
  cos: 4,
  tan: 6,
  asin: 6,
  acos: 6,
  atan: 6,
  atan2: 8,
  pow: 5,
  exp: 3,
  exp2: 2,
  log: 3,
  log2: 2,
};
const COMMON = {
  abs: 0.5,
  sign: 1,
  floor: 1,
  ceil: 1,
  fract: 1,
  round: 1,
  trunc: 1,
  min: 1,
  max: 1,
  clamp: 2,
  saturate: 0.5,
  mix: 2,
  step: 1,
  smoothstep: 4,
  radians: 1,
  degrees: 1,
  dot: 1,
  cross: 3,
  normalize: 4,
  length: 3,
  distance: 4,
  reflect: 4,
  refract: 8,
  // Integer hash (O8): ~2 PCG rounds of 8 integer ops for the typical 2–3 component lattice point.
  ihash: 14,
};
export const COST_TABLES: Readonly<Record<CostClass, CostTable>> = {
  desktop: {
    intrinsic: { ...TRANSC, ...COMMON, sqrt: 2, inversesqrt: 1, mod: 3 },
    intrinsicDefault: 2,
    add: 1,
    mul: 1,
    div: 4,
    unary: 0.5,
    select: 1,
    cast: 0.25,
    swizzle: 0.25,
    construct: 0.25,
    matmul: 1,
    sample: 4,
    dependentRead: 4,
    sampleLod: 0.5,
    sampleGrad: 2,
    deriv: 2,
    engine: 4,
    custom: 10,
    half: 0.85,
  },
  mobile: {
    // Transcendentals run on a quarter-rate special-function unit; mod is floor + divide; samples and derivatives are expensive.
    intrinsic: {
      ...Object.fromEntries(Object.entries(TRANSC).map(([k, v]) => [k, v * 2])),
      ...COMMON,
      sqrt: 4,
      inversesqrt: 2,
      mod: 6,
      normalize: 6,
      length: 4,
      distance: 5,
      smoothstep: 5,
      ihash: 18,
    },
    intrinsicDefault: 3,
    add: 1,
    mul: 1,
    div: 8,
    unary: 0.5,
    select: 1.5,
    cast: 0.5,
    swizzle: 0.25,
    construct: 0.5,
    matmul: 1,
    sample: 8,
    dependentRead: 12,
    sampleLod: 1,
    sampleGrad: 4,
    deriv: 4,
    engine: 6,
    custom: 14,
    half: 0.5,
  },
};

const FREE_OPS = new Set(["const", "param", "input", "uniform", "samplerState", "textureSize"]);

/** Cost of ONE expression (excluding operands). `callee` supplies the already-computed cost of a called function. */
export function exprAlu(e: IRExpr, t: CostTable, callee: (fn: string) => number): number {
  const n = Math.max(1, componentCount(e.ty));
  switch (e.op) {
    case "binary":
      return (e.kind === "div" ? t.div : e.kind === "mul" ? t.mul : t.add) * (e.ty === "bool" ? 1 : n);
    case "unary":
      return t.unary * n;
    case "intrinsic": {
      const per = t.intrinsic[e.fn] ?? t.intrinsicDefault;
      return per * (["dot", "length", "distance", "normalize", "cross"].includes(e.fn) ? 1 : n);
    }
    case "select":
      return t.select * n;
    case "matmul":
      return t.matmul * n * n;
    case "deriv":
      return t.deriv * n;
    case "call":
      return callee(e.fn);
    case "custom":
      return t.custom;
    case "engine":
      return t.engine;
    case "construct":
      return t.construct;
    case "swizzle":
      return t.swizzle;
    case "cast":
      return t.cast;
    case "sample":
      return t.sample + (e.mode === "lod" ? t.sampleLod : e.mode === "grad" ? t.sampleGrad : 0);
    default:
      return FREE_OPS.has(e.op) ? 0 : 1;
  }
}

interface StageCost {
  /** Weighted ALU-equivalent cost (texture samples included at their weight). */
  cost: number;
  /** Pure ALU part (no samples). */
  alu: number;
  samples: number;
  dependentReads: number;
  derivatives: number;
  /** Peak number of simultaneously live values, in vec4 registers (estimate over emission order). */
  registers: number;
}
interface NodeCost {
  cost: number;
  samples: number;
  exprs: number; /**
   * Repetition factor: the highest number of structurally identical NON-TRIVIAL operations (cost ≥ 2) the node owns — a cone cloned
   * by Height To Normal ("×5 sin") or unrolled FBM octaves. 1 when nothing repeats. The UI shows a "×N" badge from 3.
   */
  copies: number;
}
export interface CostReport {
  cls: CostClass;
  fragment: StageCost;
  vertex: StageCost;
  interpolators: { scalars: number; vec4Slots: number; unpackedSlots: number; pack: PackPlan };
  uniformSlots: number;
  textures: number;
  perNode: Record<string, NodeCost>;
  total: number;
}

/** Which expressions of `body` depend (transitively) on a texture sample. */
export function sampleDependence(body: IRBody): Uint8Array {
  const dep = new Uint8Array(body.exprs.length);
  body.exprs.forEach((e, i) => {
    if (e.op === "sample") dep[i] = 1;
    else
      for (const o of operandsOf(e))
        if (dep[o]) {
          dep[i] = 1;
          break;
        }
  });
  return dep;
}

function peakRegisters(body: IRBody, mask: Uint8Array, roots: readonly ExprId[], half?: ReadonlySet<ExprId>): number {
  const n = body.exprs.length;
  const last = new Int32Array(n).fill(-1);
  body.exprs.forEach((e, i) => {
    if (mask[i]) for (const o of operandsOf(e)) last[o] = Math.max(last[o]!, i);
  });
  for (const r of roots) last[r] = n;
  let live = 0;
  let peak = 0;
  const ends: number[][] = Array.from({ length: n + 1 }, () => []);
  body.exprs.forEach((e, i) => {
    if (!mask[i]) return;
    if (!FREE_OPS.has(e.op) || e.op === "input") {
      const w = Math.max(1, componentCount(e.ty)) * (half?.has(i) ? 0.5 : 1);
      live += w;
      ends[Math.min(n, Math.max(i, last[i]!))]!.push(w);
    }
    peak = Math.max(peak, live);
    for (const w of ends[i]!) live -= w;
  });
  return Math.ceil(peak / 4);
}

function stageCost(
  m: IRModule,
  roots: readonly ExprId[],
  t: CostTable,
  fn: (id: string) => StageCost,
  perNode: Record<string, NodeCost> | undefined,
  shapes?: Map<string, Map<string, number>>,
): StageCost {
  const mask = reachableMask(m.main, roots);
  const dep = sampleDependence(m.main);
  const half = m.half && m.half.length > 0 ? new Set(m.half) : undefined;
  const s: StageCost = { cost: 0, alu: 0, samples: 0, dependentReads: 0, derivatives: 0, registers: 0 };
  m.main.exprs.forEach((e, i) => {
    if (!mask[i]) return;
    let c = exprAlu(e, t, (id) => fn(id).cost);
    if (half?.has(i) && e.op !== "sample" && e.op !== "deriv" && e.op !== "call") c *= t.half;
    let samples = 0;
    if (e.op === "sample") {
      samples = 1;
      if ([e.uv, e.lod, e.ddx, e.ddy].some((o) => o !== undefined && dep[o])) {
        c += t.dependentRead;
        s.dependentReads++;
      }
      s.samples++;
    } else if (e.op === "call") {
      const f = fn(e.fn);
      s.samples += f.samples;
      s.derivatives += f.derivatives;
      s.dependentReads += f.dependentReads;
      samples = f.samples;
    } else {
      s.alu += c;
    }
    if (e.op === "deriv") s.derivatives++;
    s.cost += c;
    const ref = perNode ? m.sourceMap[sourceKey(MAIN_BODY, i)] : undefined;
    if (perNode && ref && c > 0) {
      const nc = (perNode[ref.nodeId] ??= { cost: 0, samples: 0, exprs: 0, copies: 1 });
      nc.cost += c;
      nc.samples += samples;
      nc.exprs++;
      if (shapes && c >= 2) {
        const per = shapes.get(ref.nodeId) ?? new Map<string, number>();
        shapes.set(ref.nodeId, per);
        const key = `${e.op}|${e.op === "intrinsic" ? e.fn : e.op === "binary" ? e.kind : ""}|${e.ty}|${ref.portId ?? ""}`;
        const count = (per.get(key) ?? 0) + 1;
        per.set(key, count);
        nc.copies = Math.max(nc.copies, count);
      }
    }
  });
  s.registers = peakRegisters(m.main, mask, roots, half);
  s.cost = Math.round(s.cost * 10) / 10;
  s.alu = Math.round(s.alu * 10) / 10;
  return s;
}

/** Cost model v2 of a compiled module for a GPU class. Pure, target independent (per-target facts live in the emitted text). */
export function costModule(m: IRModule, cls: CostClass = "desktop"): CostReport {
  const t = COST_TABLES[cls];
  const fnById = new Map(m.functions.map((f) => [f.id, f]));
  const memo = new Map<string, StageCost>();
  const fnCost = (id: string): StageCost => {
    const hit = memo.get(id);
    if (hit) return hit;
    const zero: StageCost = { cost: 0, alu: 0, samples: 0, dependentReads: 0, derivatives: 0, registers: 0 };
    memo.set(id, zero); // recursion guard
    const f = fnById.get(id);
    if (!f) return zero;
    const sub: IRModule = {
      ...m,
      main: f.body,
      outputs: f.ret.map((r) => ({ slot: "ret", value: r, stage: "fragment" as Stage })),
      functions: m.functions,
    };
    const c = stageCost(sub, f.ret, t, fnCost, undefined);
    memo.set(id, c);
    return c;
  };
  const roots = (stage: Stage): ExprId[] => m.outputs.filter((o) => o.stage === stage).map((o) => o.value);
  const perNode: Record<string, NodeCost> = {};
  const shapes = new Map<string, Map<string, number>>();
  // Vertex hoisting (O6): hoisted expressions are evaluated per vertex; the fragment stage only READS them (a free leaf here).
  const hoisted = (m.hoist ?? []).filter((id) => m.main.exprs[id] !== undefined);
  const fm = fragmentView(m);
  const vertex = stageCost(m, [...roots("vertex"), ...hoisted], t, fnCost, perNode, shapes);
  const fragment = stageCost(fm, roots("fragment"), t, fnCost, perNode, shapes);

  const fmask = reachableMask(fm.main, roots("fragment"));
  const seen = new Map<string, number>();
  fm.main.exprs.forEach((e, i) => {
    if (fmask[i] && e.op === "input" && VARYING_INPUTS.has(e.input))
      seen.set(`${e.input}:${e.space ?? ""}`, componentCount(builtinInputType(e.input, e.space)));
  });
  for (const id of hoisted) if (fmask[id]) seen.set(`hoist#${id}`, Math.max(1, componentCount(m.main.exprs[id]!.ty)));
  const pack = packInterpolators([...seen].map(([id, comps]) => ({ id, comps })));
  const scalars = pack.scalars;
  const valueUniforms = m.uniforms.filter((u) => !isOpaque(u.ty)).map((u) => Math.max(1, componentCount(u.ty)));
  return {
    cls,
    fragment,
    vertex,
    interpolators: { scalars, vec4Slots: pack.slotCount, unpackedSlots: seen.size, pack },
    uniformSlots: Math.ceil(valueUniforms.reduce((a, b) => a + b, 0) / 4),
    textures: m.uniforms.filter((u) => isTextureType(u.ty)).length,
    perNode,
    total: Math.round((fragment.cost + vertex.cost) * 10) / 10,
  };
}
