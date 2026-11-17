import {
  ArrowLeftRight,
  Combine,
  Frame,
  Layers,
  LogIn,
  LogOut,
  StickyNote,
  Waypoints,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eye,
  Maximize,
  MousePointerSquareDashed,
  Palette,
  Plus,
  Scissors,
  Star,
  Trash2,
  Unlink,
  Wand2,
  ChevronsDownUp,
  RotateCcw,
  ScanSearch,
  Search,
} from "lucide-react";
import { PROPERTY_TYPES } from "@/core";
import { promotePortToProperty } from "@/blackboard/actions";
import { SEP, type MenuItem } from "@/ui";
import { copyText } from "@/ui/controls/clipboard";
import { registerContextMenu } from "@/app/contextmenu/registry";
import {
  copySelection,
  cutSelection,
  deleteSelection,
  disconnectEdge,
  disconnectPort,
  duplicateSelection,
  frameAll,
  frameSelected,
  pasteClipboard,
  setNodeColor,
  setPortValue,
  toggleCollapse,
  togglePreview,
} from "./actions";
import { getActiveController } from "./controller/registry";
import { getAnalysis, getGraph, getScene, getSelection, selectAll } from "./graphStore";
import { outputType } from "./connect";
import { useCanvasPrefs, useNodePrefs } from "./prefs";
import { addFromLibrary } from "./panels/NodeLibraryPanel";
import { addCommentAt, addGroupAt, groupSelection } from "./frameActions";
import { addPortal, addReroute, convertWireToPortals, insertRerouteOnWire } from "./structuralActions";
import { convertSelectionToSubgraph, createEmptySubgraph } from "./subgraphActions";
import { subgraphNodeItems } from "./structureMenus";
import { masterMenuItems, masterNodeId } from "./masterActions";
import { bakeRecordOf, openBake } from "@/app/pro/bakeActions";

const NODE_COLORS: Array<{ name: string; value: string | null }> = [
  { name: "Default", value: null },
  { name: "Red", value: "#f87171" },
  { name: "Orange", value: "#fb923c" },
  { name: "Yellow", value: "#fbbf24" },
  { name: "Green", value: "#4ade80" },
  { name: "Cyan", value: "#22d3ee" },
  { name: "Blue", value: "#60a5fa" },
  { name: "Violet", value: "#a78bfa" },
  { name: "Pink", value: "#f472b6" },
];

const ctl = () => getActiveController();
const colorMenu = (ids: () => string[]): MenuItem[] =>
  NODE_COLORS.map((c) => ({ label: c.name, run: () => setNodeColor(ids(), c.value) }));

function editItems(): MenuItem[] {
  return [
    { label: "Duplicate", icon: CopyPlus, shortcut: "Mod+D", run: () => void duplicateSelection() },
    { label: "Copy", icon: Copy, shortcut: "Mod+C", run: () => void copySelection() },
    { label: "Cut", icon: Scissors, shortcut: "Mod+X", run: () => void cutSelection() },
    { label: "Delete", icon: Trash2, shortcut: "Delete", danger: true, run: () => void deleteSelection() },
  ];
}

function nodeMenu(ids: () => string[], single?: string): MenuItem[] {
  const g = getGraph();
  const list = ids()
    .map((i) => g.nodes[i])
    .filter((n) => !!n);
  const collapsed = list.length > 0 && list.every((n) => n.collapsed);
  const preview = list.length > 0 && list.every((n) => n.previewEnabled);
  const isMaster = list.some((n) => n.defId === "masterOutput");
  return [
    ...editItems().map((i) =>
      isMaster && "label" in i && (i.label === "Delete" || i.label === "Cut")
        ? { ...i, disabled: true, disabledReason: "The Master Output cannot be deleted" }
        : i,
    ),
    SEP,
    { label: collapsed ? "Expand" : "Collapse", icon: ChevronsDownUp, run: () => void toggleCollapse(ids()) },
    { label: "Preview", icon: Eye, type: "checkbox", checked: preview, run: () => void togglePreview(ids()) },
    { label: "Color", icon: Palette, submenu: colorMenu(ids) },
    ...(single
      ? [
          {
            label: "Rename…",
            shortcut: "F2",
            run: () => window.dispatchEvent(new CustomEvent("kk-node-rename", { detail: single })),
          } as MenuItem,
        ]
      : []),
    SEP,
    { label: "Frame Selected", icon: ScanSearch, shortcut: "F", run: () => void frameSelected() },
    ...(single && !isMaster
      ? [
          {
            label: bakeRecordOf(g, single) ? "Re-bake Texture…" : "Bake to Texture…",
            icon: Layers,
            run: () => openBake(single),
          } as MenuItem,
        ]
      : []),
    ...(single ? subgraphNodeItems(single) : []),
  ];
}

