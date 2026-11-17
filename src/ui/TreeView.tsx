import { ChevronRight } from "lucide-react";
import { useState, type HTMLAttributes, type KeyboardEvent } from "react";
import { cx } from "./util/cx";
import type { IconType } from "./Button";

interface TreeNode {
  id: string;
  label: string;
  icon?: IconType;
  children?: TreeNode[];
  badge?: string;
}

interface TreeViewProps {
  nodes: TreeNode[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  defaultExpanded?: string[];
  /** Extra DOM attributes per row (e.g. data-ctx-scope for context menus). */
  rowProps?: (node: TreeNode) => HTMLAttributes<HTMLDivElement> & Record<string, string | undefined>;
  className?: string;
}

interface FlatRow {
  node: TreeNode;
  depth: number;
}

/** Keyboard-navigable tree (↑↓ move, ←→ collapse/expand, Enter selects). */
export function TreeView({ nodes, selectedId, onSelect, defaultExpanded = [], rowProps, className }: TreeViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(defaultExpanded));
  const [focusId, setFocusId] = useState<string | null>(null);

  const rows: FlatRow[] = [];
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of list) {
      rows.push({ node, depth });
      if (node.children?.length && expanded.has(node.id)) walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);

  const toggle = (id: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      const want = open ?? !next.has(id);
      if (want) next.add(id);
      else next.delete(id);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = focusId ?? selectedId ?? rows[0]?.node.id;
    const i = rows.findIndex((r) => r.node.id === cur);
    if (i < 0) return;
    const row = rows[i];
    const hasKids = !!row.node.children?.length;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusId(rows[Math.min(rows.length - 1, i + 1)].node.id);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusId(rows[Math.max(0, i - 1)].node.id);
    } else if (e.key === "ArrowRight" && hasKids) {
      e.preventDefault();
      if (!expanded.has(row.node.id)) toggle(row.node.id, true);
      else setFocusId(rows[i + 1].node.id);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (hasKids && expanded.has(row.node.id)) toggle(row.node.id, false);
      else {
        for (let k = i - 1; k >= 0; k--) {
          if (rows[k].depth < row.depth) {
            setFocusId(rows[k].node.id);
            break;
          }
        }
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(row.node.id);
    }
  };

  const active = focusId ?? selectedId ?? rows[0]?.node.id;

  return (
    <div data-kk="tree-view" role="tree" tabIndex={0} className={cx("kk-tree", className)} onKeyDown={onKeyDown}>
      {rows.map(({ node, depth }) => {
        const Icon = node.icon;
        const hasKids = !!node.children?.length;
        const open = expanded.has(node.id);
        return (
          <div
            key={node.id}
            role="treeitem"
            aria-selected={selectedId === node.id}
            aria-expanded={hasKids ? open : undefined}
            data-id={node.id}
            className={cx("kk-tree__row", selectedId === node.id && "is-selected", active === node.id && "is-active")}
            style={{ paddingLeft: 6 + depth * 14 }}
            onClick={() => {
              setFocusId(node.id);
              onSelect?.(node.id);
            }}
            onDoubleClick={() => hasKids && toggle(node.id)}
            {...rowProps?.(node)}
          >
            <span
              className={cx("kk-tree__chev", hasKids && "has-kids", open && "is-open")}
              onClick={(e) => {
                e.stopPropagation();
                if (hasKids) toggle(node.id);
              }}
            >
              {hasKids && <ChevronRight size={12} />}
            </span>
            {Icon && <Icon size={13} className="kk-tree__icon" />}
            <span className="kk-tree__label">{node.label}</span>
            {node.badge && <span className="kk-tree__badge">{node.badge}</span>}
          </div>
        );
      })}
    </div>
  );
}
