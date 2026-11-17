import {
  type NodePrecisionOverride,
  type NodeStageOverride,
  defaultNodeRegistry,
  nodePrecKey,
  nodePrecisionOf,
  nodeStageKey,
  nodeStageOf,
} from "@/core";
import { Badge, EmptyState, SegmentedControl } from "@/ui";
import { setGraphSetting } from "@/ui/graph/actions";
import { useGraphs } from "@/ui/graph/graphStore";
import { Field, Section } from "./fields";

/** Selection tab: what is selected, by category, with problems. */
export function SelectionSummary() {
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  const selection = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.selection) ?? [];
  const diagnostics = useGraphs((s) => s.analysis?.diagnostics) ?? [];
  if (!graph) return <EmptyState title="No graph" description="Open or create a graph first." />;
  const nodes = selection.map((id) => graph.nodes[id]).filter((n) => !!n);
  if (!nodes.length)
    return <EmptyState title="Nothing selected" description="Select nodes on the canvas to see a summary." />;
  const byCategory = new Map<string, number>();
  for (const n of nodes) {
    const cat = (defaultNodeRegistry.get(n!.defId)?.category ?? "Unknown").split("/")[0]!;
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + 1);
  }
  const sel = new Set(selection);
  const edges = Object.values(graph.edges);
  const internal = edges.filter((e) => sel.has(e.from.node) && sel.has(e.to.node)).length;
  const boundary = edges.filter((e) => sel.has(e.from.node) !== sel.has(e.to.node)).length;
  const mine = diagnostics.filter((d) => d.nodeId && sel.has(d.nodeId));
  const only = nodes.length === 1 ? nodes[0]! : undefined;
  return (
    <div className="kk-insp" data-testid="inspector-selection">
      {only && defaultNodeRegistry.get(only.defId) && (
        <Section title="Optimisation overrides">
          <Field
            label="Precision"
            hint="Inherit = the graph precision decides. Half forces this node's fragment values to half / mediump / min16float (you take the responsibility). Float keeps them full precision."
          >
            <SegmentedControl<NodePrecisionOverride>
              block
              value={nodePrecisionOf(graph, only.id)}
              aria-label="Node precision"
              options={[
                { value: "inherit", label: "Inherit" },
                { value: "half", label: "Half" },
                { value: "float", label: "Float" },
              ]}
              onChange={(v) =>
                void setGraphSetting(nodePrecKey(only.id), v === "inherit" ? null : v, "Set node precision")
              }
            />
          </Field>
          <Field
            label="Evaluate in"
            hint="Auto = the vertex-hoisting setting decides. Vertex = evaluate once per vertex and interpolate (warns when the expression is not affine). Fragment = never hoist this node."
          >
            <SegmentedControl<NodeStageOverride>
              block
              value={nodeStageOf(graph, only.id)}
              aria-label="Node evaluation stage"
              options={[
                { value: "auto", label: "Auto" },
                { value: "vertex", label: "Vertex" },
                { value: "fragment", label: "Fragment" },
              ]}
              onChange={(v) =>
                void setGraphSetting(nodeStageKey(only.id), v === "auto" ? null : v, "Set node evaluation stage")
              }
            />
          </Field>
        </Section>
      )}
      <Section title="Selection">
        <Field label="Nodes">
          <b data-testid="selection-count">{nodes.length}</b>
        </Field>
        <Field label="Internal wires">
          <span>{internal}</span>
        </Field>
        <Field label="Boundary wires">
          <span>{boundary}</span>
        </Field>
        <Field label="Errors">
          <Badge tone={mine.some((d) => d.severity === "error") ? "danger" : "neutral"}>
            {mine.filter((d) => d.severity === "error").length}
          </Badge>
        </Field>
        <Field label="Warnings">
          <Badge>{mine.filter((d) => d.severity === "warning").length}</Badge>
        </Field>
      </Section>
      <Section title="By category">
        {[...byCategory].map(([c, n]) => (
          <Field key={c} label={c}>
            <span>{n}</span>
          </Field>
        ))}
      </Section>
    </div>
  );
}
