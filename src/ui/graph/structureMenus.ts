import {
  ArrowLeftRight,
  Box,
  Copy,
  ExternalLink,
  Frame,
  Link2,
  MousePointerSquareDashed,
  Palette,
  Pencil,
  Trash2,
  Unlink,
} from "lucide-react";
import { registerContextMenu } from "@/app/contextmenu/registry";
import { SEP, type MenuItem } from "@/ui";
import { copyText } from "@/ui/controls/clipboard";
import { deleteSelection } from "./actions";
import { FRAME_COLORS, groupContents } from "./frames";
import {
  fitGroupToContents,
  nodeRectOf,
  removeFrame,
  setCommentColor,
  setGroupColor,
  toggleGroupCollapse,
} from "./frameActions";
import { getGraph, setSelection } from "./graphStore";
import { convertPortalToReroute, convertRerouteToPortal, selectChannel } from "./structuralActions";
import { inlineInstance, openSubgraph } from "./subgraphActions";

const colorItems = (apply: (c: string | null) => void): MenuItem[] =>
  FRAME_COLORS.map((c) => ({ label: c.name, run: () => apply(c.value) }));
const renameEvent = (id: string) => window.dispatchEvent(new CustomEvent("kk-node-rename", { detail: id }));

/** Items shared by reroute / portal menus. */
const common = (id: string): MenuItem[] => [
  SEP,
  { label: "Delete", icon: Trash2, shortcut: "Delete", danger: true, run: () => void deleteSelection() },
  { label: "Copy Node Id", icon: Copy, run: () => void copyText(id) },
];

/** Context scopes added by : `graph.reroute`, `graph.portal`, `graph.group`, `graph.comment`. */
export function registerStructureMenus(): void {
  registerContextMenu("graph.reroute", (_t, _e, info) => {
    const id = info.id ?? "";
    return {
      inherit: false,
      items: [
        { label: "Convert to Portal", icon: ArrowLeftRight, run: () => void convertRerouteToPortal(id) },
        ...common(id),
      ],
    };
  });
  registerContextMenu("graph.portal", (_t, _e, info) => {
    const id = info.id ?? "";
    const isIn = getGraph().nodes[id]?.defId === "portalIn";
    return {
      inherit: false,
      items: [
        {
          label: "Select All Portals of This Channel",
          icon: MousePointerSquareDashed,
          run: () => void selectChannel(id),
        },
        { label: isIn ? "Rename Channel…" : "Choose Channel…", icon: Pencil, run: () => renameEvent(id) },
        { label: "Convert to Reroute", icon: Link2, run: () => void convertPortalToReroute(id) },
        ...common(id),
      ],
    };
  });
  registerContextMenu("graph.group", (_t, _e, info) => {
    const id = info.id ?? "";
    return {
      inherit: false,
      items: [
        {
          label: getGraph().groups.find((x) => x.id === id)?.collapsed ? "Expand Group" : "Collapse Group",
          icon: Frame,
          run: () => void toggleGroupCollapse(id),
        },
        { label: "Fit to Contents", icon: Frame, run: () => void fitGroupToContents(id) },
        {
          label: "Select Contents",
          icon: MousePointerSquareDashed,
          run: () => setSelection(groupContents(getGraph(), id, nodeRectOf()).nodeIds),
        },
        { label: "Color", icon: Palette, submenu: colorItems((c) => setGroupColor(id, c)) },
        SEP,
        {
          label: "Ungroup (keep nodes)",
          icon: Unlink,
          danger: true,
          run: () => void removeFrame({ kind: "group", id }),
        },
      ],
    };
  });
  registerContextMenu("graph.comment", (_t, _e, info) => {
    const id = info.id ?? "";
    return {
      inherit: false,
      items: [
        { label: "Color", icon: Palette, submenu: colorItems((c) => setCommentColor(id, c)) },
        SEP,
        { label: "Delete Comment", icon: Trash2, danger: true, run: () => void removeFrame({ kind: "comment", id }) },
      ],
    };
  });
}

/** Extra entries of the node menu for subgraph instances. */
export function subgraphNodeItems(id: string): MenuItem[] {
  const n = getGraph().nodes[id];
  if (n?.defId !== "subgraph") return [];
  const def = String(n.params.subgraph ?? "");
  return [
    SEP,
    { label: "Open Subgraph", icon: ExternalLink, run: () => void openSubgraph(def) },
    { label: "Unlink (Inline Subgraph)", icon: Box, run: () => void inlineInstance(id) },
  ];
}
