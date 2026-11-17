import { Combine, Frame, Layers, LogIn, LogOut, StickyNote, Waypoints } from "lucide-react";
import { registerCommand, type Command } from "@/app/commands/registry";
import { getCanvasApi } from "./actions";
import { addCommentAt, groupSelection } from "./frameActions";
import { getActiveDoc, getSelection } from "./graphStore";
import { addPortal, addReroute } from "./structuralActions";
import { convertSelectionToSubgraph, createEmptySubgraph } from "./subgraphActions";

const hasDoc = () => !!getActiveDoc();
const cursor = () => getCanvasApi()?.cursorWorld() ?? { x: 0, y: 0 };

const cmds = (): Command[] => [
  {
    id: "graph.groupSelection",
    title: "Group Selection",
    category: "Graph",
    icon: Frame,
    shortcut: "Mod+G",
    when: () => hasDoc() && getSelection().length > 0,
    run: () => void groupSelection(),
  },
  {
    id: "graph.addComment",
    title: "Add Comment",
    category: "Graph",
    icon: StickyNote,
    when: hasDoc,
    run: () => void addCommentAt(cursor()),
  },
  {
    id: "graph.addReroute",
    title: "Add Reroute",
    category: "Graph",
    icon: Waypoints,
    when: hasDoc,
    run: () => void addReroute(cursor()),
  },
  {
    id: "graph.addPortalIn",
    title: "Add Portal In",
    category: "Graph",
    icon: LogIn,
    when: hasDoc,
    run: () => void addPortal("in", cursor()),
  },
  {
    id: "graph.addPortalOut",
    title: "Add Portal Out",
    category: "Graph",
    icon: LogOut,
    when: hasDoc,
    run: () => void addPortal("out", cursor()),
  },
  {
    id: "graph.convertToSubgraph",
    title: "Convert Selection to Subgraph",
    category: "Graph",
    icon: Combine,
    when: () => hasDoc() && getSelection().length > 0,
    run: () => void convertSelectionToSubgraph(),
  },
  {
    id: "graph.newSubgraph",
    title: "New Subgraph",
    category: "Graph",
    icon: Layers,
    when: hasDoc,
    run: () => void createEmptySubgraph(),
  },
];

export function registerStructureCommands(): void {
  cmds().forEach(registerCommand);
}
