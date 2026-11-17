import type { CostClass, CostReport } from "./cost";

/** Performance budgets . Numbers are rules of thumb for the *static* cost model, not guarantees. */
export type BudgetId = "mobile-low" | "mobile-high" | "desktop" | "high-end";
type BudgetMetric = "alu" | "samples" | "interpolators" | "uniforms" | "registers";
type BudgetStatus = "ok" | "warn" | "bad";

export interface BudgetPreset {
  id: BudgetId;
  name: string;
  /** Cost-model class used to evaluate this preset. */
  cls: CostClass;
  limits: Readonly<Record<BudgetMetric, number>>;
}

export const BUDGET_PRESETS: readonly BudgetPreset[] = [
  {
    id: "mobile-low",
    name: "Mobile — Low",
    cls: "mobile",
    limits: { alu: 90, samples: 3, interpolators: 4, uniforms: 24, registers: 8 },
  },
  {
    id: "mobile-high",
    name: "Mobile — High",
    cls: "mobile",
    limits: { alu: 220, samples: 6, interpolators: 6, uniforms: 48, registers: 12 },
  },
  {
    id: "desktop",
    name: "Desktop",
    cls: "desktop",
    limits: { alu: 400, samples: 12, interpolators: 8, uniforms: 96, registers: 24 },
  },
  {
    id: "high-end",
    name: "High-end",
    cls: "desktop",
    limits: { alu: 1200, samples: 32, interpolators: 12, uniforms: 192, registers: 48 },
  },
];
export const budgetPreset = (id: BudgetId): BudgetPreset => BUDGET_PRESETS.find((p) => p.id === id)!;

const METRIC_LABEL: Readonly<Record<BudgetMetric, string>> = {
  alu: "Fragment cost (ALU-eq.)",
  samples: "Texture samples",
  interpolators: "Interpolators (vec4, packed)",
  uniforms: "Uniforms (vec4)",
  registers: "Registers (vec4, peak live)",
};

export interface BudgetRow {
  metric: BudgetMetric;
  label: string;
  value: number;
  limit: number;
  ratio: number;
  status: BudgetStatus;
}

/** Yellow from 75 % of the limit, red above 100 %. */
const statusOf = (ratio: number): BudgetStatus => (ratio > 1 ? "bad" : ratio >= 0.75 ? "warn" : "ok");

export function evaluateBudget(cost: CostReport, preset: BudgetPreset): BudgetRow[] {
  const values: Record<BudgetMetric, number> = {
    alu: cost.fragment.cost,
    samples: cost.fragment.samples,
    interpolators: cost.interpolators.vec4Slots,
    uniforms: cost.uniformSlots,
    registers: cost.fragment.registers,
  };
  return (Object.keys(values) as BudgetMetric[]).map((metric) => {
    const limit = preset.limits[metric];
    const ratio = limit > 0 ? values[metric] / limit : 0;
    return {
      metric,
      label: METRIC_LABEL[metric],
      value: Math.round(values[metric] * 10) / 10,
      limit,
      ratio,
      status: statusOf(ratio),
    };
  });
}

/** Quick fixes offered for an exceeded budget. `available:false` entries are shown disabled with the reason (feature not built yet). */
export type FixId = "reduce-octaves" | "cheaper-noise" | "half-precision" | "hoist-vertex" | "bake-texture";
interface QuickFix {
  id: FixId;
  label: string;
  available: boolean;
  reason?: string;
}
const QUICK_FIXES: Readonly<Record<FixId, QuickFix>> = {
  "reduce-octaves": { id: "reduce-octaves", label: "Reduce FBM octaves", available: true },
  "cheaper-noise": { id: "cheaper-noise", label: "Use cheaper noise (Value basis)", available: true },
  "half-precision": { id: "half-precision", label: "Enable half precision (Auto)", available: true },
  "hoist-vertex": { id: "hoist-vertex", label: "Hoist to vertex", available: true },
  "bake-texture": { id: "bake-texture", label: "Bake node to texture…", available: true },
};

export interface BudgetProblem {
  metric: BudgetMetric;
  severity: "warning" | "error";
  message: string;
  fixes: QuickFix[];
}

const FIXES_FOR: Readonly<Record<BudgetMetric, FixId[]>> = {
  alu: ["reduce-octaves", "cheaper-noise", "half-precision", "hoist-vertex", "bake-texture"],
  samples: ["bake-texture"],
  interpolators: ["hoist-vertex"],
  uniforms: [],
  registers: ["reduce-octaves", "half-precision"],
};

/** Problems-panel entries for every exceeded (red) or nearly exceeded (yellow) budget row. */
export function budgetProblems(rows: readonly BudgetRow[], preset: BudgetPreset): BudgetProblem[] {
  return rows
    .filter((r) => r.status !== "ok")
    .map((r) => ({
      metric: r.metric,
      severity: r.status === "bad" ? "error" : "warning",
      message: `${r.label}: ${r.value} / ${r.limit} (${preset.name}${r.status === "bad" ? " — over budget" : " — close to the limit"})`,
      fixes: FIXES_FOR[r.metric].map((id) => QUICK_FIXES[id]),
    }));
}

/** Parameter edits that implement a quick fix on a graph: `[nodeId, param, value]`. Pure; the UI applies them as ONE undo step. */
export function planFix(
  fix: FixId,
  nodes: Readonly<Record<string, { defId: string; params: Record<string, unknown> }>>,
): Array<[string, string, number | string]> {
  const out: Array<[string, string, number | string]> = [];
  for (const [id, n] of Object.entries(nodes)) {
    if (fix === "reduce-octaves" && typeof n.params.octaves === "number" && n.params.octaves > 1)
      out.push([id, "octaves", Math.max(1, Math.ceil(n.params.octaves / 2))]);
    if (fix === "cheaper-noise" && "basis" in n.params && n.params.basis !== "value") out.push([id, "basis", "value"]);
  }
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}
