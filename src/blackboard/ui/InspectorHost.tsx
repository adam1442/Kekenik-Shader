import { useEffect } from "react";
import { create } from "zustand";
import { InspectorPanel } from "@/ui/graph/panels/InspectorPanel";
import { useGraphs } from "@/ui/graph/graphStore";
import { Tabs } from "@/ui";
import { EmptyState } from "@/ui";
import { MousePointerClick } from "lucide-react";
import { useBlackboard } from "../store";
import { GraphInspector } from "./GraphInspector";
import { KeywordInspector } from "./KeywordInspector";
import { PropertyInspector } from "./PropertyInspector";
import { SelectionSummary } from "./SelectionSummary";
import { SubgraphInspector } from "@/ui/graph/panels/SubgraphInspector";

export type InspectorTab = "node" | "property" | "graph" | "selection" | "subgraph";
const useInspectorTab = create<{ tab: InspectorTab; setTab: (t: InspectorTab) => void }>((set) => ({
  tab: "node",
  setTab: (tab) => set({ tab }),
}));

const TABS = [
  { id: "node", label: "Node" },
  { id: "property", label: "Property" },
  { id: "graph", label: "Graph" },
  { id: "selection", label: "Selection" },
  { id: "subgraph", label: "Subgraph" },
];

/**
 * The ONE Inspector: Node · Property · Graph · Selection tabs.
 * Choosing a Blackboard item jumps to the Property tab, picking a node on the canvas jumps back to the Node tab.
 */
export function InspectorHost() {
  const { tab, setTab } = useInspectorTab();
  const selected = useBlackboard((s) => s.selected);
  const nodeSel = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.selection.join(",") ?? "");
  useEffect(() => {
    if (selected) setTab("property");
  }, [selected, setTab]);
  useEffect(() => {
    if (nodeSel) setTab("node");
  }, [nodeSel, setTab]);
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  const exists =
    selected &&
    (selected.kind === "property"
      ? graph?.properties.some((p) => p.id === selected.id)
      : graph?.keywords.some((k) => k.id === selected.id));
  return (
    <div className="kk-insp-host" data-testid="inspector-host" data-tab={tab}>
      <Tabs items={TABS} value={tab} onChange={(t) => setTab(t as InspectorTab)} />
      <div className="kk-insp-host__body">
        {tab === "node" && <InspectorPanel />}
        {tab === "property" &&
          (exists && selected ? (
            selected.kind === "property" ? (
              <PropertyInspector id={selected.id} />
            ) : (
              <KeywordInspector id={selected.id} />
            )
          ) : (
            <EmptyState
              icon={MousePointerClick}
              title="No property selected"
              description="Select a property or keyword in the Blackboard to edit its metadata."
            />
          ))}
        {tab === "graph" && <GraphInspector />}
        {tab === "selection" && <SelectionSummary />}
        {tab === "subgraph" && <SubgraphInspector />}
      </div>
    </div>
  );
}
