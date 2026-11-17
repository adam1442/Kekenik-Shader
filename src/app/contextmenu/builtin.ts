import {
  AppWindow,
  ClipboardCopy,
  Eraser,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  PanelTop,
  RotateCcw,
  X,
} from "lucide-react";
import { SEP, type MenuItem } from "@/ui";
import { runCommand } from "../commands/registry";
import { cmdItem, layoutMenu, panelToggleItems } from "../menus";
import { closePanel, dockPanel, floatPanel, getDockApi, isPanelFloating, toggleMaximize } from "../dock/controller";
import { getPanelDef, listPanelDefs } from "../dock/panelRegistry";
import { setStatus, useStatus } from "../state";
import { registerContextMenu } from "./registry";
import { getPanelExtras } from "./panelExtras";
import { registerTextInputContextMenu } from "./textInput";
import { registerControlContextMenus } from "./controls";
import { registerCodeContextMenus } from "../panels/code/codeMenus";

/** Window-management items for a panel (dock/float, maximize, close). */
function panelWindowItems(id: string): MenuItem[] {
  const def = getPanelDef(id);
  const floating = isPanelFloating(id);
  const maximized = !!getDockApi()?.getPanel(id)?.api.isMaximized();
  return [
    {
      label: floating ? "Dock panel" : "Float panel",
      icon: floating ? PanelTop : AppWindow,
      run: () => (floating ? dockPanel(id) : floatPanel(id)),
    },
    {
      label: maximized ? "Restore" : "Maximize",
      icon: maximized ? Minimize2 : Maximize2,
      shortcut: "Mod+Shift+M",
      run: () => toggleMaximize(id),
    },
    SEP,
    {
      label: `Close ${def?.title ?? "panel"}`,
      icon: X,
      disabled: def?.closable === false,
      disabledReason: "This panel cannot be closed",
      run: () => closePanel(id),
    },
  ];
}

/** Register all built-in context-menu scopes. */
export function registerBuiltinContextMenus(): void {
  registerTextInputContextMenu();
  registerControlContextMenus();
  registerCodeContextMenus();

  registerContextMenu("dock.tab", (_t, _e, info) => {
    const id = info.id ?? "";
    return [
      ...panelWindowItems(id),
      SEP,
      { label: "Reset layout", icon: RotateCcw, run: () => runCommand("view.resetLayout") },
    ];
  });

  registerContextMenu("dock.root", () => [
    { label: "Layout", icon: LayoutDashboard, submenu: layoutMenu() },
    { label: "Panels", icon: AppWindow, submenu: panelToggleItems() },
    SEP,
    cmdItem("app.commandPalette"),
  ]);

  for (const def of listPanelDefs()) {
    registerContextMenu(`panel.${def.id}`, () => {
      const extra = getPanelExtras(def.id);
      return extra && extra.length > 0 ? [...extra, SEP, ...panelWindowItems(def.id)] : panelWindowItems(def.id);
    });
  }

  registerContextMenu("statusbar", () => [
    {
      label: "Copy status message",
      icon: ClipboardCopy,
      run: () => {
        void navigator.clipboard?.writeText(useStatus.getState().message).catch(() => undefined);
        setStatus("Status message copied");
      },
    },
    { label: "Clear message", icon: Eraser, run: () => useStatus.getState().set("Ready") },
    SEP,
    cmdItem("help.about"),
  ]);

  const chromeMenu = (): MenuItem[] => [
    cmdItem("app.commandPalette"),
    SEP,
    { label: "Layout", icon: LayoutDashboard, submenu: layoutMenu() },
    { label: "Panels", icon: AppWindow, submenu: panelToggleItems() },
  ];
  registerContextMenu("menubar.empty", chromeMenu);
  registerContextMenu("toolbar", chromeMenu);
}
