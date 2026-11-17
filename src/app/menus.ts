import { SEP, type MenuActionItem, type MenuItem } from "@/ui";
import { getCommand, isCommandEnabled, runCommand } from "./commands/registry";
import {
  deleteCustomLayout,
  applyCustomLayout,
  applyPreset,
  isPanelOpen,
  togglePanel,
  useDockState,
} from "./dock/controller";
import { listPresets } from "./dock/layouts";
import { listPanelDefs } from "./dock/panelRegistry";
import { ALIGN, DIST } from "./pro/arrange";

/** Build a menu item bound to a registered command (title, icon, shortcut, disabled state, run). */
export function cmdItem(id: string, over: Partial<MenuActionItem> = {}): MenuItem {
  const c = getCommand(id);
  if (!c) return { label: id, disabled: true, disabledReason: "Unknown command" };
  return {
    id: c.id,
    label: c.title,
    icon: c.icon,
    shortcut: c.shortcut,
    disabled: !isCommandEnabled(c),
    disabledReason: c.disabledReason,
    run: () => runCommand(id),
    ...over,
  };
}

/** Edit → Arrange submenu. */
const arrangeMenu = (): MenuItem[] => [
  cmdItem("graph.autoLayout"),
  SEP,
  ...ALIGN.map(([m]) => cmdItem(`graph.align.${m}`)),
  SEP,
  ...DIST.map(([a]) => cmdItem(`graph.distribute.${a}`)),
];

/** Layout submenu (presets, custom layouts, save, reset). */
export function layoutMenu(): MenuItem[] {
  const custom = useDockState.getState().customLayouts;
  const items: MenuItem[] = listPresets().map((p) =>
    cmdItem(`view.layout.${p.id}`, { label: p.name, icon: undefined, run: () => applyPreset(p.id) }),
  );
  if (custom.length) {
    items.push(SEP, { group: "Saved layouts" });
    for (const c of custom) {
      items.push({
        label: c.name,
        run: () => applyCustomLayout(c.id),
      });
    }
    items.push({
      label: "Delete saved layout",
      danger: true,
      submenu: custom.map((c) => ({ label: c.name, danger: true, run: () => deleteCustomLayout(c.id) })),
    });
  }
  items.push(SEP, cmdItem("view.saveLayout"), cmdItem("view.resetLayout"));
  return items;
}

/** One checkbox entry per registered panel. */
export function panelToggleItems(): MenuItem[] {
  return listPanelDefs().map((d) => ({
    label: d.title,
    icon: d.icon,
    type: "checkbox" as const,
    checked: isPanelOpen(d.id),
    disabled: d.closable === false,
    disabledReason: d.closable === false ? "This panel cannot be closed" : undefined,
    run: () => togglePanel(d.id),
  }));
}

export type MenuBarId = "file" | "edit" | "view" | "window" | "help";

export const MENU_BAR: Array<{ id: MenuBarId; label: string }> = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "view", label: "View" },
  { id: "window", label: "Window" },
  { id: "help", label: "Help" },
];

export function buildMenuBarMenu(id: MenuBarId): MenuItem[] {
  switch (id) {
    case "file":
      return [
        cmdItem("file.new"),
        cmdItem("file.newFromTemplate"),
        cmdItem("file.samples"),
        cmdItem("file.open"),
        SEP,
        cmdItem("file.save"),
        cmdItem("file.saveAs"),
        cmdItem("file.snapshotNow"),
        cmdItem("file.snapshots"),
        SEP,
        cmdItem("file.export"),
      ];
    case "edit":
      return [
        cmdItem("edit.undo"),
        cmdItem("edit.redo"),
        SEP,
        cmdItem("edit.cut"),
        cmdItem("edit.copy"),
        cmdItem("edit.paste"),
        cmdItem("edit.duplicate"),
        cmdItem("edit.delete"),
        SEP,
        cmdItem("edit.selectAll"),
        cmdItem("edit.findNode"),
        { label: "Arrange", submenu: arrangeMenu() },
        SEP,
        cmdItem("app.preferences"),
        cmdItem("app.commandPalette"),
      ];
    case "view":
      return [
        { label: "Layout", icon: undefined, submenu: layoutMenu() },
        cmdItem("view.toggleMaximize"),
        cmdItem("view.fullscreen"),
        SEP,
        cmdItem("app.commandPalette"),
      ];
    case "window":
      return [...panelToggleItems(), SEP, { label: "Layout", submenu: layoutMenu() }];
    case "help":
      return [
        cmdItem("help.docs", { label: "Documentation" }),
        cmdItem("help.github", { label: "GitHub Repository" }),
        cmdItem("help.issues", { label: "Report an Issue" }),
        SEP,
        cmdItem("help.shortcuts", { label: "Keyboard Shortcuts" }),
        cmdItem("help.welcome", { label: "Welcome Screen" }),
        SEP,
        cmdItem("help.about", { label: "About" }),
      ];
  }
}
