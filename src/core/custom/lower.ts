import { type Diagnostic, makeDiagnostic } from "../diagnostics";
import type { BackendId, IRBody, IRFunction, IRModule } from "../ir/types";
import { MAIN_BODY, sourceKey } from "../ir/types";
import { CUSTOM_TARGETS, CUSTOM_TARGET_LABEL, type CustomTarget } from "./spec";

const isCustomTarget = (b: BackendId): b is CustomTarget => (CUSTOM_TARGETS as readonly string[]).includes(b);

/**
 * Lower `custom` IR ops (Custom Function nodes) to calls of native-bodied IR functions for `backend`.
 * A block without a body for the backend is an error on the node (E_NODE_UNSUPPORTED_TARGET). The IR printer ("ir") keeps `custom`.
 */
export function lowerCustomBlocks(
  module: IRModule,
  backend: BackendId,
): { module: IRModule; diagnostics: Diagnostic[] } {
  if (module.customBlocks.length === 0 || !isCustomTarget(backend)) return { module, diagnostics: [] };
  const diagnostics: Diagnostic[] = [];
  const blocks = new Map(module.customBlocks.map((b) => [b.id, b]));
  const used = new Set<string>();
  const reported = new Set<string>();
  const rewrite = (body: IRBody, bodyId: string): IRBody => ({
    exprs: body.exprs.map((e, id) => {
      if (e.op !== "custom") return e;
      const blk = blocks.get(e.block)!;
      used.add(e.block);
      if (blk.code[backend] === undefined && !reported.has(e.block)) {
        reported.add(e.block);
        const src = module.sourceMap[sourceKey(bodyId, id)];
        diagnostics.push(
          makeDiagnostic(
            "E_NODE_UNSUPPORTED_TARGET",
            `Custom function "${blk.name}" has no ${CUSTOM_TARGET_LABEL[backend]} body`,
            src ? { nodeId: src.nodeId, ...(src.scope ? { scope: src.scope } : {}) } : {},
          ),
        );
      }
      return { op: "call", ty: e.ty, fn: e.block, args: e.args, index: e.index };
    }),
  });
  const functions = module.functions.map((f) => ({ ...f, body: rewrite(f.body, f.id) }));
  const main = rewrite(module.main, MAIN_BODY);
  const seenIncludes = new Set<string>();
  const natives: IRFunction[] = module.customBlocks
    .filter((b) => used.has(b.id))
    .map((b) => {
      const inc = b.include?.[backend];
      const first = inc !== undefined && !seenIncludes.has(inc); // one `#include` per file, however many nodes use it
      if (inc !== undefined) seenIncludes.add(inc);
      // File mode: the wrapper must not share the external function's name.
      return {
        id: b.id,
        name: inc !== undefined ? `${b.name}_ks` : b.name,
        params: b.inputs,
        returns: b.outputs,
        body: { exprs: [] },
        ret: [],
        native: b.code[backend] ?? "",
        ...(first ? { include: inc } : {}),
      };
    });
  return { module: { ...module, functions: [...natives, ...functions], main }, diagnostics };
}