/** Register the `graph.*`, `nodelib.item` and `search.result` scopes. Each region owns its own menu (the canvas scope inherits the panel's window items). */
export function registerGraphContextMenus(): void {
  registerContextMenu("graph.canvas", () => {
    const c = ctl();
    const world = c?.ctxWorld ?? { x: 0, y: 0 };
    const p = useCanvasPrefs.getState();
    return {
      inherit: true,
      items: [
        {
          label: "Add Node…",
          icon: Plus,
          shortcut: "Space",
          run: () =>
            c?.openSearch({
              world,
              screen: { x: world.x * c.view.zoom + c.view.x, y: world.y * c.view.zoom + c.view.y },
            }),
        },
        { label: "Paste", icon: ClipboardPaste, shortcut: "Mod+V", run: () => void pasteClipboard(world) },
        { label: "Select All", icon: MousePointerSquareDashed, shortcut: "Mod+A", run: () => selectAll() },
        SEP,
        { label: "Frame All", icon: Maximize, shortcut: "A", run: () => void frameAll() },
        {
          label: "Frame Selected",
          icon: ScanSearch,
          shortcut: "F",
          disabled: getSelection().length === 0,
          run: () => void frameSelected(),
        },
        SEP,
        { label: "Show Grid", type: "checkbox", checked: p.showGrid, run: () => p.set({ showGrid: !p.showGrid }) },
        { label: "Snap to Grid", type: "checkbox", checked: p.snap, run: () => p.set({ snap: !p.snap }) },
        { label: "Show Minimap", type: "checkbox", checked: p.minimap, run: () => p.set({ minimap: !p.minimap }) },
        SEP,
        { label: "Add Reroute", icon: Waypoints, run: () => void addReroute(world) },
        { label: "Add Portal In", icon: LogIn, run: () => void addPortal("in", world) },
        { label: "Add Portal Out", icon: LogOut, run: () => void addPortal("out", world) },
        SEP,
        { label: "Create Comment", icon: StickyNote, shortcut: "C", run: () => void addCommentAt(world) },
        { label: "Create Group", icon: Frame, run: () => void addGroupAt(world) },
        { label: "New Subgraph", icon: Layers, run: () => void createEmptySubgraph() },
      ],
    };
  });

  // Master Stack: block add/remove (per context) + the usual node items for the Master Output.
  registerContextMenu("graph.master", (_t, _e, info) => {
    const id = masterNodeId() ?? info.id ?? "";
    return {
      inherit: false,
      items: masterMenuItems(
        info.id,
        nodeMenu(() => [id], id),
      ),
    };
  });
  registerContextMenu("graph.node", (_t, _e, info) => ({
    inherit: false,
    items: nodeMenu(() => [info.id ?? ""], info.id ?? undefined),
  }));
  registerContextMenu("graph.selection", () => ({
    inherit: false,
    items: [
      ...nodeMenu(() => getSelection()),
      SEP,
      { label: "Group Selection", icon: Frame, shortcut: "Mod+G", run: () => void groupSelection() },
      { label: "Convert to Subgraph", icon: Combine, run: () => void convertSelectionToSubgraph() },
    ],
  }));

  registerContextMenu("graph.port", (_t, _e, info) => {
    const [dir, node, port] = (info.id ?? "").split(":") as ["in" | "out", string, string];
    const g = getGraph();
    const wired = Object.values(g.edges).some((e) =>
      dir === "in" ? e.to.node === node && e.to.port === port : e.from.node === node && e.from.port === port,
    );
    const n = g.nodes[node];
    const hasValue = dir === "in" && !!n && port in n.values && !wired;
    const c = ctl();
    const resolved = dir === "in" ? getAnalysis().main.info.get(node)?.inputs[port]?.target : undefined;
    const promotable =
      dir === "in" &&
      !wired &&
      !!resolved &&
      (PROPERTY_TYPES as readonly string[]).includes(resolved) &&
      resolved !== "texture2D";
    return [
      {
        label: "Disconnect",
        icon: Unlink,
        disabled: !wired,
        disabledReason: "Nothing is connected to this port",
        run: () => void disconnectPort(node, port, dir),
      },
      {
        label: dir === "out" ? "Add Connected Node…" : "Add Node Feeding This Input…",
        icon: Search,
        run: () => {
          if (!c) return;
          const scene = getScene();
          const pos = scene.portPos(node, dir, port)!;
          const type =
            dir === "out"
              ? outputType({ graph: g, scene, analysis: getAnalysis() }, { node, port })
              : (getAnalysis().main.info.get(node)?.inputs[port]?.target ?? "float");
          const spec = dir === "in" ? scene.get(node)?.inputs.find((p) => p.id === port)?.type : undefined;
          const screen = { x: pos.x * c.view.zoom + c.view.x + 20, y: pos.y * c.view.zoom + c.view.y };
          c.openSearch({
            screen,
            world: pos,
            anchor: { node, port, dir },
            filter: { dir, type: type ?? "float", ...(spec ? { spec } : {}) },
          });
        },
      },
      {
        label: "Reset Value",
        icon: RotateCcw,
        disabled: !hasValue,
        disabledReason:
          dir === "out" ? "Outputs have no value" : wired ? "The port is connected" : "Already at its default",
        run: () => void setPortValue(node, port, null),
      },
      SEP,
      {
        label: "Promote to Property",
        icon: Wand2,
        disabled: !promotable,
        disabledReason:
          dir === "out"
            ? "Only inputs can be promoted"
            : wired
              ? "Disconnect the port first"
              : "This port type cannot become a property",
        run: () => void promotePortToProperty(node, port),
      },
    ];
  });

  registerContextMenu("graph.wire", (_t, _e, info) => {
    const id = info.id ?? "";
    const e = getGraph().edges[id];
    const c = ctl();
    return [
      { label: "Delete Wire", icon: Trash2, danger: true, disabled: !e, run: () => void disconnectEdge(id) },
      {
        label: "Insert Node…",
        icon: Plus,
        disabled: !e,
        run: () => {
          if (!e || !c) return;
          const scene = getScene();
          const type = outputType({ graph: getGraph(), scene, analysis: getAnalysis() }, e.from) ?? "float";
          const world = c.ctxWorld;
          c.openSearch({
            world,
            screen: { x: world.x * c.view.zoom + c.view.x, y: world.y * c.view.zoom + c.view.y },
            insertEdge: id,
            filter: { dir: "out", type },
          });
        },
      },
      {
        label: "Add Reroute",
        icon: Waypoints,
        disabled: !e,
        run: () => void (e && insertRerouteOnWire(id, ctl()?.ctxWorld ?? { x: 0, y: 0 })),
      },
      {
        label: "Convert Wire to Portal Pair",
        icon: ArrowLeftRight,
        disabled: !e,
        run: () => void convertWireToPortals(id),
      },
    ];
  });

  registerContextMenu("nodelib.item", (_t, _e, info) => {
    const id = info.id ?? "";
    const fav = useNodePrefs.getState().favorites.includes(id);
    return [
      { label: "Add to Graph", icon: Plus, run: () => void addFromLibrary(id) },
      {
        label: fav ? "Remove from Favorites" : "Add to Favorites",
        icon: Star,
        run: () => useNodePrefs.getState().toggleFavorite(id),
      },
      { label: "Copy Node Id", icon: Copy, run: () => void copyText(id) },
    ];
  });

  registerContextMenu("search.result", (_t, _e, info) => {
    const id = info.id ?? "";
    const fav = useNodePrefs.getState().favorites.includes(id);
    return [
      { label: "Add Node", icon: Plus, run: () => (info.element as HTMLElement).click() },
      {
        label: fav ? "Remove from Favorites" : "Add to Favorites",
        icon: Star,
        run: () => useNodePrefs.getState().toggleFavorite(id),
      },
    ];
  });
}
