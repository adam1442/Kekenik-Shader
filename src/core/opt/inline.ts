import {
  type ExprId,
  type IRBody,
  type IRExpr,
  type IRFunction,
  type IRModule,
  type SourceMap,
  MAIN_BODY,
  sourceKey,
} from "../ir/types";
import { reachableMask } from "../ir/walk";
import { mapOperands } from "./mapOperands";

/** Subgraph-function optimisation counters (rule ids in the optimisation report: `inline`, `inline:dedupe`, `inline:unused-param`, `inline:specialize`). */
export interface InlineStats {
  inlined: number;
  deduped: number;
  unusedParams: number;
  specialized: number;
}

/** A function with at most this many non-leaf expressions is "tiny": inlined at every call site (call overhead + lost folding outweigh the copy). */
const TINY_FUNCTION = 8;
/** At most this many constant-argument clones per function (code-growth guard). */
const MAX_CLONES = 3;

const LEAVES = new Set(["const", "param", "input", "uniform", "samplerState"]);
const sizeOf = (f: IRFunction): number => f.body.exprs.filter((e) => !LEAVES.has(e.op)).length;
const isNative = (f: IRFunction): boolean => f.native !== undefined;

/** Map every `call` expression of a body (ids preserved). */
const mapCalls = (body: IRBody, f: (e: Extract<IRExpr, { op: "call" }>) => IRExpr): IRBody => ({
  exprs: body.exprs.map((e) => (e.op === "call" ? f(e) : e)),
});

/** Distinct reachable call expressions per callee over main + every function body. */
function callSites(m: IRModule, fns: readonly IRFunction[]): Map<string, Array<Extract<IRExpr, { op: "call" }>>> {
  const sites = new Map<string, Array<Extract<IRExpr, { op: "call" }>>>();
  const scan = (body: IRBody, roots: readonly ExprId[]): void => {
    const mask = reachableMask(body, roots);
    body.exprs.forEach((e, i) => {
      if (mask[i] && e.op === "call") sites.set(e.fn, [...(sites.get(e.fn) ?? []), e]);
    });
  };
  scan(
    m.main,
    m.outputs.map((o) => o.value),
  );
  for (const f of fns) scan(f.body, f.ret);
  return sites;
}

interface Work {
  m: IRModule;
  fns: IRFunction[];
  stats: InlineStats;
}

/** Rewrite every call in every body. */
function rewriteAllCalls(w: Work, f: (e: Extract<IRExpr, { op: "call" }>) => IRExpr): void {
  w.m = { ...w.m, main: mapCalls(w.m.main, f) };
  w.fns = w.fns.map((fn) => ({ ...fn, body: mapCalls(fn.body, f) }));
}

/** A. Identical functions (same signature, body and returns, names ignored) collapse to the first one. */
function dedupe(w: Work): void {
  const canon = new Map<string, string>();
  const rename = new Map<string, string>();
  const kept: IRFunction[] = [];
  for (const f of w.fns) {
    const body = mapCalls(f.body, (e) => (rename.has(e.fn) ? { ...e, fn: rename.get(e.fn)! } : e));
    const g = { ...f, body };
    if (isNative(f)) {
      kept.push(g);
      continue;
    }
    const key = JSON.stringify([f.params.map((p) => p.ty), f.returns.map((r) => r.ty), body.exprs, f.ret]);
    const hit = canon.get(key);
    if (hit !== undefined) {
      rename.set(f.id, hit);
      w.stats.deduped++;
      continue;
    }
    canon.set(key, f.id);
    kept.push(g);
  }
  if (rename.size === 0) return;
  w.fns = kept;
  w.m = { ...w.m, main: mapCalls(w.m.main, (e) => (rename.has(e.fn) ? { ...e, fn: rename.get(e.fn)! } : e)) };
}

/** B. Parameters the body never reads are dropped from the signature and from every call. */
function dropUnusedParams(w: Work): void {
  for (const f of [...w.fns]) {
    if (isNative(f) || f.params.length === 0) continue;
    const mask = reachableMask(f.body, f.ret);
    const used = new Set<number>();
    f.body.exprs.forEach((e, i) => {
      if (mask[i] && e.op === "param") used.add(e.index);
    });
    if (used.size === f.params.length) continue;
    const remap = new Map<number, number>();
    f.params.forEach((_, i) => {
      if (used.has(i)) remap.set(i, remap.size);
    });
    w.stats.unusedParams += f.params.length - used.size;
    const patched: IRFunction = {
      ...f,
      params: f.params.filter((_, i) => used.has(i)),
      body: { exprs: f.body.exprs.map((e) => (e.op === "param" ? { ...e, index: remap.get(e.index) ?? e.index } : e)) },
    };
    w.fns = w.fns.map((x) => (x.id === f.id ? patched : x));
    rewriteAllCalls(w, (e) => (e.fn === f.id ? { ...e, args: e.args.filter((_, i) => used.has(i)) } : e));
  }
}

