import { builtinById } from "../engine/builtinMap";
import { BUILTIN_INPUTS } from "./inputs";
import { type ExprId, type IRBody, type IRExpr, type IRModule, type Stage, MAIN_BODY } from "./types";
import { reachableMask } from "./walk";

/**
 * Stage-legality rules:
 *  - implicit-LOD texture sampling and derivatives exist only in the FRAGMENT stage
 *  - inputs declare their own stage (e.g. screenPos/faceSign fragment-only, vertexId vertex-only)
 *  - a function call inherits the requirements of everything its body uses
 */
export const FRAGMENT_BIT = 1;
const VERTEX_BIT = 2;
/** Light-stage-only data (Godot `light()` built-ins: `ks.lightstage.*`). Legal only for outputs of the `light` stage. */
const LIGHT_BIT = 4;

export interface StageViolation {
  bodyId: string;
  exprId: ExprId;
  slot: string;
  stage: Stage;
  reason: string;
}

function ownBits(e: IRExpr, fnBits: (fn: string) => number): number {
  switch (e.op) {
    case "sample":
      return e.mode === "implicit" ? FRAGMENT_BIT : 0;
    case "deriv":
      return FRAGMENT_BIT;
    case "input": {
      const s = BUILTIN_INPUTS[e.input].stage;
      return s === "fragment" ? FRAGMENT_BIT : s === "vertex" ? VERTEX_BIT : 0;
    }
    case "call":
      return fnBits(e.fn);
    case "engine":
      return builtinById(e.name)?.stage === "light" ? LIGHT_BIT : 0;
    default:
      return 0;
  }
}

function describeExpr(e: IRExpr): string {
  switch (e.op) {
    case "sample":
      return "implicit-LOD texture sampling";
    case "deriv":
      return `derivative (${e.kind})`;
    case "input":
      return `input "${e.input}"`;
    case "call":
      return `call to subgraph function "${e.fn}"`;
    case "engine":
      return `light-stage built-in "${e.name}"`;
    default:
      return e.op;
  }
}

/** Stage bits required by everything reachable from `roots` of a body. */
export function bodyStageBits(body: IRBody, roots: readonly ExprId[], fnBits: (fn: string) => number): number {
  const mark = reachableMask(body, roots);
  let bits = 0;
  body.exprs.forEach((e, i) => {
    if (mark[i]) bits |= ownBits(e, fnBits);
  });
  return bits;
}

/** Find every expression that is illegal for the stage of the output it feeds. */
export function checkStageLegality(module: IRModule): StageViolation[] {
  const memo = new Map<string, number>();
  const fns = new Map(module.functions.map((f) => [f.id, f]));
  const fnBits = (id: string): number => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    const f = fns.get(id);
    memo.set(id, 0); // recursion guard (recursion is rejected elsewhere)
    const bits = f ? bodyStageBits(f.body, f.ret, fnBits) : 0;
    memo.set(id, bits);
    return bits;
  };
  const out: StageViolation[] = [];
  for (const o of module.outputs) {
    const forbidden =
      o.stage === "vertex" ? FRAGMENT_BIT | LIGHT_BIT : o.stage === "fragment" ? VERTEX_BIT | LIGHT_BIT : VERTEX_BIT;
    const mark = reachableMask(module.main, [o.value]);
    module.main.exprs.forEach((e, i) => {
      if (!mark[i] || !(ownBits(e, fnBits) & forbidden)) return;
      out.push({
        bodyId: MAIN_BODY,
        exprId: i,
        slot: o.slot,
        stage: o.stage,
        reason: `${describeExpr(e)} is not available in the ${o.stage} stage (output "${o.slot}")`,
      });
    });
  }
  return out;
}
