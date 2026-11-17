import { useMemo } from "react";
import { AlertTriangle, Info } from "lucide-react";
import {
  type CompileResult,
  analyzeModule,
  compileForTarget,
  compileGodot,
  compileGraph,
  compileUnity,
  defaultNodeRegistry,
  getDefaultOptLevel,
} from "@/core";
import { EmptyState } from "@/ui";
import { focusNode } from "@/ui/graph/actions";
import { setSelection, useGraphs } from "@/ui/graph/graphStore";
import { useShader } from "../shaderStore";
import { BudgetSection } from "./BudgetSection";

interface Row {
  target: string;
  ok: boolean;
  lines: number;
  statements: number;
  note: string;
}

const textOf = (r: CompileResult): string => r.files.map((f) => f.content).join("\n");
const row = (target: string, r: CompileResult, text: string): Row => ({
  target,
  ok: r.ok,
  lines: text ? text.split("\n").length : 0,
  statements: (text.match(/;\s*$/gm) ?? []).length,
  note: r.ok ? "" : (r.diagnostics.find((d) => d.severity === "error")?.message.slice(0, 70) ?? "error"),
});

/** Statistics + hints for the active graph (IR estimates; per-target rows are real generated-text counts). */
export function StatsPanel() {
  useGraphs((s) => s.analysisGraph);
  const graph = useShader((s) => s.graph);
  const data = useMemo(() => {
    if (!graph) return null;
    const lvl = getDefaultOptLevel();
    const base = compileGraph(graph, { skipEmit: true });
    if (!base.module)
      return {
        err: base.diagnostics.filter((d) => d.severity === "error")[0]?.message ?? "The graph does not compile yet.",
      };
    const stats = analyzeModule(base.module, { defIdOf: (id) => graph.nodes[id]?.defId, optimized: lvl > 0 });
    const raw = lvl > 0 ? compileGraph(graph, { skipEmit: true, optimize: 0 }).module : undefined;
    const rows: Row[] = [];
    for (const t of ["glsl", "hlsl", "wgsl"] as const) {
      const r = compileForTarget(graph, t);
      rows.push(row(t.toUpperCase(), r, textOf(r)));
    }
    if (graph.profileId.startsWith("unity.")) {
      const c = compileUnity(graph);
      rows.push(row("Unity URP", c.result, c.text));
    }
    if (graph.profileId.startsWith("godot.")) {
      const c = compileGodot(graph);
      rows.push(row("Godot 4", c.result, c.text));
    }
    return { stats, rows, before: raw?.main.exprs.length, after: base.module.main.exprs.length, lvl };
  }, [graph]);

  if (!graph) return <EmptyState title="No graph" description="Open or create a graph to see statistics." />;
  if (!data || "err" in data)
    return <EmptyState title="No statistics yet" description={data && "err" in data ? (data.err ?? "") : ""} />;
  const { stats: s, rows } = data;
  const card = (label: string, v: string | number) => (
    <div className="kk-pro__card">
      <b>{v}</b>
      <span>{label}</span>
    </div>
  );
  return (
    <div className="kk-pro" data-kk="stats-panel">
      <div className="kk-pro__grid">
        {card("fragment ALU (est.)", s.fragment.instructions)}
        {card("vertex ALU (est.)", s.vertex.instructions)}
        {card("texture samples", s.fragment.textureSamples + s.vertex.textureSamples)}
        {card("interpolators (est.)", s.interpolators)}
        {card("uniforms", s.uniforms.count)}
        {card("vec4 slots", s.uniforms.vec4Slots)}
        {card("custom functions", s.customFunctions)}
        {data.before !== undefined
          ? card(`IR exprs (opt L${data.lvl})`, `${data.before} → ${data.after}`)
          : card("IR exprs (opt off)", data.after)}
      </div>
      <BudgetSection />
      <h3>Hints</h3>
      {s.hints.length === 0 && <div className="kk-pro__muted">No hints — nothing suspicious found.</div>}
      {s.hints.map((h, i) => (
        <div
          key={i}
          className="kk-pro__hint"
          data-sev={h.severity}
          data-clickable={h.nodeIds.length > 0}
          onClick={() => {
            if (h.nodeIds.length) {
              setSelection(h.nodeIds);
              focusNode(h.nodeIds[0]!);
            }
          }}
          title={h.nodeIds.length ? "Select the nodes involved" : undefined}
        >
          {h.severity === "warning" ? <AlertTriangle size={14} /> : <Info size={14} />}
          <span>
            {h.message}
            {h.nodeIds.length > 0 && (
              <>
                {" "}
                <span className="kk-pro__muted">
                  (
                  {h.nodeIds
                    .map((n) => defaultNodeRegistry.get(graph.nodes[n]?.defId ?? "")?.name ?? n)
                    .slice(0, 3)
                    .join(", ")}
                  )
                </span>
              </>
            )}
          </span>
        </div>
      ))}
      <h3>Per target (generated text)</h3>
      <table className="kk-pro__table">
        <thead>
          <tr>
            <th>Target</th>
            <th>Lines</th>
            <th>Statements</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.target}>
              <td>{r.target}</td>
              <td>{r.lines}</td>
              <td>{r.statements}</td>
              <td className={r.ok ? "kk-pro__muted" : "kk-pro__warn"}>{r.ok ? "ok" : r.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="kk-pro__muted">
        ALU / interpolator numbers are static estimates from the IR (not a GPU profiler). Statements are counted in the
        emitted text.
      </div>
    </div>
  );
}
