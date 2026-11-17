import { AlertTriangle, ChevronDown, ChevronRight, Eye, EyeOff } from "lucide-react";
import { type DragEvent, useState } from "react";
import { type Graph, type Keyword, type Property, checkReferenceName, takenReferenceNames } from "@/core";
import { toCssColor } from "@/core/values/color";
import { InlineEditableLabel } from "@/ui";
import { renameHeader, renameKeyword, renameProperty, reorderItem, toggleExposed } from "../actions";
import { useBlackboard } from "../store";
import { BLACKBOARD_MIME, TYPE_LABEL, keywordIcon, propertyIcon } from "../typeInfo";
import { toVec } from "./valueUtil";

const REORDER_MIME = "application/x-kk-bb-reorder";

/** Drop position of the pointer relative to a row: first half = before, second half = after. */
const dropAfter = (e: DragEvent<HTMLElement>): boolean => {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientY > r.top + r.height / 2;
};

export interface RowDnd {
  over: { id: string; after: boolean } | null;
  setOver: (v: { id: string; after: boolean } | null) => void;
}

const swatch = (p: Property): string | null => {
  if (p.type !== "color" && p.type !== "color4") return null;
  const [r, g, b, a] = toVec(p.default, 4, 1);
  return toCssColor({ r: Math.min(1, r!), g: Math.min(1, g!), b: Math.min(1, b!), a: p.type === "color4" ? a! : 1 });
};

interface RowProps {
  kind: "property" | "keyword";
  item: Property | Keyword;
  graph: Graph;
  selected: boolean;
  uses: number;
  dnd: RowDnd;
}

/** One Blackboard entry: select, rename inline (double-click / F2), drag to reorder or onto the canvas, exposed toggle, warnings. */
export function BlackboardRow({ kind, item, graph, selected, uses, dnd }: RowProps) {
  const select = useBlackboard((s) => s.select);
  const renaming = useBlackboard((s) => s.renaming?.kind === kind && s.renaming.id === item.id);
  const setRenaming = useBlackboard((s) => s.setRenaming);
  const check = checkReferenceName(item.referenceName, takenReferenceNames(graph.properties, graph.keywords, item.id));
  const isProp = kind === "property";
  const p = item as Property;
  const Icon = isProp ? propertyIcon(p.type) : keywordIcon(item as Keyword);
  const color = isProp ? swatch(p) : null;
  const hidden = isProp && !p.exposed;
  const drop = dnd.over?.id === item.id ? (dnd.over.after ? "after" : "before") : undefined;
  return (
    <div
      className="kk-bb-row"
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      draggable={!renaming}
      data-testid="bb-row"
      data-kind={kind}
      data-item-id={item.id}
      data-selected={selected || undefined}
      data-unused={uses === 0 || undefined}
      data-hidden={hidden || undefined}
      data-drop={drop}
      data-ctx-scope="blackboard.item"
      data-ctx-id={`${kind}:${item.id}`}
      onClick={() => select({ kind, id: item.id })}
      onDoubleClick={() => setRenaming({ kind, id: item.id })}
      onDragStart={(e) => {
        select({ kind, id: item.id });
        e.dataTransfer.setData(BLACKBOARD_MIME, `${kind}:${item.id}`);
        e.dataTransfer.setData(REORDER_MIME, `${kind}:${item.id}`);
        e.dataTransfer.effectAllowed = "copyMove";
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(REORDER_MIME)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const after = dropAfter(e);
        if (dnd.over?.id !== item.id || dnd.over.after !== after) dnd.setOver({ id: item.id, after });
      }}
      onDragLeave={() => dnd.over?.id === item.id && dnd.setOver(null)}
      onDrop={(e) => {
        const [k, id] = e.dataTransfer.getData(REORDER_MIME).split(":");
        dnd.setOver(null);
        if (k !== kind || !id) return;
        e.preventDefault();
        reorderItem(kind, id, item.id, dropAfter(e));
      }}
      onDragEnd={() => dnd.setOver(null)}
    >
      <Icon size={13} className="kk-bb-row__icon" />
      {color && (
        <span className="kk-bb-row__swatch kk-checker" aria-hidden>
          <i style={{ background: color }} />
        </span>
      )}
      <span className="kk-bb-row__name">
        {renaming ? (
          <InlineEditableLabel
            editing
            aria-label="Rename"
            value={item.displayName}
            onCommit={(v) => {
              setRenaming(null);
              void (isProp ? renameProperty(item.id, v) : renameKeyword(item.id, v));
            }}
            onCancel={() => setRenaming(null)}
          />
        ) : (
          <span title={`${item.displayName}\n${item.referenceName}`}>{item.displayName}</span>
        )}
      </span>
      {check.status !== "ok" && (
        <AlertTriangle
          size={12}
          className={`kk-bb-row__warn is-${check.status}`}
          aria-label={check.targets.flatMap((t) => t.issues)[0] ?? "name issue"}
        />
      )}
      <span className="kk-bb-row__type">
        {isProp ? TYPE_LABEL[p.type] : (item as Keyword).kind === "boolean" ? "Bool keyword" : "Enum keyword"}
      </span>
      {isProp && (
        <button
          type="button"
          className="kk-bb-row__eye"
          aria-label={p.exposed ? "Exposed — click to hide from the material inspector" : "Internal — click to expose"}
          aria-pressed={p.exposed}
          onClick={(e) => {
            e.stopPropagation();
            toggleExposed(p.id);
          }}
        >
          {p.exposed ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>
      )}
    </div>
  );
}

/** Collapsible header row of a category (double-click renames it). */
export function HeaderRow({ kind, name, count }: { kind: "property" | "keyword"; name: string; count: number }) {
  const key = `${kind}:${name}`;
  const collapsed = useBlackboard((s) => !!s.collapsed[key]);
  const toggle = useBlackboard((s) => s.toggleCollapsed);
  const [editing, setEditing] = useState(false);
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  return (
    <div
      className="kk-bb-header"
      data-ctx-scope="blackboard.section"
      data-ctx-id={key}
      data-testid="bb-header"
      onClick={() => toggle(key)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
    >
      <Chevron size={12} />
      {editing ? (
        <InlineEditableLabel
          editing
          aria-label="Rename header"
          value={name}
          onCommit={(v) => {
            setEditing(false);
            renameHeader(kind, name, v);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <span>{name}</span>
      )}
      <em>{count}</em>
    </div>
  );
}
