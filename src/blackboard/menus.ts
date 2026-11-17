import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Layers, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { SEP, type MenuItem } from "@/ui";
import { copyText } from "@/ui/controls/clipboard";
import { registerContextMenu } from "@/app/contextmenu/registry";
import { getGraph } from "@/ui/graph/graphStore";
import {
  addKeyword,
  addKeywordNode,
  addProperty,
  addPropertyNode,
  deleteKeyword,
  deleteProperty,
  duplicateKeyword,
  duplicateProperty,
  keywordUseCount,
  nudgeItem,
  propertyLock,
  propertyUseCount,
  requestDeleteKeyword,
  requestDeleteProperty,
  setCategory,
  toggleExposed,
} from "./actions";
import { useBlackboard } from "./store";
import { ADD_PROPERTY_TYPES } from "./typeInfo";

export const addPropertyMenu = (category?: string): MenuItem[] =>
  ADD_PROPERTY_TYPES.map((t) => ({
    label: t.label,
    icon: t.icon,
    run: () => void addProperty(t.id, category ? { category } : {}),
  }));

export const addKeywordMenu = (): MenuItem[] => [
  { label: "Boolean Keyword", icon: Plus, run: () => void addKeyword("boolean") },
  { label: "Enum Keyword", icon: Plus, run: () => void addKeyword("enum") },
];

const headerItems = (kind: "property" | "keyword", id: string): MenuItem[] => {
  const g = getGraph();
  const cur = (kind === "property" ? g.properties : g.keywords).find((x) => x.id === id)?.category;
  const names = [...new Set([...g.properties, ...g.keywords].map((x) => x.category).filter((c): c is string => !!c))];
  return [
    { label: "(None)", type: "radio", checked: !cur, run: () => void setCategory(kind, id, undefined) },
    ...names.map((n) => ({
      label: n,
      type: "radio" as const,
      checked: cur === n,
      run: () => void setCategory(kind, id, n),
    })),
    SEP,
    { label: "New Header…", icon: Plus, run: () => void setCategory(kind, id, "New Header") },
  ];
};

function itemMenu(ref: string): MenuItem[] {
  const [kind, ...rest] = ref.split(":");
  const id = rest.join(":");
  const g = getGraph();
  if (kind === "property") {
    const p = g.properties.find((x) => x.id === id);
    if (!p) return [];
    const uses = propertyUseCount(id);
    return [
      { label: "Add to Graph", icon: Wand2, run: () => void addPropertyNode(id) },
      {
        label: "Rename",
        icon: Pencil,
        shortcut: "F2",
        run: () => useBlackboard.getState().setRenaming({ kind: "property", id }),
      },
      { label: "Duplicate", icon: Copy, shortcut: "Ctrl+D", run: () => void duplicateProperty(id) },
      SEP,
      {
        label: p.exposed ? "Hide from Material Inspector" : "Expose in Material Inspector",
        icon: p.exposed ? EyeOff : Eye,
        run: () => void toggleExposed(id),
      },
      { label: "Header", icon: Layers, submenu: headerItems("property", id) },
      { label: "Move Up", icon: ArrowUp, run: () => void nudgeItem("property", id, -1) },
      { label: "Move Down", icon: ArrowDown, run: () => void nudgeItem("property", id, 1) },
      { label: "Copy Reference Name", run: () => void copyText(p.referenceName) },
      SEP,
      {
        label: uses ? `Delete (used by ${uses})…` : "Delete",
        icon: Trash2,
        danger: true,
        shortcut: "Del",
        run: () => requestDeleteProperty(id),
        ...(propertyLock(id) ? { disabled: true, disabledReason: propertyLock(id)! } : {}),
      },
    ];
  }
  const k = g.keywords.find((x) => x.id === id);
  if (!k) return [];
  const uses = keywordUseCount(id);
  return [
    { label: "Add Switch to Graph", icon: Wand2, run: () => void addKeywordNode(id) },
    {
      label: "Rename",
      icon: Pencil,
      shortcut: "F2",
      run: () => useBlackboard.getState().setRenaming({ kind: "keyword", id }),
    },
    { label: "Duplicate", icon: Copy, shortcut: "Ctrl+D", run: () => void duplicateKeyword(id) },
    SEP,
    { label: "Header", icon: Layers, submenu: headerItems("keyword", id) },
    { label: "Move Up", icon: ArrowUp, run: () => void nudgeItem("keyword", id, -1) },
    { label: "Move Down", icon: ArrowDown, run: () => void nudgeItem("keyword", id, 1) },
    { label: "Copy Reference Name", run: () => void copyText(k.referenceName) },
    SEP,
    {
      label: uses ? `Delete (used by ${uses})…` : "Delete",
      icon: Trash2,
      danger: true,
      shortcut: "Del",
      run: () => requestDeleteKeyword(id),
    },
  ];
}

/** Context scopes of the Blackboard: `blackboard.item`, `blackboard.section`, `blackboard.empty`. */
export function registerBlackboardMenus(): void {
  registerContextMenu("blackboard.item", (_t, _e, info) => itemMenu(info.id ?? ""));
  registerContextMenu("blackboard.section", (_t, _e, info) => {
    const id = info.id ?? "";
    if (id === "keywords" || id.startsWith("keyword:")) return addKeywordMenu();
    const cat = id.startsWith("property:") ? id.slice("property:".length) : undefined;
    return [{ label: cat ? `Add Property to “${cat}”` : "Add Property", icon: Plus, submenu: addPropertyMenu(cat) }];
  });
  registerContextMenu("blackboard.empty", () => [
    { label: "Add Property", icon: Plus, submenu: addPropertyMenu() },
    { label: "Add Keyword", icon: Plus, submenu: addKeywordMenu() },
  ]);
}

/** Used by the delete flow of tests/tools that bypass the dialog. */
export const deleteItemNow = (kind: "property" | "keyword", id: string): boolean =>
  kind === "property" ? deleteProperty(id) : deleteKeyword(id);
