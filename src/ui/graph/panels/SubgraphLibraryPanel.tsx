import { useState } from "react";
import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  FileUp,
  Layers,
  Plus,
  PlusSquare,
  Trash2,
} from "lucide-react";
import { Badge, Button, EmptyState, IconButton, InlineEditableLabel } from "@/ui";
import { getCanvasApi } from "../actions";
import { rootDocOf, useGraphs } from "../graphStore";
import { SubgraphIoEditor } from "../SubgraphIoEditor";
import {
  addSubgraphInstance,
  copySubgraph,
  createEmptySubgraph,
  deleteSubgraph,
  duplicateSubgraph,
  exportSubgraphFile,
  importSubgraphFile,
  openSubgraph,
  pasteSubgraph,
  renameSubgraph,
  usageOf,
} from "../subgraphActions";

/** Project-level library of subgraphs: create, open, instantiate, rename, duplicate, delete (with usage warning), import / export / copy / paste. */
export function SubgraphLibraryPanel() {
  const graph = useGraphs((s) => rootDocOf(s.docs.find((d) => d.id === s.activeId))?.graph);
  const [selected, setSelected] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  if (!graph)
    return <EmptyState icon={Layers} title="No graph open" description="Open a graph to manage its subgraphs." />;
  const defs = Object.values(graph.subgraphDefs);
  const sel = selected && graph.subgraphDefs[selected] ? selected : null;
  return (
    <div className="kk-sglib" data-testid="subgraph-library">
      <div className="kk-sglib__bar">
        <Button size="sm" icon={Plus} onClick={() => setSelected(createEmptySubgraph() || selected)}>
          New
        </Button>
        <Button size="sm" variant="ghost" icon={FileUp} onClick={() => importSubgraphFile()}>
          Import…
        </Button>
        <Button size="sm" variant="ghost" icon={ClipboardPaste} onClick={() => void pasteSubgraph()}>
          Paste
        </Button>
      </div>
      {defs.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No subgraphs yet"
          description="Select nodes on the canvas and press “Convert to Subgraph” (right-click), or create an empty one."
        />
      ) : (
        <div className="kk-sglib__list" role="list">
          {defs.map((d) => {
            const uses = usageOf(d.id).filter((u) => u.scope !== d.id);
            return (
              <div
                key={d.id}
                role="listitem"
                className="kk-sglib__item"
                data-testid="sglib-item"
                data-def={d.id}
                data-selected={sel === d.id || undefined}
                onClick={() => setSelected(d.id)}
              >
                <Layers size={14} className="kk-sglib__icon" />
                {renaming === d.id ? (
                  <InlineEditableLabel
                    editing
                    value={d.name}
                    aria-label="Subgraph name"
                    onCommit={(v) => (setRenaming(null), renameSubgraph(d.id, v))}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <span
                    className="kk-sglib__name"
                    onDoubleClick={() => setRenaming(d.id)}
                    title="Double-click to rename"
                  >
                    {d.name}
                  </span>
                )}
                <Badge>{`${d.inputs.length}→${d.outputs.length}`}</Badge>
                <span className="kk-sglib__uses" title={`${uses.length} instance${uses.length === 1 ? "" : "s"}`}>
                  ×{uses.length}
                </span>
                {confirm === d.id ? (
                  <span className="kk-sglib__confirm" onClick={(e) => e.stopPropagation()}>
                    <span>
                      {uses.length
                        ? `Delete and remove ${uses.length} instance${uses.length === 1 ? "" : "s"}?`
                        : "Delete?"}
                    </span>
                    <Button size="sm" variant="danger" onClick={() => (deleteSubgraph(d.id), setConfirm(null))}>
                      Delete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <span className="kk-sglib__actions" onClick={(e) => e.stopPropagation()}>
                    <IconButton
                      icon={ExternalLink}
                      size="sm"
                      label="Open in new tab"
                      onClick={() => openSubgraph(d.id)}
                    />
                    <IconButton
                      icon={PlusSquare}
                      size="sm"
                      label="Add instance to the canvas"
                      onClick={() => addSubgraphInstance(d.id, getCanvasApi()?.centerWorld() ?? { x: 0, y: 0 })}
                    />
                    <IconButton icon={CopyPlus} size="sm" label="Duplicate" onClick={() => duplicateSubgraph(d.id)} />
                    <IconButton
                      icon={Download}
                      size="sm"
                      label="Export .kshadersub"
                      onClick={() => exportSubgraphFile(d.id)}
                    />
                    <IconButton
                      icon={Copy}
                      size="sm"
                      label="Copy (paste into another project)"
                      onClick={() => void copySubgraph(d.id)}
                    />
                    <IconButton icon={Trash2} size="sm" label="Delete" onClick={() => setConfirm(d.id)} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {sel && (
        <div className="kk-sglib__detail">
          <div className="kk-sglib__detail-title">{graph.subgraphDefs[sel]!.name} · inputs & outputs</div>
          <SubgraphIoEditor defId={sel} />
        </div>
      )}
    </div>
  );
}
