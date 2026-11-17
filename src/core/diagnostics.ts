import type { GraphOp } from "./graph/ops/types";

type Severity = "error" | "warning" | "info";

/** Every diagnostic code the core can emit, with its default severity. */
const DIAGNOSTIC_SEVERITY = {
  E_UNKNOWN_NODE_DEF: "error",
  E_UNKNOWN_PORT: "error",
  E_CYCLE: "error",
  E_MISSING_INPUT: "error",
  E_ILLEGAL_CONVERSION: "error",
  E_INVALID_VALUE: "error",
  E_DUPLICATE_NAME: "error",
  E_PORTAL_UNRESOLVED: "error",
  E_PORTAL_DUPLICATE: "error",
  E_STAGE_VIOLATION: "error",
  E_NO_MASTER: "error",
  E_MULTIPLE_MASTER: "error",
  E_UNKNOWN_PROPERTY: "error",
  E_UNKNOWN_KEYWORD: "error",
  E_UNKNOWN_SUBGRAPH: "error",
  E_UNKNOWN_PROFILE: "error",
  E_MISSING_REQUIRED_OUTPUT: "error",
  E_SUBGRAPH_RECURSION: "error",
  E_NODE_UNSUPPORTED_TARGET: "error",
  E_BUILD_FAILED: "error",
  E_BACKEND_FAILED: "error",
  W_LOSSY_CONVERSION: "warning",
  W_SPACE_MISMATCH: "warning",
  W_PORTAL_NO_INPUT: "warning",
  /** Height To Normal: the connected Height does not depend on the UV coordinate, so the normal is flat . */
  W_HEIGHT_NORMAL_NO_DEPENDENCY: "warning",
  /** Height To Normal: re-evaluating the Height network is expensive (cone larger than the guard); the message carries the ×N cost. */
  W_HEIGHT_NORMAL_COST: "warning",
  /** Custom Interpolator: the connected expression is not affine, so per-vertex evaluation differs from per-pixel . */
  W_INTERPOLATOR_NON_AFFINE: "warning",
  /** Preview purpose only: the node reads an engine intrinsic the preview cannot emulate; a neutral value is used (never blocks export). */
  W_PREVIEW_NOT_EMULATED: "warning",
} as const satisfies Record<string, Severity>;

export type DiagnosticCode = keyof typeof DIAGNOSTIC_SEVERITY;
export const DIAGNOSTIC_CODES = Object.keys(DIAGNOSTIC_SEVERITY) as DiagnosticCode[];

interface QuickFix {
  label: string;
  /** Applying this operation (via applyOperation) resolves the diagnostic. */
  operation: GraphOp;
}

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  message: string;
  nodeId?: string;
  portId?: string;
  /** Subgraph id when the issue is inside a subgraph definition. */
  scope?: string;
  edgeId?: string;
  quickFix?: QuickFix;
}

export type DiagnosticExtra = Partial<
  Pick<Diagnostic, "nodeId" | "portId" | "scope" | "edgeId" | "quickFix" | "severity">
>;

export function makeDiagnostic(code: DiagnosticCode, message: string, extra: DiagnosticExtra = {}): Diagnostic {
  return { code, severity: DIAGNOSTIC_SEVERITY[code], message, ...extra };
}

export const hasErrors = (ds: readonly Diagnostic[]): boolean => ds.some((d) => d.severity === "error");
