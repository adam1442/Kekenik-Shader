import { useMemo } from "react";
import { create } from "zustand";
import {
  type BudgetId,
  type BudgetProblem,
  getDefaultHoistMode,
  getDefaultOptLevel,
  type BudgetRow,
  type CostReport,
  type FixId,
  type Graph,
  budgetPreset,
  budgetProblems,
  compileGraph,
  costModule,
  defaultNodeRegistry,
  evaluateBudget,
  ops,
  planFix,
} from "@/core";
import { toast } from "@/ui";
import { setGraphSetting } from "@/ui/graph/actions";
import { commit, getActiveDoc, getActiveScope, useGraphs } from "@/ui/graph/graphStore";
import { applyBakeFix } from "./bakeActions";
import { usePrefs } from "../prefs/preferences";
import { useShader } from "../shaderStore";

interface BudgetUi {
  preset: BudgetId;
  heatmap: boolean;
  set: (p: Partial<Omit<BudgetUi, "set">>) => void;
}
const KEY = "kekenik.budget";
const load = (): Partial<BudgetUi> => {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "{}") as Partial<BudgetUi>;
  } catch {
    return {};
  }
};
/** Active performance-budget preset + heatmap toggle (persisted when storage is available, in memory otherwise). */
export const useBudgetUi = create<BudgetUi>((set, get) => ({
  preset: "desktop",
  heatmap: false,
  ...load(),
  set: (p) => {
    set(p);
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify({ preset: get().preset, heatmap: get().heatmap }));
    } catch {
      /* storage blocked */
    }
  },
}));

export interface BudgetAnalysis {
  cost: CostReport;
  rows: BudgetRow[];
  problems: BudgetProblem[];
}
const cache = new WeakMap<Graph, Map<string, BudgetAnalysis | null>>();

/** Cost model v2 + budget rows + Problems of a graph for a preset (compiled at the current default optimisation level; cached per graph object). */
export function analyzeBudget(graph: Graph, preset: BudgetId): BudgetAnalysis | null {
  const per = cache.get(graph) ?? new Map<string, BudgetAnalysis | null>();
  cache.set(graph, per);
  const key = `${preset}|o${getDefaultOptLevel()}|h${getDefaultHoistMode()}`;
  if (per.has(key)) return per.get(key)!;
  let out: BudgetAnalysis | null = null;
  try {
    const m = compileGraph(graph, { skipEmit: true }).module;
    if (m) {
      const p = budgetPreset(preset);
      const cost = costModule(m, p.cls);
      const rows = evaluateBudget(cost, p);
      out = { cost, rows, problems: budgetProblems(rows, p) };
    }
  } catch {
    out = null;
  }
  per.set(key, out);
  return out;
}

/** Hook: analysis of the active shader graph for the selected preset. */
export function useBudget(): { analysis: BudgetAnalysis | null; graph: Graph | undefined; preset: BudgetId } {
  useGraphs((s) => s.analysisGraph);
  const graph = useShader((s) => s.graph);
  const preset = useBudgetUi((s) => s.preset);
  const analysis = useMemo(() => (graph ? analyzeBudget(graph, preset) : null), [graph, preset]);
  return { analysis, graph: graph ?? undefined, preset };
}

/** Apply a quick fix to the active graph as ONE undo step. Returns the number of edited nodes. */
export function applyQuickFix(fix: FixId): number {
  if (fix === "hoist-vertex") return applyHoistFix();
  if (fix === "half-precision") return applyPrecisionFix();
  if (fix === "bake-texture") return applyBakeFix();
  const doc = getActiveDoc();
  if (!doc) return 0;
  if (getActiveScope() !== undefined) {
    toast.show({
      kind: "info",
      title: "Open the main graph",
      description: "Quick fixes edit the main graph, not a subgraph tab.",
    });
    return 0;
  }
  const nodes = Object.fromEntries(
    Object.entries(doc.graph.nodes).map(([id, n]) => {
      const defaults = Object.fromEntries(
        (defaultNodeRegistry.get(n.defId)?.params ?? []).map((p) => [p.id, p.default]),
      );
      return [id, { defId: n.defId, params: { ...defaults, ...n.params } as Record<string, unknown> }];
    }),
  );
  const edits = planFix(fix, nodes);
  if (edits.length === 0) {
    toast.show({
      kind: "info",
      title: "Nothing to change",
      description: "No node has a parameter this fix can lower.",
    });
    return 0;
  }
  commit(
    fix === "reduce-octaves" ? "Reduce FBM octaves" : "Use cheaper noise",
    edits.map(([id, p, v]) => ops.setParam(id, p, v)),
  );
  toast.show({
    kind: "success",
    title: fix === "reduce-octaves" ? "Octaves reduced" : "Switched to Value noise",
    description: `${edits.length} node(s) changed — Undo restores them.`,
  });
  return edits.length;
}

/** "Hoist to vertex" quick fix: raises the vertex-hoisting aggressiveness (Off → Conservative → Aggressive). A setting, not a graph edit — nothing to undo. */
function applyHoistFix(): number {
  const cur = getDefaultHoistMode();
  if (cur === "aggressive") {
    toast.show({
      kind: "info",
      title: "Already aggressive",
      description:
        "Vertex hoisting is at its highest level; the remaining expressions are not affine in the interpolated inputs.",
    });
    return 0;
  }
  const next = cur === "off" ? "conservative" : "aggressive";
  usePrefs.getState().set({ hoist: next });
  toast.show({
    kind: "success",
    title: `Vertex hoisting: ${next}`,
    description: "Affine per-pixel expressions are now evaluated per vertex (Preferences → Vertex hoisting).",
  });
  return 1;
}

/** "Enable half precision" quick fix: Full → Auto (proven-safe values only) → Half. A graph setting (one undo step). */
function applyPrecisionFix(): number {
  const g = useShader.getState().graph;
  const cur = g?.settings.precision === "half" ? "half" : g?.settings.precision === "auto" ? "auto" : "full";
  if (cur === "half") {
    toast.show({
      kind: "info",
      title: "Already Half",
      description:
        "Precision is at its lowest level; values with unbounded range, UV-for-sampling and derivative inputs always stay float.",
    });
    return 0;
  }
  const next = cur === "full" ? "auto" : "half";
  setGraphSetting("precision", next, "Enable half precision");
  toast.show({
    kind: "success",
    title: `Precision: ${next === "auto" ? "Auto" : "Half"}`,
    description:
      "Fragment temporaries with a proven small range are emitted as half / mediump / min16float (Graph → Precision). Undo restores it.",
  });
  return 1;
}
