import { mapOperands } from "../opt/mapOperands";
import type { Space } from "../types/semantics";
import type { StorageType } from "../types/shaderType";
import type { BuiltinInput } from "./inputs";
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
 * Built-in inputs read inside functions → hidden parameters .
 *
 * Some languages cannot read built-ins (Godot: `UV`, `NORMAL`, `VIEW` … exist only inside `vertex()` / `fragment()` / `light()`) or varyings
 * from a helper function. This pass makes every IR function pure in that respect: each `input` expression of a function body becomes an extra
 * trailing parameter, and every call site passes the value — an `input` expression in the main body, or (when the caller is itself a function)
 * a hidden parameter of the caller, transitively (functions are callee-first). Expression ids are renumbered; `outputs`, `hoist`, `half` and
 * the source map are remapped. Returns the SAME module object when no function reads an input (existing output stays byte-identical).
 *
 * Equivalence: the CPU evaluator on the lowered module gives the same outputs as on the original (test `10e2.fn.lowering-equivalence`).
 */
interface HiddenInput {
  input: BuiltinInput;
  space?: Space;
  ty: StorageType;
}
const keyOf = (input: BuiltinInput, space: Space | undefined): string => `${input}|${space ?? ""}`;

/** Name of the hidden parameter (readable in the generated function signature). */
const hiddenParamName = (h: HiddenInput): string => `kek_in_${h.input}${h.space ? `_${h.space}` : ""}`;

export function lowerFunctionInputs(module: IRModule): IRModule {
  if (!module.functions.some((f) => f.native === undefined && f.body.exprs.some((e) => e.op === "input")))
    return module;
  const hidden = new Map<string, HiddenInput[]>();
  const sourceMap: SourceMap = {};

  /** Rebuild one body: with `fn` inputs become hidden params of that function, otherwise they stay `input` ops (deduplicated). */
  const rebuild = (
    exprs: readonly IRExpr[],
    bodyId: string,
    fn: IRFunction | undefined,
  ): { out: IRExpr[]; map: ExprId[]; hid: HiddenInput[] } => {
    const out: IRExpr[] = [];
    const map: ExprId[] = new Array(exprs.length).fill(-1);
    const hid: HiddenInput[] = [];
    const provided = new Map<string, ExprId>();
    const provide = (h: HiddenInput): ExprId => {
      const k = keyOf(h.input, h.space);
      const hit = provided.get(k);
      if (hit !== undefined) return hit;
      let e: IRExpr;
      if (fn) {
        let idx = hid.findIndex((x) => keyOf(x.input, x.space) === k);
        if (idx < 0) {
          hid.push(h);
          idx = hid.length - 1;
        }
        e = { op: "param", ty: h.ty, index: fn.params.length + idx };
      } else e = { op: "input", ty: h.ty, input: h.input, ...(h.space ? { space: h.space } : {}) };
      out.push(e);
      provided.set(k, out.length - 1);
      return out.length - 1;
    };
    exprs.forEach((e, i) => {
      let n: IRExpr;
      if (e.op === "input") {
        map[i] = provide({ input: e.input, ...(e.space ? { space: e.space } : {}), ty: e.ty });
        return;
      }
      if (e.op === "call") {
        const args = e.args.map((a) => map[a]!);
        const extra = (hidden.get(e.fn) ?? []).map(provide);
        n = { ...e, args: [...args, ...extra] };
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
      params: [...f.params, ...r.hid.map((h) => ({ name: hiddenParamName(h), ty: h.ty }))],
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
