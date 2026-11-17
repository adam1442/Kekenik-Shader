import type { ExprId, IRBody, IRExpr } from "../ir/types";
import { reachableMask } from "../ir/walk";
import { foldExpr } from "./fold";
import { mapOperands } from "./mapOperands";
import { type Range, rangeOf } from "./range";
import { type OptLevel, simplify } from "./simplify";

export interface RebuiltBody {
  body: IRBody;
  /** Final ids of the requested roots (same order). */
  roots: ExprId[];
  /** Final id → id of the ORIGINAL expression it descends from (source-map carry-over). */
  origin: ExprId[];
  stats: {
    before: number;
    after: number;
    folded: number;
    simplified: number;
    merged: number;
    rules: Record<string, number>;
  };
}

/**
 * One optimisation sweep over a body: constant folding + algebraic simplification + structural CSE (re-interning after every
 * rewrite, so equal results merge) followed by dead-code elimination from `roots`. Operands always keep lower ids than users.
 */
export function rebuildBody(src: IRBody, roots: readonly ExprId[], level: OptLevel): RebuiltBody {
  const out: IRExpr[] = [];
  const originAll: ExprId[] = [];
  const intern = new Map<string, ExprId>();
  const map: ExprId[] = new Array<ExprId>(src.exprs.length);
  const ranges: Range[] = [];
  const stats = {
    before: src.exprs.length,
    after: 0,
    folded: 0,
    simplified: 0,
    merged: 0,
    rules: {} as Record<string, number>,
  };
  let current = 0;

  const put = (e: IRExpr): ExprId => {
    const key = JSON.stringify(e);
    const hit = intern.get(key);
    if (hit !== undefined) {
      stats.merged++;
      return hit;
    }
    out.push(e);
    ranges.push(rangeOf(e, (id) => ranges[id]!));
    originAll.push(current);
    intern.set(key, out.length - 1);
    return out.length - 1;
  };
  const ctx = { level, get: (id: ExprId): IRExpr => out[id]!, put, range: (id: ExprId): Range => ranges[id]! };

  for (let i = 0; i < src.exprs.length; i++) {
    current = i;
    let e = mapOperands(src.exprs[i]!, (id) => map[id]!);
    // Rewrite until a fixpoint (bounded): a simplification can expose a fold and vice versa.
    for (let guard = 0; guard < 4; guard++) {
      const folded = foldExpr(e, ctx.get);
      if (folded) {
        e = folded;
        stats.folded++;
        break;
      }
      const s = simplify(e, ctx);
      if (!s) break;
      stats.simplified++;
      const rule = s.rule ?? "algebra";
      stats.rules[rule] = (stats.rules[rule] ?? 0) + 1;
      if ("alias" in s) {
        map[i] = s.alias;
        e = undefined as unknown as IRExpr;
        break;
      }
      e = s.expr;
    }
    if (e !== undefined) map[i] = put(e);
  }

  // Dead-code elimination + compaction.
  const finalRoots = roots.map((r) => map[r]!);
  const mask = reachableMask({ exprs: out }, finalRoots);
  const keep = new Int32Array(out.length).fill(-1);
  const exprs: IRExpr[] = [];
  const origin: ExprId[] = [];
  for (let i = 0; i < out.length; i++) {
    if (!mask[i]) continue;
    keep[i] = exprs.length;
    exprs.push(mapOperands(out[i]!, (id) => keep[id]!));
    origin.push(originAll[i]!);
  }
  stats.after = exprs.length;
  return { body: { exprs }, roots: finalRoots.map((r) => keep[r]!), origin, stats };
}
