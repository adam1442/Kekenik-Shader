import {
  Bug,
  Command,
  Expand,
  ExternalLink,
  Info,
  Keyboard,
  LayoutDashboard,
  Maximize,
  RotateCcw,
  Save,
} from "lucide-react";
import { toast } from "@/ui";
import { applyPreset, getDockApi, isPanelOpen, resetLayout, toggleMaximize, togglePanel } from "../dock/controller";
import { listPanelDefs } from "../dock/panelRegistry";
import { listPresets } from "../dock/layouts";
import { GITHUB_ISSUES_URL, GITHUB_REPO_URL } from "../lib/version";
import { setStatus, useUi } from "../state";
import { registerCommand } from "./registry";

const openExternal = (url: string) => {
  window.open(url, "_blank", "noopener,noreferrer");
};

/** Register every built-in command. Safe to call more than once (re-registration replaces). */
export function registerBuiltinCommands(): void {
  registerCommand({
    id: "app.commandPalette",
    title: "Command Palette…",
    category: "View",
    icon: Command,
    shortcut: "Mod+K",
    run: () => useUi.getState().setPalette(!useUi.getState().paletteOpen),
  });
  registerCommand({
    id: "help.github",
    title: "GitHub Repository",
    category: "Help",
    icon: ExternalLink,
    run: () => openExternal(GITHUB_REPO_URL),
  });
  registerCommand({
    id: "help.issues",
    title: "Report an Issue",
    category: "Help",
    icon: Bug,
    run: () => openExternal(GITHUB_ISSUES_URL),
  });
  registerCommand({
    id: "help.shortcuts",
    title: "Keyboard Shortcuts",
    category: "Help",
    icon: Keyboard,
    shortcut: "F1",
    run: () => useUi.getState().setShortcuts(true),
  });
  registerCommand({
    id: "help.about",
    title: "About",
    category: "Help",
    icon: Info,
    run: () => useUi.getState().setAbout(true),
  });
  registerCommand({
    id: "view.resetLayout",
    title: "Reset Layout",
    category: "View",
    icon: RotateCcw,
    run: () => {
      resetLayout();
      setStatus("Layout reset to default");
    },
  });
  registerCommand({
    id: "view.saveLayout",
    title: "Save Layout As…",
    category: "View",
    icon: Save,
    run: () => useUi.getState().setSaveLayout(true),
  });
  registerCommand({
    id: "view.toggleMaximize",
    title: "Maximize / Restore Active Panel",
    category: "View",
    icon: Maximize,
    shortcut: "Mod+Shift+M",
    when: () => !!getDockApi()?.activePanel,
    run: () => {
      const p = getDockApi()?.activePanel;
      if (p) toggleMaximize(p.id);
    },
  });
  registerCommand({
    id: "view.fullscreen",
    title: "Toggle Full Screen",
    category: "View",
    icon: Expand,
    run: () => {
      const doc = document;
      const p = doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen();
      p.catch(() =>
        toast.show({
          title: "Full screen unavailable",
          description: "The browser or embedding frame blocked it.",
          kind: "warning",
        }),
      );
    },
  });

  listPresets().forEach((spec, i) => {
    registerCommand({
      id: `view.layout.${spec.id}`,
      title: `Layout: ${spec.name}`,
      category: "View",
      icon: LayoutDashboard,
      shortcut: `Mod+Alt+${i + 1}`,
      run: () => {
        applyPreset(spec.id);
        setStatus(`Layout: ${spec.name}`);
      },
    });
  });

  for (const def of listPanelDefs()) {
    registerCommand({
      id: `window.panel.${def.id}`,
      title: `Toggle ${def.title}`,
      category: "Window",
      icon: def.icon,
      when: () => def.closable !== false || !isPanelOpen(def.id),
      run: () => togglePanel(def.id),
    });
  }
}
