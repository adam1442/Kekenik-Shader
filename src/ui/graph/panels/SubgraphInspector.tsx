import { Layers } from "lucide-react";
import { SUBGRAPH_PARAM } from "@/core";
import { Button, EmptyState } from "@/ui";
import { useGraphs } from "../graphStore";
import { SubgraphIoEditor } from "../SubgraphIoEditor";
import { inlineInstance, openSubgraph } from "../subgraphActions";

/** Inspector tab: the I/O of the subgraph being edited, or of the selected subgraph instance. */
export function SubgraphInspector() {
  const doc = useGraphs((s) => s.docs.find((d) => d.id === s.activeId));
  const sel = doc?.selection.length === 1 ? doc.graph.nodes[doc.selection[0]!] : undefined;
  const instanceDef = sel?.defId === "subgraph" ? String(sel.params[SUBGRAPH_PARAM] ?? "") : undefined;
  const defId = instanceDef ?? doc?.scope;
  const def = defId ? doc?.graph.subgraphDefs[defId] : undefined;
  if (!doc || !def || !defId)
    return (
      <EmptyState
        icon={Layers}
        title="No subgraph"
        description="Select a subgraph instance, or open a subgraph, to edit its inputs and outputs."
      />
    );
  return (
    <div className="kk-insp" data-testid="inspector-subgraph">
      <div className="kk-insp__head">
        <div>
          <div className="kk-insp__title">{def.name}</div>
          <div className="kk-insp__sub">{instanceDef ? "Instance of this subgraph" : "Editing this subgraph"}</div>
        </div>
      </div>
      <SubgraphIoEditor defId={defId} />
      {instanceDef && sel && (
        <div className="kk-sgio__actions">
          <Button size="sm" onClick={() => openSubgraph(defId)}>
            Open
          </Button>
          <Button size="sm" variant="ghost" onClick={() => inlineInstance(sel.id)}>
            Unlink (inline)
          </Button>
        </div>
      )}
    </div>
  );
}
