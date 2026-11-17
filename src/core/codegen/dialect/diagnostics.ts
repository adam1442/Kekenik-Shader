import { type Diagnostic, makeDiagnostic } from "../../diagnostics";
import { type ExprId, type IRModule, type SourceRef, sourceKey } from "../../ir/types";

/** An IR construct a backend cannot spell (recorded while emitting; generation continues with a typed placeholder). */
export interface UnsupportedNote {
  message: string;
  ref?: SourceRef;
}

/** Record an unsupported construct of body `bodyId`, attributing it to the originating node through the source map. */
export function noteUnsupported(
  list: UnsupportedNote[],
  module: IRModule,
  message: string,
  bodyId: string,
  id: ExprId,
): void {
  const ref = module.sourceMap[sourceKey(bodyId, id)];
  list.push({ message, ...(ref ? { ref } : {}) });
}

/** Warnings (lossy conversions) + unsupported constructs (node-level errors) of one generation run. */
export function backendDiagnostics(
  warnings: Iterable<string>,
  unsupported: readonly UnsupportedNote[],
  displayName: string,
  unsupportedAsWarning = false,
): Diagnostic[] {
  return [
    ...[...warnings].map((m) => makeDiagnostic("W_LOSSY_CONVERSION", m)),
    ...unsupported.map((u) =>
      makeDiagnostic(
        unsupportedAsWarning ? "W_PREVIEW_NOT_EMULATED" : "E_NODE_UNSUPPORTED_TARGET",
        unsupportedAsWarning
          ? `${u.message} — the preview uses a neutral value (export is unaffected)`
          : `${u.message} (${displayName})`,
        u.ref
          ? {
              nodeId: u.ref.nodeId,
              ...(u.ref.portId ? { portId: u.ref.portId } : {}),
              ...(u.ref.scope ? { scope: u.ref.scope } : {}),
            }
          : {},
      ),
    ),
  ];
}
