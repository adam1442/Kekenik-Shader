import { Layers } from "lucide-react";
import { registerPanel } from "@/app/dock/panelRegistry";
import { SubgraphLibraryPanel } from "./panels/SubgraphLibraryPanel";
import { registerStructureMenus } from "./structureMenus";
import { registerStructureCommands } from "./structureCommands";

/** wiring (idempotent): Subgraphs panel, `graph.group|comment|reroute|portal` menus, structure commands. */
export function registerStructureFeatures(): void {
  registerPanel({
    id: "subgraphs",
    title: "Subgraphs",
    icon: Layers,
    component: SubgraphLibraryPanel,
    defaultPlacement: { ref: "blackboard", direction: "within", inactive: true },
    closable: true,
  });
  registerStructureMenus();
  registerStructureCommands();
}
