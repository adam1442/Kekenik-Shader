import { useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { type Diagnostic, defaultNodeRegistry } from "@/core";
import { EmptyState, Tabs } from "@/ui";
import { focusNode } from "../actions";
import { jumpToHistory, useGraphs } from "../graphStore";
import { usePreview } from "@/preview/previewStore";
import { useProfileProblemList } from "./profileProblems";
import { useBudget } from "@/app/pro/budget";
import { FixButtons } from "@/app/pro/BudgetSection";

/** Node an entry belongs to (diagnostic on a wire → its target node). */
function diagnosticNode(d: Diagnostic): string | undefined {
  if (d.nodeId) return d.nodeId;
  if (d.edgeId) return d.edgeId.split(">")[1]?.split(":")[0];
  return undefined;
}

export function problemsText(list: readonly Diagnostic[]): string {
  return list.map((d) => `[${d.severity}] ${d.code}: ${d.message}${d.nodeId ? ` (node ${d.nodeId})` : ""}`).join("\n");
}

function Problems() {
  const analysis = useGraphs((s) => s.analysis);
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  const gpu = usePreview((s) => s.gpuDiagnostics);
  const list = [...(analysis?.diagnostics ?? []), ...gpu].filter((d) => d.severity !== "info");
  const profileList = useProfileProblemList().filter((p) => p.severity !== "info");
  const budget = useBudget().analysis?.problems ?? [];
  if (!graph) return <EmptyState title="No graph" description="Open a graph to see its problems." />;
  if (!list.length && !profileList.length && !budget.length)
    return <EmptyState icon={CheckCircle2} title="No problems" description="The graph analysed cleanly." />;
  return (
    <div data-testid="problems-list">
      {budget.map((p) => (
        <div key={`b${p.metric}`} className="kk-prob" data-sev={p.severity} data-code={`perf.${p.metric}`}>
          {p.severity === "error" ? <XCircle size={14} /> : <AlertTriangle size={14} />}
          <span className="kk-prob__msg">
            {p.message}
            <FixButtons problem={p} />
          </span>
          <span className="kk-prob__where">budget</span>
        </div>
      ))}
      {profileList.map((p, i) => (
        <button
          key={`p${i}`}
          type="button"
          className="kk-prob"
          data-sev={p.severity}
          data-code={p.rule}
          disabled={!p.nodeId || !graph.nodes[p.nodeId]}
          onClick={() => p.nodeId && focusNode(p.nodeId)}
          title={p.manual ? `Covered by manual check: ${p.manual}` : p.nodeId ? "Select node and frame it" : undefined}
        >
          {p.severity === "error" ? <XCircle size={14} /> : <AlertTriangle size={14} />}
          <span className="kk-prob__msg">{p.message}</span>
          <span className="kk-prob__where">{p.rule}</span>
        </button>
      ))}
      {list.map((d, i) => {
        const id = diagnosticNode(d);
        const n = id ? graph.nodes[id] : undefined;
        const where = n
          ? n.label || defaultNodeRegistry.get(n.defId)?.name || n.defId
          : d.scope
            ? `subgraph ${d.scope}`
            : "graph";
        return (
          <button
            key={i}
            type="button"
            className="kk-prob"
            data-sev={d.severity}
            data-code={d.code}
            disabled={!n}
            onClick={() => id && focusNode(id)}
            title={n ? "Select node and frame it" : undefined}
          >
            {d.severity === "error" ? <XCircle size={14} /> : <AlertTriangle size={14} />}
            <span className="kk-prob__msg">{d.message}</span>
            <span className="kk-prob__where">{where}</span>
          </button>
        );
      })}
    </div>
  );
}

function History() {
  const doc = useGraphs((s) => s.docs.find((d) => d.id === s.activeId));
  if (!doc) return <EmptyState title="No graph" description="Open a graph to see its history." />;
  const all = [...doc.undo, ...[...doc.redo].reverse()];
  const cur = doc.undo.length;
  const fmt = (t: number) =>
    new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return (
    <div data-testid="history-list">
      <button type="button" className={`kk-hist${cur === 0 ? " is-current" : ""}`} onClick={() => jumpToHistory(0)}>
        Original
      </button>
      {all.map((h, i) => (
        <button
          key={i}
          type="button"
          data-hist-index={i}
          className={`kk-hist${i + 1 === cur ? " is-current" : ""}${i >= cur ? " is-undone" : ""}`}
          onClick={() => jumpToHistory(i + 1)}
        >
          {h.label}
          <time>{fmt(h.time)}</time>
        </button>
      ))}
    </div>
  );
}

/** Problems (click ⇒ select + frame the node) and the undo History list. */
export function ProblemsPanel() {
  const [tab, setTab] = useState("problems");
  const gpuCount = usePreview((s) => s.gpuDiagnostics.length);
  const profileCount = useProfileProblemList().filter((p) => p.severity !== "info").length;
  const count =
    useGraphs((s) => (s.analysis?.diagnostics ?? []).filter((d) => d.severity !== "info").length) +
    gpuCount +
    profileCount +
    (useBudget().analysis?.problems.length ?? 0);
  const hist = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.undo.length ?? 0);
  return (
    <div className="kk-gp">
      <div className="kk-gp__bar" style={{ padding: "0 8px" }}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { id: "problems", label: `Problems${count ? ` (${count})` : ""}` },
            { id: "history", label: `History${hist ? ` (${hist})` : ""}` },
          ]}
        />
      </div>
      <div className="kk-gp__scroll">{tab === "problems" ? <Problems /> : <History />}</div>
    </div>
  );
}