/** C. Constant-argument specialisation: calls that share the same constant arguments get one clone with those parameters folded in. */
function specialize(w: Work): void {
  const sites = callSites(w.m, w.fns);
  for (const f of [...w.fns]) {
    const calls = sites.get(f.id) ?? [];
    if (isNative(f) || calls.length < 2 || sizeOf(f) <= TINY_FUNCTION) continue;
    const groups = new Map<string, number[]>();
    // Constant arguments are looked up in the body that owns the call.
    const owners: Array<{ body: IRBody; roots: readonly ExprId[] }> = [
      { body: w.m.main, roots: w.m.outputs.map((o) => o.value) },
      ...w.fns.map((x) => ({ body: x.body, roots: x.ret })),
    ];
    for (const o of owners) {
      const mask = reachableMask(o.body, o.roots);
      o.body.exprs.forEach((e, i) => {
        if (!mask[i] || e.op !== "call" || e.fn !== f.id) return;
        const consts = e.args.map((a, k) => ({ k, v: o.body.exprs[a] })).filter((x) => x.v?.op === "const");
        if (consts.length === 0) return;
        const key = JSON.stringify(consts.map((c) => [c.k, (c.v as { value: number[] }).value]));
        groups.set(key, [...(groups.get(key) ?? []), i]);
      });
    }
    let clones = 0;
    for (const [key, ids] of groups) {
      if (ids.length < 2 || clones >= MAX_CLONES) continue;
      const pairs = JSON.parse(key) as Array<[number, number[]]>;
      const known = new Map(pairs.map(([k, v]) => [k, v]));
      const cloneId = `${f.id}$s${w.stats.specialized}`;
      const keep = f.params.map((_, i) => i).filter((i) => !known.has(i));
      const remap = new Map(keep.map((i, j) => [i, j]));
      const body: IRBody = {
        exprs: f.body.exprs.map((e): IRExpr => {
          if (e.op !== "param") return e;
          const kv = known.get(e.index);
          return kv !== undefined ? { op: "const", ty: e.ty, value: kv } : { ...e, index: remap.get(e.index)! };
        }),
      };
      w.fns = [
        ...w.fns,
        { ...f, id: cloneId, name: `${f.name}_k${w.stats.specialized}`, params: keep.map((i) => f.params[i]!), body },
      ];
      // Order must stay callee-first: put the clone right after the original (it only depends on the original's callees).
      const idx = w.fns.findIndex((x) => x.id === f.id);
      const clone = w.fns.pop()!;
      w.fns.splice(idx + 1, 0, clone);
      const sig = key;
      const sm = { ...w.m.sourceMap };
      f.body.exprs.forEach((_, j) => {
        const r = w.m.sourceMap[sourceKey(f.id, j)];
        if (r) sm[sourceKey(cloneId, j)] = r;
      });
      w.m = { ...w.m, sourceMap: sm };
      const owns = (e: Extract<IRExpr, { op: "call" }>, bodyExprs: IRBody["exprs"]): boolean =>
        e.fn === f.id &&
        JSON.stringify(
          e.args
            .map((a, k) => ({ k, v: bodyExprs[a] }))
            .filter((x) => x.v?.op === "const")
            .map((c) => [c.k, (c.v as { value: number[] }).value]),
        ) === sig;
      w.m = {
        ...w.m,
        main: {
          exprs: w.m.main.exprs.map((e) =>
            e.op === "call" && owns(e, w.m.main.exprs)
              ? { ...e, fn: cloneId, args: e.args.filter((_, k) => !known.has(k)) }
              : e,
          ),
        },
      };
      w.fns = w.fns.map((x) =>
        x.id === cloneId
          ? x
          : {
              ...x,
              body: {
                exprs: x.body.exprs.map((e) =>
                  e.op === "call" && owns(e, x.body.exprs)
                    ? { ...e, fn: cloneId, args: e.args.filter((_, k) => !known.has(k)) }
                    : e,
                ),
              },
            },
      );
      clones++;
      w.stats.specialized++;
    }
  }
}

