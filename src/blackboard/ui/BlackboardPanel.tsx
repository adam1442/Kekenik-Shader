import { ListTree, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Keyword, type Property, keywordUsage, propertyUsage } from "@/core";
import { openContextMenuAt } from "@/app/contextmenu/ContextMenuHost";
import type { PanelProps } from "@/app/dock/panelRegistry";
import { Button, EmptyState, IconButton, Modal, ScrollArea } from "@/ui";
import { useGraphs } from "@/ui/graph/graphStore";
import { addKeywordMenu, addPropertyMenu } from "../menus";
import {
  deleteKeyword,
  deleteProperty,
  duplicateKeyword,
  duplicateProperty,
  requestDeleteKeyword,
  requestDeleteProperty,
} from "../actions";
import { useBlackboard } from "../store";
import { BlackboardRow, HeaderRow, type RowDnd } from "./BlackboardRows";

/** Group items by header, in order of first appearance; header-less items come first. */
function groupByHeader<T extends { category?: string }>(
  items: readonly T[],
): Array<{ header: string | null; items: T[] }> {
  const groups: Array<{ header: string | null; items: T[] }> = [];
  const none = items.filter((i) => !i.category);
  if (none.length) groups.push({ header: null, items: none });
  for (const i of items) {
    if (!i.category) continue;
    let g = groups.find((x) => x.header === i.category);
    if (!g) groups.push((g = { header: i.category, items: [] }));
    g.items.push(i);
  }
  return groups;
}

function SectionHead({
  title,
  count,
  scopeId,
  onAdd,
}: {
  title: string;
  count: number;
  scopeId: string;
  onAdd: (x: number, y: number) => void;
}) {
  return (
    <div className="kk-bb-sechead" data-ctx-scope="blackboard.section" data-ctx-id={scopeId}>
      <span>{title}</span>
      <em>{count}</em>
      <IconButton
        icon={Plus}
        size="sm"
        label={`Add ${title === "Properties" ? "property" : "keyword"}`}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onAdd(r.left, r.bottom + 4);
        }}
      />
    </div>
  );
}

function DeleteDialog() {
  const pending = useBlackboard((s) => s.pendingDelete);
  const set = useBlackboard((s) => s.setPendingDelete);
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  if (!pending || !graph) return null;
  const isProp = pending.kind === "property";
  const item = isProp
    ? graph.properties.find((p) => p.id === pending.id)
    : graph.keywords.find((k) => k.id === pending.id);
  if (!item) return null;
  const uses = isProp ? propertyUsage(graph, item.id).length : keywordUsage(graph, item.id).length;
  const close = () => set(null);
  const run = (removeNodes: boolean) => {
    close();
    if (isProp) deleteProperty(item.id, { removeNodes });
    else deleteKeyword(item.id, { removeNodes });
  };
  return (
    <Modal
      open
      onClose={close}
      title={`Delete ${isProp ? "property" : "keyword"} “${item.displayName}”?`}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => run(false)} data-testid="bb-delete-keep">
            Delete, keep nodes
          </Button>
          <Button variant="primary" onClick={() => run(true)} data-testid="bb-delete-nodes">
            Delete and remove {uses} node{uses === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <p data-testid="bb-delete-warning">
        It is used by <b>{uses}</b> node{uses === 1 ? "" : "s"} in the graph. Keeping them leaves the nodes with an
        error (“does not exist”) until you pick another {isProp ? "property" : "keyword"} or delete them.
      </p>
    </Modal>
  );
}

/** Blackboard: Properties + Keywords of the active graph (add, rename, reorder, headers, delete with usage warning, drag into the graph). */
export function BlackboardPanel(_p: PanelProps) {
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  const selected = useBlackboard((s) => s.selected);
  const collapsed = useBlackboard((s) => s.collapsed);
  const setRenaming = useBlackboard((s) => s.setRenaming);
  const [over, setOver] = useState<RowDnd["over"]>(null);
  const root = useRef<HTMLDivElement>(null);
  const dnd: RowDnd = { over, setOver };
  useEffect(() => {
    if (
      selected &&
      graph &&
      !(selected.kind === "property"
        ? graph.properties.some((p) => p.id === selected.id)
        : graph.keywords.some((k) => k.id === selected.id))
    )
      useBlackboard.getState().select(null);
  }, [graph, selected]);
  if (!graph)
    return (
      <EmptyState icon={ListTree} title="No graph" description="Open or create a graph to define its parameters." />
    );
  const onKey = (e: React.KeyboardEvent) => {
    if (!selected || (e.target as HTMLElement).closest("input,textarea,[contenteditable=true]")) return;
    if (e.key === "F2") setRenaming(selected);
    else if (e.key === "Delete" || e.key === "Backspace")
      selected.kind === "property" ? requestDeleteProperty(selected.id) : requestDeleteKeyword(selected.id);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      selected.kind === "property" ? duplicateProperty(selected.id) : duplicateKeyword(selected.id);
    } else return;
    e.preventDefault();
  };
  const uses = (kind: "property" | "keyword", id: string) =>
    kind === "property" ? propertyUsage(graph, id).length : keywordUsage(graph, id).length;
  const renderGroups = <T extends Property | Keyword>(kind: "property" | "keyword", list: readonly T[]) =>
    groupByHeader(list).map((g) => (
      <div key={g.header ?? "·"} className="kk-bb-group">
        {g.header && <HeaderRow kind={kind} name={g.header} count={g.items.length} />}
        {!(g.header && collapsed[`${kind}:${g.header}`]) &&
          g.items.map((it) => (
            <BlackboardRow
              key={it.id}
              kind={kind}
              item={it}
              graph={graph}
              selected={selected?.kind === kind && selected.id === it.id}
              uses={uses(kind, it.id)}
              dnd={dnd}
            />
          ))}
      </div>
    ));
  return (
    <div
      ref={root}
      className="kk-bb"
      tabIndex={0}
      data-testid="blackboard"
      data-ctx-scope="blackboard.empty"
      onKeyDown={onKey}
    >
      <ScrollArea style={{ height: "100%" }}>
        <SectionHead
          title="Properties"
          count={graph.properties.length}
          scopeId="properties"
          onAdd={(x, y) => openContextMenuAt(addPropertyMenu(), x, y)}
        />
        <div role="listbox" aria-label="Properties" data-testid="bb-properties">
          {graph.properties.length === 0 ? (
            <div className="kk-bb-empty">
              No properties yet. Press + to add one — exposed properties appear in the material inspector of your game
              engine.
            </div>
          ) : (
            renderGroups("property", graph.properties)
          )}
        </div>
        <SectionHead
          title="Keywords"
          count={graph.keywords.length}
          scopeId="keywords"
          onAdd={(x, y) => openContextMenuAt(addKeywordMenu(), x, y)}
        />
        <div role="listbox" aria-label="Keywords" data-testid="bb-keywords">
          {graph.keywords.length === 0 ? (
            <div className="kk-bb-empty">
              Keywords are compile-time switches (shader features). Add one, then drag it into the graph.
            </div>
          ) : (
            renderGroups("keyword", graph.keywords)
          )}
        </div>
      </ScrollArea>
      <DeleteDialog />
    </div>
  );
}
