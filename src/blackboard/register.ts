import { ListTree, SlidersHorizontal } from "lucide-react";
import { getPanelDef, registerPanel } from "@/app/dock/panelRegistry";
import { registerCanvasDrop } from "@/ui/graph/controller/events";
import { dropOnCanvas } from "./actions";
import { initMaterialSync } from "./materialStore";
import { registerBlackboardMenus } from "./menus";
import { BLACKBOARD_MIME } from "./typeInfo";
import { BlackboardPanel } from "./ui/BlackboardPanel";
import { InspectorHost } from "./ui/InspectorHost";
import { MaterialPanel } from "./ui/MaterialPanel";

/**
 * wiring (idempotent): Blackboard + consolidated Inspector + Material Inspector panels (placeholders keep their
 * registration order and placement), the `blackboard.*` context scopes, the canvas drop target and material↔keyword sync.
 */
export function registerBlackboardFeatures(): void {
  const prevB = getPanelDef("blackboard");
  registerPanel({
    id: "blackboard",
    title: "Blackboard",
    icon: ListTree,
    component: BlackboardPanel,
    defaultPlacement: prevB?.defaultPlacement ?? { ref: "library", direction: "within", inactive: true },
    closable: true,
  });
  const prevI = getPanelDef("inspector");
  registerPanel({
    id: "inspector",
    title: "Inspector",
    icon: SlidersHorizontal,
    component: InspectorHost,
    defaultPlacement: prevI?.defaultPlacement ?? { ref: "graph", direction: "right", width: 300 },
    closable: true,
  });
  registerPanel({
    id: "material",
    title: "Material",
    icon: SlidersHorizontal,
    component: MaterialPanel,
    defaultPlacement: getPanelDef("material")?.defaultPlacement ?? {
      ref: "inspector",
      direction: "within",
      inactive: true,
    },
    closable: true,
  });
  registerBlackboardMenus();
  registerCanvasDrop(BLACKBOARD_MIME, (payload, world) => void dropOnCanvas(payload, world));
  initMaterialSync();
}