/** D. Inline tiny and single-call-site functions into their callers (callee-first, so nested calls collapse completely). */
function inlineCalls(w: Work): SourceMap {
  const sites = callSites(w.m, w.fns);
  const inline = new Set(
    w.fns
      .filter(
        (f) =>
          !isNative(f) &&
          ((sites.get(f.id)?.length ?? 0) === 1 || sizeOf(f) <= TINY_FUNCTION) &&
          (sites.get(f.id)?.length ?? 0) > 0,
      )
      .map((f) => f.id),
  );
  const src: SourceMap = {};
  const byId = new Map(w.fns.map((f) => [f.id, f]));
  const run = (bodyId: string, body: IRBody, roots: readonly ExprId[]): { body: IRBody; roots: ExprId[] } => {
    const out: IRExpr[] = [];
    const map: ExprId[] = [];
    const push = (e: IRExpr): ExprId => out.push(e) - 1;
    body.exprs.forEach((e, i) => {
      const ref = w.m.sourceMap[sourceKey(bodyId, i)];
      if (e.op === "call" && inline.has(e.fn)) {
        const f = byId.get(e.fn)!;
        const args = e.args.map((a) => map[a]!);
        const local: ExprId[] = [];
        // Dead callee expressions are not copied: `dropUnusedParams` only checks reachable parameters, so a dead expression may still
        // read a parameter that no longer exists (found by fuzzing, seed 33: operand `undefined` crashed the folder).
        const live = reachableMask(f.body, f.ret);
        f.body.exprs.forEach((fe, j) => {
          if (!live[j]) return;
          if (fe.op === "param") {
            local[j] = args[fe.index]!;
            return;
          }
          local[j] = push(mapOperands(fe, (o) => local[o]!));
          const r = w.m.sourceMap[sourceKey(f.id, j)];
          if (r) src[sourceKey(bodyId, local[j]!)] = r;
        });
        map[i] = local[f.ret[e.index]!]!;
        w.stats.inlined++;
        if (ref) src[sourceKey(bodyId, map[i]!)] ??= ref;
      } else {
        map[i] = push(mapOperands(e, (o) => map[o]!));
        if (ref) src[sourceKey(bodyId, map[i]!)] ??= ref;
      }
    });
    return { body: { exprs: out }, roots: roots.map((r) => map[r]!) };
  };
  const nf: IRFunction[] = [];
  for (const f of w.fns) {
    if (isNative(f)) {
      nf.push(f);
      for (let j = 0; j < f.body.exprs.length; j++) {
        const r = w.m.sourceMap[sourceKey(f.id, j)];
        if (r) src[sourceKey(f.id, j)] = r;
      }
      continue;
    }
    const r = run(f.id, f.body, f.ret);
    const g = { ...f, body: r.body, ret: r.roots };
    byId.set(f.id, g);
    nf.push(g);
  }
  const rm = run(
    MAIN_BODY,
    w.m.main,
    w.m.outputs.map((o) => o.value),
  );
  w.fns = nf.filter((f) => !inline.has(f.id));
  w.m = { ...w.m, main: rm.body, outputs: w.m.outputs.map((o, i) => ({ ...o, value: rm.roots[i]! })) };
  return src;
}

/** E. Functions nothing calls any more are removed. */
function pruneUnused(w: Work): void {
  const need = new Set<string>();
  const visit = (body: IRBody, roots: readonly ExprId[]): void => {
    const mask = reachableMask(body, roots);
    body.exprs.forEach((e, i) => {
      if (!mask[i] || e.op !== "call" || need.has(e.fn)) return;
      need.add(e.fn);
      const f = w.fns.find((x) => x.id === e.fn);
      if (f) visit(f.body, f.ret);
    });
  };
  visit(
    w.m.main,
    w.m.outputs.map((o) => o.value),
  );
  w.fns = w.fns.filter((f) => need.has(f.id));
}

/**
 * Function inlining + specialisation . Order: dedupe identical functions → drop unused parameters → constant-argument
 * specialisation (≥ 2 calls sharing the same constants) → inline tiny / single-call-site functions → prune unreferenced functions.
 * Native (Custom Function) functions are never touched. Pure: returns a new module; a module without functions is returned as is.
 */
export function inlineModule(m: IRModule): { module: IRModule; stats: InlineStats } {
  const stats: InlineStats = { inlined: 0, deduped: 0, unusedParams: 0, specialized: 0 };
  if (m.functions.length === 0) return { module: m, stats };
  const w: Work = { m, fns: [...m.functions], stats };
  dedupe(w);
  dropUnusedParams(w);
  specialize(w);
  const sourceMap = inlineCalls(w);
  pruneUnused(w);
  return { module: { ...w.m, functions: w.fns, sourceMap }, stats };
}
