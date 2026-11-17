import type { SceneTarget } from "../engine/targets";
import { compileGraph } from "../compile/pipeline";
import type { Graph } from "../graph/types";
import { budgetPreset, evaluateBudget, type BudgetRow } from "../stats/budgets";
import { costModule } from "../stats/cost";
import type { BudgetClass } from "./meta";

/** Budget preset each declared class is held to (Mobile = "Mobile — High" limits; Desktop = "High-end", which still rejects genuinely heavy shaders). */
const BUDGET_OF_CLASS = { Mobile: "mobile-high", Desktop: "high-end" } as const;

/** Scene-target family of a profile id (the Preview's "follow target" default). */
export const sampleSceneTarget = (profileId: string): SceneTarget => (profileId.startsWith("unity.") ? "unity" : profileId.startsWith("godot.") ? "godot" : "glsl");

/** Estimated cost (10d model, optimised IR) vs the sample's declared budget class. `problems` = rows over their limit. */
export function sampleBudget(graph: Graph, cls: BudgetClass): { rows: BudgetRow[]; problems: string[] } {
  const r = compileGraph(graph, { skipEmit: true, purpose: "preview", isPreview: true, optimize: 2, sceneTarget: sampleSceneTarget(graph.profileId) });
  if (!r.module) return { rows: [], problems: ["no module to cost"] };
  const rows = evaluateBudget(costModule(r.module, cls === "Mobile" ? "mobile" : "desktop"), budgetPreset(BUDGET_OF_CLASS[cls]));
  return { rows, problems: rows.filter((x) => x.status === "bad").map((x) => `${x.label}: ${x.value} exceeds the ${cls} budget (${x.limit})`) };
}
