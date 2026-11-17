import { AlertTriangle, Flame, Gauge, XCircle } from "lucide-react";
import { BUDGET_PRESETS, type BudgetProblem, type FixId, defaultNodeRegistry } from "@/core";
import { Button, Select } from "@/ui";
import { focusNode } from "@/ui/graph/actions";
import { setSelection } from "@/ui/graph/graphStore";
import { applyQuickFix, useBudget, useBudgetUi } from "./budget";
import { useProUi } from "./proState";

/** Quick-fix buttons: unbuilt fixes are rendered disabled with the reason as tooltip. */
export function FixButtons({ problem }: { problem: BudgetProblem }) {
  return (
    <div className="kk-pro__fixes">
      {problem.fixes.map((f) => (
        <Button
          key={f.id}
          size="sm"
          disabled={!f.available}
          title={f.available ? f.label : f.reason}
          onClick={() => applyQuickFix(f.id as FixId)}
        >
          {f.label}
        </Button>
      ))}
    </div>
  );
}

/** Budget meters (green / yellow / red), preset selector, heatmap toggle, hottest nodes and the Optimization-report entry. */
export function BudgetSection() {
  const { analysis, graph, preset } = useBudget();
  const heat = useBudgetUi((s) => s.heatmap);
  if (!analysis || !graph) return null;
  const hot = Object.entries(analysis.cost.perNode)
    .sort((a, b) => b[1].cost - a[1].cost)
    .slice(0, 5);
  return (
    <div data-kk="budget">
      <h3>
        <Gauge size={14} /> Budget
      </h3>
      <div className="kk-pro__row" style={{ gridTemplateColumns: "1fr auto auto" }}>
        <Select<string>
          value={preset}
          options={BUDGET_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
          aria-label="Budget preset"
          onChange={(v) => useBudgetUi.getState().set({ preset: v as typeof preset })}
        />
        <Button
          size="sm"
          icon={Flame}
          variant={heat ? "primary" : "secondary"}
          title="Tint every node by its share of the fragment cost"
          onClick={() => useBudgetUi.getState().set({ heatmap: !heat })}
        >
          Heatmap
        </Button>
        <Button size="sm" onClick={() => useProUi.getState().set({ optReportOpen: true })}>
          Optimization report…
        </Button>
      </div>
      {analysis.rows.map((r) => (
        <div
          key={r.metric}
          className="kk-meter"
          data-status={r.status}
          data-metric={r.metric}
          title={`${r.value} of ${r.limit} (${Math.round(r.ratio * 100)} %)`}
        >
          <span className="kk-meter__label">{r.label}</span>
          <span className="kk-meter__bar">
            <i style={{ width: `${Math.min(100, r.ratio * 100)}%` }} />
          </span>
          <span className="kk-meter__value">
            {r.value} / {r.limit}
          </span>
        </div>
      ))}
      {analysis.problems.map((p) => (
        <div key={p.metric} className="kk-pro__hint" data-sev={p.severity === "error" ? "warning" : "info"}>
          {p.severity === "error" ? <XCircle size={14} /> : <AlertTriangle size={14} />}
          <div>
            <div>{p.message}</div>
            <FixButtons problem={p} />
          </div>
        </div>
      ))}
      {hot.length > 0 && (
        <>
          <div className="kk-pro__muted" style={{ marginTop: 4 }}>
            Most expensive nodes ({analysis.cost.cls} model)
          </div>
          {hot.map(([id, c]) => (
            <button
              key={id}
              type="button"
              className="kk-pro__hotrow"
              onClick={() => {
                setSelection([id]);
                focusNode(id);
              }}
            >
              <span>
                {graph.nodes[id]?.label || defaultNodeRegistry.get(graph.nodes[id]?.defId ?? "")?.name || id}
                {c.copies >= 3 && <b> ×{c.copies}</b>}
              </span>
              <span>{Math.round(c.cost * 10) / 10}</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
