import { registerBuiltinCommands } from "./commands/builtin";
import { installKeybindings } from "./commands/keybindings";
import { registerBuiltinContextMenus } from "./contextmenu/builtin";
import { registerRealPanels } from "./panels";
import { registerGraphCommands } from "@/ui/graph/commands";
import { registerGraphContextMenus } from "@/ui/graph/contextMenus";
import { registerStructureFeatures } from "@/ui/graph/registerStructure";
import { registerGraphPanelExtras } from "./panels/graphPanels";
import { registerPreviewFeatures } from "@/preview/register";
import { registerBlackboardFeatures } from "@/blackboard/register";
import { registerExportFeatures } from "./export/register";
import { registerProFeatures, registerProPanels } from "./pro/register";

let done = false;

/** One-time app wiring: panels → commands → context menus. Idempotent. */
export function bootstrapApp(): void {
  if (done) return;
  done = true;
  registerRealPanels();
  registerProPanels();
  registerBuiltinCommands();
  registerBuiltinContextMenus();
  registerGraphCommands();
  registerGraphContextMenus();
  registerGraphPanelExtras();
  registerPreviewFeatures();
  registerBlackboardFeatures();
  registerStructureFeatures();
  registerExportFeatures();
  registerProFeatures();
}

/**
 * Global guards that keep the browser from fighting the app:
 * ctrl+wheel / pinch page zoom, native file-drop navigation, text selection drags on chrome.
 * Returns a disposer.
 */
export function installGlobalGuards(): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) e.preventDefault();
  };
  const onGesture = (e: Event) => e.preventDefault();
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  };
  const onDrop = (e: DragEvent) => {
    if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
  };
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("gesturestart", onGesture);
  window.addEventListener("gesturechange", onGesture);
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("drop", onDrop);
  const offKeys = installKeybindings();
  return () => {
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("gesturestart", onGesture);
    window.removeEventListener("gesturechange", onGesture);
    window.removeEventListener("dragover", onDragOver);
    window.removeEventListener("drop", onDrop);
    offKeys();
  };
}
