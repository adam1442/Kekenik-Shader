import { AlertTriangle, Box, Code2, FolderOpen, LibraryBig, ListTree, SlidersHorizontal, Workflow } from "lucide-react";
import { GraphCanvas } from "@/ui/graph/GraphCanvas";
import { NodeLibraryPanel } from "@/ui/graph/panels/NodeLibraryPanel";
import { ProblemsPanel } from "@/ui/graph/panels/ProblemsPanel";
import { PreviewPanel } from "@/preview/ui/PreviewPanel";
import { AssetsPanel } from "@/preview/ui/AssetsPanel";
import { BlackboardPanel } from "@/blackboard/ui/BlackboardPanel";
import { InspectorHost } from "@/blackboard/ui/InspectorHost";
import { registerPanel } from "../dock/panelRegistry";
import { CodeOutputPanel } from "./CodeOutputPanel";

/**
 * Register the core panels in Default-layout order.
 */
export function registerRealPanels(): void {
  registerPanel({
    id: "graph",
    title: "Graph",
    icon: Workflow,
    component: GraphCanvas,
    defaultPlacement: {},
    closable: false,
  });
  registerPanel({
    id: "library",
    title: "Node Library",
    icon: LibraryBig,
    component: NodeLibraryPanel,
    defaultPlacement: { ref: "graph", direction: "left", width: 250 },
    closable: true,
  });
  registerPanel({
    id: "preview",
    title: "Preview",
    icon: Box,
    component: PreviewPanel,
    defaultPlacement: { ref: "graph", direction: "right", width: 400 },
    closable: true,
  });
  registerPanel({
    id: "inspector",
    title: "Inspector",
    icon: SlidersHorizontal,
    component: InspectorHost,
    defaultPlacement: { ref: "preview", direction: "below", height: 320 },
    closable: true,
  });
  registerPanel({
    id: "blackboard",
    title: "Blackboard",
    icon: ListTree,
    component: BlackboardPanel,
    defaultPlacement: { ref: "library", direction: "within", inactive: true },
    closable: true,
  });
  registerPanel({
    id: "code",
    title: "Code Output",
    icon: Code2,
    component: CodeOutputPanel,
    defaultPlacement: { ref: "graph", direction: "below", height: 240 },
    closable: true,
  });
  registerPanel({
    id: "problems",
    title: "Problems",
    icon: AlertTriangle,
    component: ProblemsPanel,
    defaultPlacement: { ref: "code", direction: "within", inactive: true },
    closable: true,
  });
  registerPanel({
    id: "assets",
    title: "Assets",
    icon: FolderOpen,
    component: AssetsPanel,
    defaultPlacement: { ref: "code", direction: "within", inactive: true },
    closable: true,
  });
}
