import { create } from "zustand";

export type ItemKind = "property" | "keyword";
interface ItemRef {
  kind: ItemKind;
  id: string;
}

interface BlackboardState {
  /** The item shown in the Inspector's Property tab. */
  selected: ItemRef | null;
  /** Category headers the user collapsed (`property:<name>` / `keyword:<name>`). */
  collapsed: Record<string, boolean>;
  /** Item whose name is being edited inline. */
  renaming: ItemRef | null;
  /** Delete confirmation (only asked for items that are used by nodes). */
  pendingDelete: ItemRef | null;
  select: (ref: ItemRef | null) => void;
  toggleCollapsed: (key: string) => void;
  setRenaming: (ref: ItemRef | null) => void;
  setPendingDelete: (ref: ItemRef | null) => void;
}

export const useBlackboard = create<BlackboardState>((set) => ({
  selected: null,
  collapsed: {},
  renaming: null,
  pendingDelete: null,
  select: (selected) => set({ selected }),
  toggleCollapsed: (key) => set((s) => ({ collapsed: { ...s.collapsed, [key]: !s.collapsed[key] } })),
  setRenaming: (renaming) => set({ renaming }),
  setPendingDelete: (pendingDelete) => set({ pendingDelete }),
}));

export const sameRef = (a: ItemRef | null, b: ItemRef | null): boolean =>
  !!a && !!b && a.kind === b.kind && a.id === b.id;
