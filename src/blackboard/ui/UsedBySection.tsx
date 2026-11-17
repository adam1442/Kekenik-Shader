import { Copy, Plus, Trash2 } from "lucide-react";
import type { UsageSite } from "@/core";
import { Button } from "@/ui";
import { focusNode } from "@/ui/graph/actions";
import { setSelection } from "@/ui/graph/graphStore";
import {
  addKeywordNode,
  addPropertyNode,
  duplicateKeyword,
  duplicateProperty,
  propertyLock,
  requestDeleteKeyword,
  requestDeleteProperty,
} from "../actions";
import type { ItemKind } from "../store";
import { Section } from "./fields";

const ACTIONS = {
  property: {
    add: addPropertyNode,
    addLabel: "Add to graph",
    duplicate: duplicateProperty,
    remove: requestDeleteProperty,
  },
  keyword: {
    add: addKeywordNode,
    addLabel: "Add switch to graph",
    duplicate: duplicateKeyword,
    remove: requestDeleteKeyword,
  },
} as const;

/** Footer of the Property / Keyword tabs: usage count, add-to-graph, select users, duplicate, delete. */
export function UsedBySection({ kind, id, uses }: { kind: ItemKind; id: string; uses: readonly UsageSite[] }) {
  const a = ACTIONS[kind];
  const lock = kind === "property" ? propertyLock(id) : undefined;
  const selectUsers = () => {
    const ids = uses.filter((u) => !u.scope).map((u) => u.nodeId);
    setSelection(ids);
    if (ids[0]) focusNode(ids[0]);
  };
  return (
    <Section title={`Used by ${uses.length} node${uses.length === 1 ? "" : "s"}`}>
      <div className="kk-bb-actions">
        <Button size="sm" onClick={() => void a.add(id)}>
          <Plus size={12} /> {a.addLabel}
        </Button>
        <Button size="sm" variant="ghost" disabled={uses.length === 0} onClick={selectUsers}>
          Select nodes
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void a.duplicate(id)}>
          <Copy size={12} /> Duplicate
        </Button>
        <Button size="sm" variant="ghost" disabled={!!lock} title={lock} onClick={() => a.remove(id)}>
          <Trash2 size={12} /> Delete
        </Button>
      </div>
    </Section>
  );
}
