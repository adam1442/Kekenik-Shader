import { useEffect } from "react";
import { defaultNodeRegistry } from "@/core";
import { useGraphs } from "@/ui/graph/graphStore";
import { useShader } from "../shaderStore";
import { analyzeBudget, useBudgetUi } from "./budget";

const ATTRS = ["data-heat", "data-heat-label", "title"];

/**
 * Cost heatmap (O1). Tints every graph node by its share of the cost (green → red) and shows a badge ("12.4", "×5" for cloned cones)
 * by setting attributes on the node elements; CSS (`pro.css`) does the rest. Imperative on purpose: node cards are memoised React
 * elements and must not re-render because of a debug overlay. Re-applied on an interval because culled nodes are re-created on pan.
 */
export function HeatmapDriver() {
  const on = useBudgetUi((s) => s.heatmap);
  const preset = useBudgetUi((s) => s.preset);
  const graph = useShader((s) => s.graph);
  useGraphs((s) => s.analysisGraph);
  useEffect(() => {
    if (!on || !graph) return;
    const a = analyzeBudget(graph, preset);
    if (!a) return;
    const entries = Object.entries(a.cost.perNode);
    const max = Math.max(1e-9, ...entries.map(([, c]) => c.cost));
    const apply = (): void => {
      for (const [id, c] of entries) {
        const el = document.querySelector<HTMLElement>(`.kk-node[data-node-id="${CSS.escape(id)}"]`);
        if (!el || el.dataset.heatApplied === `${c.cost}`) continue;
        const r = c.cost / max;
        el.dataset.heat = r > 0.66 ? "high" : r > 0.33 ? "mid" : "low";
        el.dataset.heatLabel = `${Math.round(c.cost * 10) / 10}${c.copies >= 3 ? ` ×${c.copies}` : ""}`;
        el.dataset.heatApplied = `${c.cost}`;
        el.style.setProperty("--kk-heat", String(r));
        const name = graph.nodes[id]?.label || defaultNodeRegistry.get(graph.nodes[id]?.defId ?? "")?.name || id;
        el.title = `${name}: ${Math.round(c.cost * 10) / 10} ALU-eq. (${Math.round(r * 100)} % of the hottest node) · ${c.samples} texture sample(s)${c.copies >= 3 ? ` · repeated ×${c.copies} (cloned cone / unrolled loop)` : ""}`;
      }
    };
    apply();
    const t = window.setInterval(apply, 300);
    return () => {
      window.clearInterval(t);
      document.querySelectorAll<HTMLElement>(".kk-node[data-heat]").forEach((el) => {
        for (const k of ATTRS) el.removeAttribute(k);
        delete el.dataset.heatApplied;
        el.style.removeProperty("--kk-heat");
      });
    };
  }, [on, graph, preset]);
  return null;
}
