import type { ExprId, IRModule } from "../ir/types";
import { MAIN_BODY, sourceKey } from "../ir/types";
import { operandsOf } from "../ir/walk";
import { COST_TABLES, exprAlu } from "../stats/cost";
import { componentCount } from "../types/shaderType";
import { AFF_AFFINE, VARYING_INPUTS, analyzeAffine, findHoistCandidates } from "./hoist";

/** Vertex-hoisting aggressiveness (Preferences → Optimisation). */
export type HoistMode = "off" | "conservative" | "aggressive";
export const HOIST_MODES: readonly HoistMode[] = ["off", "conservative", "aggressive"];

interface ModeSpec {
  /** Minimum per-pixel ALU-equivalents (desktop weights) a candidate must save. */
  minSaved: number;
  /** Maximum unpacked interpolators (varyings) in the fragment stage after hoisting. */
  maxVaryings: number;
  /** Maximum growth of the varying count caused by hoisting. */
  maxGrowth: number;
}
const HOIST_SPECS: Readonly<Record<Exclude<HoistMode, "off">, ModeSpec>> = {
  conservative: { minSaved: 2, maxVaryings: 6, maxGrowth: 1 },
  aggressive: { minSaved: 0.5, maxVaryings: 8, maxGrowth: 4 },
};

export interface HoistOptions {
  mode: HoistMode;
  /** Graph node ids forced to stay per-pixel (per-node override "Evaluate in Fragment"). */
  exclude?: ReadonlySet<string>;
}
interface HoistDecision {
  id: ExprId;
  ty: string;
  saved: number;
  nodeId?: string;
}
export interface HoistPlan {
  mode: HoistMode;
  chosen: HoistDecision[];
  rejected: Array<{ id: ExprId; reason: string; nodeId?: string }>;
  /** Unpacked fragment interpolators before / after the plan. */
  varyingsBefore: number;
  varyingsAfter: number;
  /** Total per-pixel ALU-equivalents removed from the fragment stage (desktop weights). */
  saved: number;
}

const nodeOf = (m: IRModule, id: ExprId): string | undefined => m.sourceMap[sourceKey(MAIN_BODY, id)]?.nodeId;

/** Distinct interpolated varyings (input slug, or hoisted value) the fragment stage reads when the `stops` are read from varyings. */
function fragmentVaryings(m: IRModule, stops: ReadonlySet<ExprId>): number {
  const ex = m.main.exprs;
  const seen = new Set<ExprId>();
  const stack = m.outputs.filter((o) => o.stage === "fragment").map((o) => o.value);
  const slugs = new Set<string>();
  while (stack.length) {
    const i = stack.pop()!;
    if (seen.has(i)) continue;
    seen.add(i);
    const e = ex[i]!;
    if (stops.has(i)) {
      slugs.add(`#${i}`);
      continue;
    }
    if (e.op === "input" && VARYING_INPUTS.has(e.input)) slugs.add(`${e.input}:${e.space ?? ""}`);
    for (const o of operandsOf(e)) stack.push(o);
  }
  return slugs.size;
}

function coneCost(m: IRModule, root: ExprId): number {
  const t = COST_TABLES.desktop;
  const seen = new Set<ExprId>();
  const stack = [root];
  let sum = 0;
  while (stack.length) {
    const i = stack.pop()!;
    if (seen.has(i)) continue;
    seen.add(i);
    const e = m.main.exprs[i]!;
    sum += exprAlu(e, t, () => 0);
    for (const o of operandsOf(e)) stack.push(o);
  }
  return sum;
}

/**
 * Cost-driven selection of vertex hoists (O6). Legality comes from `analyzeAffine` (affine in interpolated leaves ⇒ identical image);
 * this decides which legal candidates are WORTH it: saved per-pixel ALU ≥ the mode's threshold and the resulting fragment interpolator
 * count stays within the mode's budget. Greedy by saving, deterministic.
 */
function planHoist(m: IRModule, opts: HoistOptions): HoistPlan {
  const before = fragmentVaryings(m, new Set());
  const plan: HoistPlan = {
    mode: opts.mode,
    chosen: [],
    rejected: [],
    varyingsBefore: before,
    varyingsAfter: before,
    saved: 0,
  };
  if (opts.mode === "off") return plan;
  const spec = HOIST_SPECS[opts.mode];
  const cands = findHoistCandidates(m, analyzeAffine(m)).map((id) => ({ id, saved: coneCost(m, id) }));
  cands.sort((a, b) => b.saved - a.saved || a.id - b.id);
  const stops = new Set<ExprId>();
  for (const c of cands) {
    const nodeId = nodeOf(m, c.id);
    const note = (reason: string): void => void plan.rejected.push({ id: c.id, reason, ...(nodeId ? { nodeId } : {}) });
    if (nodeId && opts.exclude?.has(nodeId)) {
      note("node override: evaluate in fragment");
      continue;
    }
    if (c.saved < spec.minSaved) {
      note(`saves only ${c.saved.toFixed(1)} ALU per pixel (< ${spec.minSaved})`);
      continue;
    }
    stops.add(c.id);
    const after = fragmentVaryings(m, stops);
    if (after > spec.maxVaryings || after - before > spec.maxGrowth) {
      stops.delete(c.id);
      note(`would need ${after} interpolators (limit ${spec.maxVaryings}, growth ≤ ${spec.maxGrowth})`);
      continue;
    }
    plan.chosen.push({ id: c.id, ty: m.main.exprs[c.id]!.ty, saved: c.saved, ...(nodeId ? { nodeId } : {}) });
    plan.saved += c.saved;
  }
  plan.chosen.sort((a, b) => a.id - b.id);
  plan.varyingsAfter = fragmentVaryings(m, new Set(plan.chosen.map((c) => c.id)));
  return plan;
}

/** Number of scalar components carried by the chosen interpolators (for packing estimates). */
export const hoistedScalars = (m: IRModule): number =>
  (m.hoist ?? []).reduce((s, id) => s + Math.max(1, componentCount(m.main.exprs[id]!.ty)), 0);

/** Pure pass: returns `m` with `hoist` set to the plan's expressions (or `m` itself when nothing is hoisted). Idempotent. */
export function applyHoist(m: IRModule, opts: HoistOptions): { module: IRModule; plan: HoistPlan } {
  const plan = planHoist(m, opts);
  if (plan.chosen.length === 0) return { module: m, plan };
  return { module: { ...m, hoist: plan.chosen.map((c) => c.id) }, plan };
}

/** True when `id` is an affine fragment expression (exposed for tests / UI explanations). */
export const isAffineExpr = (m: IRModule, id: ExprId): boolean => analyzeAffine(m).cls[id] === AFF_AFFINE;

let defaultMode: HoistMode = "off";
/** Default used by `compileGraph` when `CompileOptions.hoist` is not given. The app sets it from Preferences; core default `off` keeps goldens stable. */
export const getDefaultHoistMode = (): HoistMode => defaultMode;
export const setDefaultHoistMode = (m: HoistMode): void => {
  defaultMode = m;
};
