/**
 * Kekenik Shader core — public API. Pure TypeScript (no React / DOM / Three.js / dockview).
 * UI code imports from "@/core" only; nothing in `src/core` may import from outside `src/core`.
 */
export const CORE_VERSION = "0.2.0";

export * from "./types/shaderType";
export * from "./types/semantics";
export * from "./types/conversion";
export * from "./types/generics";

export * from "./ir/types";
export * from "./ir/intrinsics";
export * from "./ir/inputs";
export * from "./ir/builder";
export * from "./ir/convert";
export * from "./ir/stages";
export * from "./ir/printer";
export * from "./ir/eval";
export * from "./ir/traits";
export { reachableMask } from "./ir/walk";
export * from "./properties/model";
export * from "./properties/names";
export * from "./properties/manifest";
export * from "./properties/refNames";
export * from "./properties/keywords";
export * from "./properties/usage";
export * from "./properties/materialManifest";
export * from "./properties/materialValues";

export * from "./graph/types";
export * from "./graph/create";
export * from "./graph/query";
export * from "./graph/flatten";
export * from "./graph/cycles";
export * from "./graph/subgraph";
export * from "./graph/history";
export * from "./graph/ops/types";
export * from "./graph/ops/apply";
export * from "./graph/ops/make";

export * from "./registry/nodeDef";
export * from "./registry/profile";
export * from "./registry/registry";

export * from "./diagnostics";
export * from "./compile/backend";
export * from "./compile/pipeline";
export * from "./compile/nodeOverrides";
export { coerceValue } from "./compile/values";
export * from "./backends/irPrinter";

export * from "./nodes";
export * from "./profiles";

export * from "./serialization/stable";
export * from "./serialization/migrations";
export * from "./serialization/schema";
export * from "./serialization/kshader";
export * from "./serialization/embed";
export * as values from "./values";
export * from "./codegen";
export { SAMPLE_GRAPHS } from "./samples/index";
export * from "./graph/zero";
export * from "./graph/portals";
export * from "./graph/subgraphOps";
export * from "./graph/subgraphIo";
export * from "./graph/subgraphPreview";
// scene information nodes, engine built-in mapping, target conventions, depth maths
export { TARGET_LABEL } from "./engine/targets";
export * as depthMath from "./engine/depth";

// ── : profile framework, Unity URP backend, export registry ──────────────────────────────
export * from "./profiles";
export * from "./codegen/unity";
export * from "./codegen/unity/data/manualChecks";
export { exposeKey, UNITY_VERSIONS } from "./profiles/unity/options";
export * from "./codegen/godot";
export * from "./export/registry";
export * from "./export/bundle";

export * from "./opt";
export * from "./custom";
export * from "./layout";
export * from "./stats";
export { costModule, type CostReport } from "./stats/cost";
export {
  BUDGET_PRESETS,
  budgetPreset,
  budgetProblems,
  evaluateBudget,
  planFix,
  type BudgetId,
  type BudgetProblem,
  type BudgetRow,
  type FixId,
} from "./stats/budgets";
export { diffLines, diffStats } from "./stats/lineDiff";
export { buildOptimizationReport, targetText, type OptimizationReport } from "./stats/optReport";
export * from "./profiles/templates";
export * from "./profiles/family";
export * from "./serialization/previewSection";
export * from "./bake/records";
export * from "./samples/meta";
export * from "./samples/filter";
export * from "./samples/bundle";
export * from "./samples/budget";
