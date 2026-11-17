import type { IRBuilder } from "./builder";
import { operandsOf } from "./walk";
import { type ExprId, type IRExpr, sourceKey } from "./types";

/** Result of {@link cloneCone}. */
export interface ConeClone {
  /** Root of the rebuilt cone (== the original root when nothing in it depends on a substituted leaf). */
  id: ExprId;
  /** Does the cone contain at least one substituted leaf? `false` ⇒ `id === root`. */
  dependent: boolean;
  /** Number of expressions in the ORIGINAL cone (all expressions reachable from the root). */
  coneSize: number;
  /** Number of cone expressions that had to be rebuilt (the extra work one re-evaluation adds before CSE). */
  rebuilt: number;
}

/** Size of the upstream expression cone of `root` (number of reachable expressions, root included). */
export function coneSize(b: IRBuilder, root: ExprId): number {
  return collectCone(b, root).length;
}

function collectCone(b: IRBuilder, root: ExprId): ExprId[] {
  const seen = new Set<ExprId>([root]);
  const stack = [root];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const o of operandsOf(b.body.exprs[id]!)) if (!seen.has(o)) (seen.add(o), stack.push(o));
  }
  return [...seen].sort((x, y) => x - y);
}

/**
 * Structurally rebuilds the upstream expression cone of `root` with the leaves in `substitutions` (expr id → replacement expr id)
 * replaced ( U6 — "IR cone re-evaluation", the technical core of Height To Normal).
 *
 *  - Expressions that do not depend on a substituted leaf are NOT copied: the original id is reused, so everything shared with the
 *    un-substituted evaluation stays shared (and the builder's structural CSE re-interns anything that becomes identical).
 *  - Inline cloning only — no function calls — so it works for engines that forbid helper functions reading built-ins (Godot).
 *  - The source map is preserved: a rebuilt expression is attributed to the same graph node / port as the expression it replaces.
 *  - `memo` may be shared between several calls that use the same substitution set to reuse work.
 */
export function cloneCone(
  b: IRBuilder,
  root: ExprId,
  substitutions: ReadonlyMap<ExprId, ExprId>,
  memo: Map<ExprId, ExprId> = new Map(),
): ConeClone {
  const cone = collectCone(b, root);
  let dependent = false;
  let rebuilt = 0;
  const keep = b.getSource();
  for (const id of cone) {
    const sub = substitutions.get(id);
    if (sub !== undefined) {
      memo.set(id, sub);
      dependent = true;
      continue;
    }
    if (memo.has(id)) {
      dependent ||= memo.get(id) !== id;
      continue;
    }
    const e = b.body.exprs[id]!;
    const ops = operandsOf(e);
    if (ops.every((o) => (memo.get(o) ?? o) === o)) {
      memo.set(id, id);
      continue;
    }
    b.setSource(b.env.sourceMap[sourceKey(b.bodyId, id)] ?? keep ?? null);
    memo.set(
      id,
      rebuild(b, e, (o) => memo.get(o) ?? o),
    );
    rebuilt++;
    dependent = true;
  }
  b.setSource(keep ?? null);
  return { id: memo.get(root) ?? root, dependent, coneSize: cone.length, rebuilt };
}

/** Re-create `e` with every operand mapped through `m`, via the builder's public (type-checking, interning) API. */
function rebuild(b: IRBuilder, e: IRExpr, m: (id: ExprId) => ExprId): ExprId {
  switch (e.op) {
    case "const":
    case "param":
    case "samplerState":
    case "input":
    case "uniform":
      return b.body.exprs.indexOf(e); // leaves are never rebuilt (only substituted); kept for exhaustiveness
    case "unary":
      return b.unary(e.kind, m(e.a));
    case "binary":
      return b.binary(e.kind, m(e.a), m(e.b));
    case "intrinsic":
      return b.intrinsic(e.fn, e.args.map(m));
    case "construct":
      return b.construct(e.ty, e.args.map(m));
    case "swizzle":
      return b.swizzle(m(e.src), e.mask);
    case "select":
      return b.select(m(e.cond), m(e.a), m(e.b));
    case "cast":
      return b.cast(m(e.src), e.ty);
    case "matmul":
      return b.matmul(m(e.a), m(e.b));
    case "sample":
      return b.sample({
        tex: m(e.tex),
        ...(e.samp !== undefined ? { samp: m(e.samp) } : {}),
        uv: m(e.uv),
        mode: e.mode,
        ...(e.lod !== undefined ? { lod: m(e.lod) } : {}),
        ...(e.ddx !== undefined ? { ddx: m(e.ddx) } : {}),
        ...(e.ddy !== undefined ? { ddy: m(e.ddy) } : {}),
      });
    case "textureSize":
      return b.textureSize(m(e.tex));
    case "deriv":
      return b.deriv(e.kind, m(e.src));
    case "call":
      return b.call(e.fn, e.args.map(m), e.index);
    case "custom":
      return b.custom(e.block, e.args.map(m), e.index);
    case "engine":
      return b.engine(e.name, e.ty, e.args.map(m));
  }
}
