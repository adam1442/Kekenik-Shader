import { mapOperands } from "../opt/mapOperands";
import type { StorageType } from "../types/shaderType";
import {
  type ExprId,
  type IRExpr,
  type IRFunction,
  type IRModule,
  MAIN_BODY,
  type SourceMap,
  sourceKey,
} from "./types";

/**
 * E7b — engine ops that read engine built-ins inside functions → hidden parameters (the sibling of `lowerFunctionInputs`).
 *
 * Godot helper functions cannot read `PROJECTION_MATRIX`, `INV_PROJECTION_MATRIX`, `VIEWPORT_SIZE`, … (they exist only inside `vertex()` /
 * `fragment()` / `light()`): "Unknown identifier in expression". The engine templates (`core/engine/builtinEntries.ts`) are plain text, so the
 * `input`-lowering never saw them. This pass asks `depsOf(engineName)` which non-global built-ins the template reads and:
 *  - inside a function: appends one hidden parameter per built-in and extends the `engine` op's args with them (the pack substitutes the
 *    identifiers in the template by those parameters);
 *  - every call site passes the built-in: an `engine` op named `godot.builtin.<NAME>` (resolved to the bare identifier) in the main body, or
 *    a hidden parameter of the caller (transitively; functions are callee-first).
 * `engine` ops in the main body (= the processor function) are left alone. Returns the SAME module when nothing needs lowering.
 */
export interface BuiltinDep {
  name: string;
  ty: StorageType;
}
export const BUILTIN_ENGINE_PREFIX = "godot.builtin.";
export const hiddenBuiltinParam = (name: string): string => `kek_b_${name}`;

export function lowerEngineBuiltins(module: IRModule, depsOf: (engineName: string) => readonly BuiltinDep[]): IRModule {
  const needs = (e: IRExpr): boolean => e.op === "engine" && !e.name.startsWith(BUILTIN_ENGINE_PREFIX) && depsOf(e.name).length > 0;
  if (!module.functions.some((f) => f.native === undefined && f.body.exprs.some(needs))) return module;

  const hidden = new Map<string, BuiltinDep[]>();
  const sourceMap: SourceMap = {};

  const rebuild = (
    exprs: readonly IRExpr[],
    bodyId: string,
    fn: IRFunction | undefined,
  ): { out: IRExpr[]; map: ExprId[]; hid: BuiltinDep[] } => {
    const out: IRExpr[] = [];
    const map: ExprId[] = new Array(exprs.length).fill(-1);
    const hid: BuiltinDep[] = [];
    const provided = new Map<string, ExprId>();
    const provide = (d: BuiltinDep): ExprId => {
      const hit = provided.get(d.name);
      if (hit !== undefined) return hit;
      let e: IRExpr;
      if (fn) {
        let idx = hid.findIndex((x) => x.name === d.name);
        if (idx < 0) {
          hid.push(d);
          idx = hid.length - 1;
        }
        e = { op: "param", ty: d.ty, index: fn.params.length + idx };
      } else e = { op: "engine", ty: d.ty, name: `${BUILTIN_ENGINE_PREFIX}${d.name}`, args: [] };
      out.push(e);
      provided.set(d.name, out.length - 1);
      return out.length - 1;
    };
    exprs.forEach((e, i) => {
      let n: IRExpr;
      if (e.op === "call") {
        const args = e.args.map((a) => map[a]!);
        const extra = (hidden.get(e.fn) ?? []).map(provide);
        n = { ...e, args: [...args, ...extra] };
      } else if (fn && e.op === "engine" && needs(e)) {
        const args = e.args.map((a) => map[a]!);
        n = { ...e, args: [...args, ...depsOf(e.name).map(provide)] };
      } else n = mapOperands(e, (id) => map[id]!);
      out.push(n);
      map[i] = out.length - 1;
      const ref = module.sourceMap[sourceKey(bodyId, i)];
      if (ref) sourceMap[sourceKey(bodyId, out.length - 1)] = ref;
    });
    return { out, map, hid };
  };

  const functions: IRFunction[] = module.functions.map((f) => {
    if (f.native !== undefined) return f;
    const r = rebuild(f.body.exprs, f.id, f);
    hidden.set(f.id, r.hid);
    return {
      ...f,
      params: [...f.params, ...r.hid.map((h) => ({ name: hiddenBuiltinParam(h.name), ty: h.ty }))],
      body: { exprs: r.out },
      ret: f.ret.map((id) => r.map[id]!),
    };
  });
  const main = rebuild(module.main.exprs, MAIN_BODY, undefined);
  const lowered: IRModule = {
    ...module,
    functions,
    main: { exprs: main.out },
    outputs: module.outputs.map((o) => ({ ...o, value: main.map[o.value]! })),
    sourceMap,
  };
  if (module.hoist) lowered.hoist = module.hoist.map((id) => main.map[id]!);
  if (module.half) lowered.half = module.half.map((id) => main.map[id]!);
  return lowered;
}
