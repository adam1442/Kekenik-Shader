import { isHdrColor } from "../hdr";
import { MousePointerClick } from "lucide-react";
import { type NodeInstance, defaultNodeRegistry } from "@/core";
import { Badge, EmptyState, TextField, type TextFieldProps } from "@/ui";
import { renameGraph, renameNode, toggleCollapse, togglePreview, deleteSelection } from "../actions";
import { AvailabilityChips } from "../AddNodeSearch";
import { categoryColor } from "../categoryColors";
import { getGraph, useGraphs } from "../graphStore";
import { ParamEditor, PortValueEditor, isInlineEditable } from "../NodeEditors";
import { Button } from "@/ui";
import { CUSTOM_FN_DEF } from "@/core";
import { CustomFunctionEditor } from "./CustomFunctionEditor";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="kk-insp__row">
      <label>{label}</label>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

function CommitText(
  p: { value: string; onCommit: (v: string) => void; placeholder?: string } & Pick<TextFieldProps, "aria-label">,
) {
  return (
    <TextField
      value={p.value}
      onChange={() => undefined}
      onCommit={p.onCommit}
      placeholder={p.placeholder}
      aria-label={p["aria-label"]}
    />
  );
}

function NodeInspector({ node }: { node: NodeInstance }) {
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  const analysis = useGraphs((s) => s.analysis);
  const def = defaultNodeRegistry.get(node.defId);
  if (!def || !graph)
    return <EmptyState title="Unknown node" description={`Node type “${node.defId}” is not registered.`} />;
  const info = analysis?.main.info.get(node.id);
  const ports = info?.ports ?? { inputs: def.inputs, outputs: def.outputs };
  const wired = new Map(
    Object.values(graph.edges)
      .filter((e) => e.to.node === node.id)
      .map((e) => [e.to.port, e]),
  );
  const diags = (analysis?.diagnostics ?? []).filter((d) => d.nodeId === node.id && !d.scope);
  return (
    <div className="kk-insp" data-testid="inspector-node">
      <div className="kk-insp__head">
        <span className="kk-insp__dot" style={{ background: node.color || categoryColor(def.category) }} />
        <div>
          <div className="kk-insp__title">{node.label || def.name}</div>
          <div className="kk-insp__sub">
            {def.category}
            {node.label ? ` · ${def.name}` : ""}
          </div>
        </div>
      </div>
      {def.description && <p className="kk-insp__desc">{def.description}</p>}
      <div className="kk-insp__sec">
        <h4>Node</h4>
        <Row label="Name">
          <CommitText
            aria-label="Node name"
            value={node.label ?? ""}
            placeholder={def.name}
            onCommit={(v) => renameNode(node.id, v || null)}
          />
        </Row>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={() => toggleCollapse([node.id])}>
            {node.collapsed ? "Expand" : "Collapse"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => togglePreview([node.id])}>
            {node.previewEnabled ? "Hide preview" : "Show preview"}
          </Button>
        </div>
      </div>
      {ports.inputs.length > 0 && (
        <div className="kk-insp__sec">
          <h4>Inputs</h4>
          {ports.inputs.map((p) => {
            const e = wired.get(p.id);
            const t = info?.inputs[p.id]?.target ?? (p.type.k === "type" ? p.type.type : "float");
            return (
              <Row key={p.id} label={p.name}>
                {e ? (
                  <Badge tone="accent">
                    ←{" "}
                    {graph.nodes[e.from.node]
                      ? defaultNodeRegistry.get(graph.nodes[e.from.node]!.defId)?.name
                      : e.from.node}
                    .{e.from.port}
                  </Badge>
                ) : isInlineEditable(t) ? (
                  <PortValueEditor nodeId={node.id} port={p} type={t} value={node.values[p.id]} density="regular" />
                ) : (
                  <Badge>{t}</Badge>
                )}
              </Row>
            );
          })}
        </div>
      )}
      {def.id === CUSTOM_FN_DEF && <CustomFunctionEditor node={node} />}
      {def.params.length > 0 && def.id !== CUSTOM_FN_DEF && (
        <div className="kk-insp__sec">
          <h4>Parameters</h4>
          {def.params.map((s) => (
            <Row key={s.id} label={s.label}>
              <ParamEditor
                nodeId={node.id}
                schema={s}
                value={node.params[s.id]}
                density="regular"
                hdr={isHdrColor(node.defId, s.id, node.params)}
              />
            </Row>
          ))}
        </div>
      )}
      <div className="kk-insp__sec">
        <h4>Available for</h4>
        <div className="kk-insp__chips">
          <AvailabilityChips def={def} />
        </div>
      </div>
      {diags.length > 0 && (
        <div className="kk-insp__sec">
          <h4>Diagnostics</h4>
          {diags.map((d, i) => (
            <div key={i} className="kk-insp__diag" data-sev={d.severity}>
              {d.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Inspector: selected node (params, port defaults, info, availability) · multi-selection summary · graph summary. */
export function InspectorPanel() {
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  const selection = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.selection);
  if (!graph)
    return <EmptyState icon={MousePointerClick} title="No graph" description="Open or create a graph to inspect it." />;
  const sel = selection ?? [];
  if (sel.length === 1 && graph.nodes[sel[0]!]) return <NodeInspector node={graph.nodes[sel[0]!]!} />;
  if (sel.length > 1) {
    return (
      <div className="kk-insp" data-testid="inspector-multi">
        <div className="kk-insp__title">{sel.length} nodes selected</div>
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={() => toggleCollapse()}>
            Collapse / expand
          </Button>
          <Button size="sm" variant="ghost" onClick={() => deleteSelection()}>
            Delete
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="kk-insp" data-testid="inspector-graph">
      <div className="kk-insp__title">Graph</div>
      <div className="kk-insp__sec">
        <Row label="Name">
          <CommitText aria-label="Graph name" value={graph.name} onCommit={(v) => void renameGraph(v)} />
        </Row>
        <Row label="Profile">
          <Badge tone="cyan">{graph.profileId}</Badge>
        </Row>
        <Row label="Nodes">
          <span>{Object.keys(graph.nodes).length}</span>
        </Row>
        <Row label="Wires">
          <span>{Object.keys(getGraph().edges).length}</span>
        </Row>
      </div>
      <p className="kk-insp__desc">Select a node to edit its parameters and input defaults.</p>
    </div>
  );
}
