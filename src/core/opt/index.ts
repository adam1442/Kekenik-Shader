import type { IRPass } from "../compile/backend";
import { type ExprId, type IRModule, type SourceMap, sourceKey, MAIN_BODY } from "../ir/types";
import { narrowBody } from "./demanded";
import { inlineModule } from "./inline";
import { type RebuiltBody, rebuildBody } from "./rebuild";
import type { OptLevel } from "./simplify";

export type { OptLevel } from "./simplify";
export { type HoistMode, type HoistPlan, applyHoist, getDefaultHoistMode, setDefaultHoistMode } from "./hoistPlan";
export { type PrecisionMode, type PrecisionReport, applyPrecision, precisionModeOf } from "./precision";
export interface OptReport {
  level: OptLevel;
  before: number;
  after: number;
  folded: number;
  simplified: number;
  merged: number;
  /** Applied transformations by rule id (`range:*`, `peephole:*`, `demanded-components`, `algebra`, `fold`, `cse`) with counts. */
  rules: Record<string, number>;
}

/** Default level used by `compileGraph` when `CompileOptions.optimize` is not given. The app sets it from Preferences; core default 0 keeps goldens stable. */
let defaultLevel: OptLevel = 0;
export const getDefaultOptLevel = (): OptLevel => defaultLevel;
export const setDefaultOptLevel = (l: OptLevel): void => {
  defaultLevel = l;
};

const remapSources = (old: SourceMap, bodyId: string, r: Pick<RebuiltBody, "origin">, into: SourceMap): void => {
  r.origin.forEach((o, j) => {
    const ref = old[sourceKey(bodyId, o)];
    if (ref) into[sourceKey(bodyId, j)] = ref;
  });
};

/** Max rewrite rounds per body: narrowing exposes folds and folds expose narrowing; the loop stops at the first round that changes nothing. */
const MAX_ROUNDS = 5;

interface OptimizedBody {
  body: RebuiltBody["body"];
  roots: ExprId[];
  origin: ExprId[];
  stats: RebuiltBody["stats"];
}

/** Narrow (demanded components) → fold / simplify / CSE / DCE, repeated to a fixpoint. `origin` maps final ids to the INPUT body's ids. */
function optimizeBody(src: IRBodyLike, roots: readonly ExprId[], level: OptLevel): OptimizedBody {
  let cur = { body: src, roots: [...roots], origin: src.exprs.map((_, i) => i) };
  const total = {
    before: src.exprs.length,
    after: 0,
    folded: 0,
    simplified: 0,
    merged: 0,
    rules: {} as Record<string, number>,
  };
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let b = cur.body;
    let r = cur.roots;
    let org = cur.origin;
    const n = narrowBody(cur.body, cur.roots);
    if (n.narrowed > 0) {
      total.rules["demanded-components"] = (total.rules["demanded-components"] ?? 0) + n.narrowed;
      b = n.body;
      r = n.roots;
      org = n.origin.map((o) => cur.origin[o]!);
    }
    const rb = rebuildBody(b, r, level);
    total.folded += rb.stats.folded;
    total.simplified += rb.stats.simplified;
    total.merged += rb.stats.merged;
    for (const [k, v] of Object.entries(rb.stats.rules)) total.rules[k] = (total.rules[k] ?? 0) + v;
    const next = { body: rb.body, roots: rb.roots, origin: rb.origin.map((o) => org[o]!) };
    const unchanged =
      JSON.stringify(next.body.exprs) === JSON.stringify(cur.body.exprs) &&
      next.roots.every((x, i) => x === cur.roots[i]);
    cur = next;
    if (unchanged) break;
  }
  total.after = cur.body.exprs.length;
  if (total.folded) total.rules["fold"] = total.folded;
  if (total.merged) total.rules["cse"] = total.merged;
  return { body: cur.body, roots: cur.roots, origin: cur.origin, stats: total };
}
type IRBodyLike = RebuiltBody["body"];

/** Optimise every body of a module. Pure: returns a new module (level 0 returns the input untouched). */
export function optimizeModuleWithReport(m: IRModule, level: OptLevel): { module: IRModule; report: OptReport } {
  const report: OptReport = { level, before: 0, after: 0, folded: 0, simplified: 0, merged: 0, rules: {} };
  if (level === 0) return { module: m, report };
  const sourceMap: SourceMap = {};
  // Subgraph functions first (O4): inlining exposes cross-boundary folding to the body optimiser below.
  const inl = inlineModule(m);
  m = inl.module;
  for (const [rule, n] of [
    ["inline", inl.stats.inlined],
    ["inline:dedupe", inl.stats.deduped],
    ["inline:unused-param", inl.stats.unusedParams],
    ["inline:specialize", inl.stats.specialized],
  ] as const)
    if (n > 0) report.rules[rule] = n;
  const add = (r: OptimizedBody): void => {
    for (const [k, v] of Object.entries(r.stats.rules)) report.rules[k] = (report.rules[k] ?? 0) + v;
    report.before += r.stats.before;
    report.after += r.stats.after;
    report.folded += r.stats.folded;
    report.simplified += r.stats.simplified;
    report.merged += r.stats.merged;
  };
  const functions = m.functions.map((f) => {
    const r = optimizeBody(f.body, f.ret, level);
    add(r);
    remapSources(m.sourceMap, f.id, r, sourceMap);
    return { ...f, body: r.body, ret: r.roots };
  });
  const rm = optimizeBody(
    m.main,
    m.outputs.map((o) => o.value),
    level,
  );
  add(rm);
  remapSources(m.sourceMap, MAIN_BODY, rm, sourceMap);
  const outputs = m.outputs.map((o, i) => ({ ...o, value: rm.roots[i] as ExprId }));
  return { module: { ...m, functions, main: rm.body, outputs, sourceMap }, report };
}

/** IR pass wrapper (usable in `CompileOptions.passes`). */
export const optimizationPass = (level: OptLevel): IRPass => ({
  id: `opt${level}`,
  run: (m) => optimizeModuleWithReport(m, level).module,
});
