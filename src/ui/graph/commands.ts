import {
  Clipboard,
  Copy,
  CopyPlus,
  FilePlus2,
  FolderOpen,
  Grid3x3,
  Magnet,
  Map as MapIcon,
  Maximize,
  MousePointerSquareDashed,
  Plus,
  Redo2,
  Save,
  FileDown,
  ScanSearch,
  Scissors,
  Search,
  Trash2,
  Undo2,
} from "lucide-react";
import { isEditableTarget } from "@/app/commands/keybindings";
import { registerCommand, type Command } from "@/app/commands/registry";
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  frameAll,
  frameSelected,
  getCanvasApi,
  pasteClipboard,
  toggleCollapse,
} from "./actions";
import { openGraphFile, saveActiveGraph } from "./fileIo";
import {
  canRedo,
  canUndo,
  getActiveDoc,
  newShaderGraph,
  openDoc,
  redo,
  selectAll,
  undo,
  useGraphs,
} from "./graphStore";
import { useCanvasPrefs } from "./prefs";

const hasDoc = () => !!getActiveDoc();
const typing = () => isEditableTarget(document.activeElement);
/** Edit commands act on the graph only when the graph (or nothing) has focus and no text field is being edited. */
const graphFocus = () => {
  if (!hasDoc() || typing()) return false;
  const a = document.activeElement;
  return !a || a === document.body || !!a.closest(".kk-graph");
};

const cmds = (): Command[] => [
  {
    id: "file.new",
    title: "New Graph",
    category: "File",
    icon: FilePlus2,
    shortcut: "Mod+N",
    run: () => void openDoc(newShaderGraph()),
  },
  {
    id: "file.open",
    title: "Open…",
    category: "File",
    icon: FolderOpen,
    shortcut: "Mod+O",
    run: () => openGraphFile(),
  },
  {
    id: "file.save",
    title: "Save",
    category: "File",
    icon: Save,
    shortcut: "Mod+S",
    when: hasDoc,
    run: () => void saveActiveGraph(false),
  },
  {
    id: "file.saveAs",
    title: "Save As…",
    category: "File",
    icon: FileDown,
    shortcut: "Mod+Shift+S",
    when: hasDoc,
    run: () => void saveActiveGraph(true),
  },
  {
    id: "edit.undo",
    title: "Undo",
    category: "Edit",
    icon: Undo2,
    shortcut: "Mod+Z",
    when: () => canUndo() && !typing(),
    run: () => void undo(),
  },
  {
    id: "edit.redo",
    title: "Redo",
    category: "Edit",
    icon: Redo2,
    shortcut: "Mod+Shift+Z",
    when: () => canRedo() && !typing(),
    run: () => void redo(),
  },
  {
    id: "edit.cut",
    title: "Cut",
    category: "Edit",
    icon: Scissors,
    shortcut: "Mod+X",
    when: graphFocus,
    run: () => void cutSelection(),
  },
  {
    id: "edit.copy",
    title: "Copy",
    category: "Edit",
    icon: Copy,
    shortcut: "Mod+C",
    when: graphFocus,
    run: () => void copySelection(),
  },
  {
    id: "edit.paste",
    title: "Paste",
    category: "Edit",
    icon: Clipboard,
    shortcut: "Mod+V",
    when: graphFocus,
    run: () => void pasteClipboard(getCanvasApi()?.cursorWorld()),
  },
  {
    id: "edit.duplicate",
    title: "Duplicate",
    category: "Edit",
    icon: CopyPlus,
    shortcut: "Mod+D",
    when: graphFocus,
    run: () => void duplicateSelection(),
  },
  {
    id: "edit.delete",
    title: "Delete",
    category: "Edit",
    icon: Trash2,
    shortcut: "Delete",
    when: graphFocus,
    run: () => void deleteSelection(),
  },
  {
    id: "edit.selectAll",
    title: "Select All",
    category: "Edit",
    icon: MousePointerSquareDashed,
    shortcut: "Mod+A",
    when: graphFocus,
    run: () => selectAll(),
  },
  {
    id: "edit.findNode",
    title: "Find Node…",
    category: "Edit",
    icon: Search,
    shortcut: "Mod+F",
    when: hasDoc,
    run: () => getCanvasApi()?.openSearch({}),
  },
  {
    id: "graph.addNode",
    title: "Add Node…",
    category: "Graph",
    icon: Plus,
    when: hasDoc,
    run: () => getCanvasApi()?.openSearch({}),
  },
  {
    id: "graph.frameAll",
    title: "Frame All",
    category: "Graph",
    icon: Maximize,
    when: hasDoc,
    run: () => void frameAll(),
  },
  {
    id: "graph.frameSelected",
    title: "Frame Selected",
    category: "Graph",
    icon: ScanSearch,
    when: hasDoc,
    run: () => void frameSelected(),
  },
  {
    id: "graph.toggleCollapse",
    title: "Collapse / Expand Selected Nodes",
    category: "Graph",
    when: hasDoc,
    run: () => void toggleCollapse(),
  },
  {
    id: "graph.toggleGrid",
    title: "Toggle Grid",
    category: "Graph",
    icon: Grid3x3,
    run: () => useCanvasPrefs.getState().set({ showGrid: !useCanvasPrefs.getState().showGrid }),
  },
  {
    id: "graph.toggleSnap",
    title: "Toggle Grid Snapping",
    category: "Graph",
    icon: Magnet,
    run: () => useCanvasPrefs.getState().set({ snap: !useCanvasPrefs.getState().snap }),
  },
  {
    id: "graph.toggleMinimap",
    title: "Toggle Minimap",
    category: "Graph",
    icon: MapIcon,
    run: () => useCanvasPrefs.getState().set({ minimap: !useCanvasPrefs.getState().minimap }),
  },
];

/** Replace the placeholder placeholders by real commands; keep Undo / Redo / document state live in the toolbar. */
export function registerGraphCommands(): void {
  const all = cmds();
  all.forEach(registerCommand);
  const key = () => `${hasDoc()}${canUndo()}${canRedo()}`;
  let last = key();
  useGraphs.subscribe(() => {
    const k = key();
    if (k === last) return;
    last = k;
    for (const c of all) if (c.when) registerCommand(c); // bump the registry so menus / toolbar re-evaluate `when`
  });
}
