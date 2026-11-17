import { FRAGMENT_BIT, bodyStageBits } from "../../ir/stages";
import {
  type ExprId,
  type IRBody,
  type IRFunction,
  type IRModule,
  MAIN_BODY,
  type Stage,
  sourceKey,
} from "../../ir/types";
import { operandsOf, reachableMask } from "../../ir/walk";

/** The expressions one stage must evaluate (ascending id = topological order) and how often each is consumed. */
interface StageSet {
  stage: Stage;
  /** Output roots of this stage plus, for the vertex stage, the interpolated (hinted) values. */
  roots: ExprId[];
  /** Expressions to evaluate in this stage, ascending. In the fragment stage hinted expressions appear but are READ from a varying. */
  order: ExprId[];
  /** Consumer count inside the stage (roots count once). */
  uses: Map<ExprId, number>;
}

export interface StagePlan {
  vertex: StageSet;
  fragment: StageSet;
  /** Boundary expressions evaluated in the vertex stage and passed to the fragment stage as varyings. */
  interpolated: ExprId[];
}

export interface PlanOptions {
  /** Graph node ids whose values should be evaluated per-vertex and interpolated ("evaluate in vertex" hint). */
  interpolateNodes?: ReadonlySet<string>;
}

const HINTABLE_TYPES = new Set(["float", "vec2", "vec3", "vec4"]);
const LEAF_OPS = new Set(["const", "param", "input", "uniform", "samplerState"]);

/**
 * Stage splitting. Rules:
 *  - values consumed only by vertex-stage outputs are evaluated in the vertex stage;
 *  - everything the fragment stage needs is evaluated in the fragment stage (a value used by both stages is
 *    evaluated twice — pure expressions, so this is always correct);
 *  - with the optional hint, vertex-legal values of the given graph nodes are evaluated in the vertex stage and
 *    interpolated (cheaper, but only exact for affine functions).
 */
export function planStages(module: IRModule, opts: PlanOptions = {}): StagePlan {
  const body = module.main;
  const n = body.exprs.length;
  const vRoots = module.outputs.filter((o) => o.stage === "vertex").map((o) => o.value);
  const fRoots = module.outputs.filter((o) => o.stage === "fragment").map((o) => o.value);

  const traverse = (roots: readonly ExprId[], stop: ReadonlySet<ExprId>): Uint8Array => {
    const mark = new Uint8Array(n);
    for (const r of roots) mark[r] = 1;
    for (let i = n - 1; i >= 0; i--) {
      if (!mark[i] || stop.has(i)) continue;
      for (const o of operandsOf(body.exprs[i]!)) mark[o] = 1;
    }
    return mark;
  };

  // ---- optional interpolation hint ----------------------------------------------------------------
  let interpolated: ExprId[] = [];
  const hint = opts.interpolateNodes;
  if (hint && hint.size > 0) {
    const fnBits = fnBitsOf(module);
    const full = traverse(fRoots, new Set());
    const inH = (i: ExprId): boolean => {
      const e = body.exprs[i]!;
      if (LEAF_OPS.has(e.op) || !HINTABLE_TYPES.has(e.ty)) return false;
      const ref = module.sourceMap[sourceKey(MAIN_BODY, i)];
      if (!ref || !hint.has(ref.nodeId)) return false;
      return (bodyStageBits(body, [i], fnBits) & FRAGMENT_BIT) === 0;
    };
    const hinted = new Set<ExprId>();
    for (let i = 0; i < n; i++) if (full[i] && inH(i)) hinted.add(i);
    const boundary = new Set<ExprId>();
    for (const r of fRoots) if (hinted.has(r)) boundary.add(r);
    for (let u = 0; u < n; u++) {
      if (!full[u] || hinted.has(u)) continue;
      for (const o of operandsOf(body.exprs[u]!)) if (hinted.has(o)) boundary.add(o);
    }
    interpolated = [...boundary].sort((a, b) => a - b);
  }

  // Optimiser-chosen vertex hoists (`IRModule.hoist`, proven affine — see opt/hoistPlan.ts). Only fragment-reachable, vertex-legal ones.
  if (module.hoist && module.hoist.length > 0) {
    const fnBits = fnBitsOf(module);
    const full = traverse(fRoots, new Set());
    const all = new Set(interpolated);
    for (const id of module.hoist) {
      const e = body.exprs[id];
      if (
        e &&
        full[id] &&
        !LEAF_OPS.has(e.op) &&
        HINTABLE_TYPES.has(e.ty) &&
        (bodyStageBits(body, [id], fnBits) & FRAGMENT_BIT) === 0
      )
        all.add(id);
    }
    interpolated = [...all].sort((a, b) => a - b);
  }

  const stop = new Set(interpolated);
  const makeSet = (stage: Stage, roots: ExprId[], stopAt: ReadonlySet<ExprId>): StageSet => {
    const mark = traverse(roots, stopAt);
    const order: ExprId[] = [];
    for (let i = 0; i < n; i++) if (mark[i]) order.push(i);
    const uses = new Map<ExprId, number>();
    const bump = (i: ExprId) => uses.set(i, (uses.get(i) ?? 0) + 1);
    for (const r of roots) bump(r);
    for (const i of order) {
      if (stopAt.has(i)) continue;
      for (const o of operandsOf(body.exprs[i]!)) bump(o);
    }
    return { stage, roots, order, uses };
  };

  const vertex = makeSet("vertex", [...vRoots, ...interpolated], new Set());
  const fragment = makeSet("fragment", fRoots, stop);
  return { vertex, fragment, interpolated };
}

function fnBitsOf(module: IRModule): (id: string) => number {
  const fns = new Map(module.functions.map((f) => [f.id, f]));
  const memo = new Map<string, number>();
  const bits = (id: string): number => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    memo.set(id, 0);
    const f = fns.get(id);
    const b = f ? bodyStageBits(f.body, f.ret, bits) : 0;
    memo.set(id, b);
    return b;
  };
  return bits;
}

/** Expressions reachable from `roots` of any body (ascending = topological) with per-expression consumer counts. */
export function bodyOrderUses(body: IRBody, roots: readonly ExprId[]): { order: ExprId[]; uses: Map<ExprId, number> } {
  const mark = reachableMask(body, roots);
  const order: ExprId[] = [];
  const uses = new Map<ExprId, number>();
  const bump = (i: ExprId) => uses.set(i, (uses.get(i) ?? 0) + 1);
  for (const r of roots) bump(r);
  body.exprs.forEach((e, i) => {
    if (!mark[i]) return;
    order.push(i);
    for (const o of operandsOf(e)) bump(o);
  });
  return { order, uses };
}

/** Functions (callee-first module order) transitively called from the given main-body expressions. */
export function neededFunctions(module: IRModule, mainExprs: readonly ExprId[]): IRFunction[] {
  const byId = new Map(module.functions.map((f) => [f.id, f]));
  const need = new Set<string>();
  const visit = (fn: string): void => {
    if (need.has(fn)) return;
    need.add(fn);
    const f = byId.get(fn);
    if (!f) return;
    for (const id of bodyOrderUses(f.body, f.ret).order) {
      const e = f.body.exprs[id]!;
      if (e.op === "call") visit(e.fn);
    }
  };
  for (const id of mainExprs) {
    const e = module.main.exprs[id]!;
    if (e.op === "call") visit(e.fn);
  }
  return module.functions.filter((f) => need.has(f.id));
}
