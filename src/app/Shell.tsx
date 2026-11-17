import { useEffect } from "react";
import { ErrorBoundary, ToastHost } from "@/ui";
import { installGlobalGuards } from "./bootstrap";
import { AboutDialog, SaveLayoutDialog, ShortcutsDialog } from "./chrome/Dialogs";
import { CommandPalette } from "./chrome/CommandPalette";
import { MenuBar } from "./chrome/MenuBar";
import { StatusBar } from "./chrome/StatusBar";
import { Toolbar } from "./chrome/Toolbar";
import { ContextMenuHost } from "./contextmenu/ContextMenuHost";
import { ExportDialog } from "./export/ExportDialog";
import { ProHost } from "./pro/ProHost";
import { attachDock, detachDock } from "./dock/controller";
import { DockHost } from "./dock/DockHost";
import { setStatus } from "./state";
import { ensureStartupDoc } from "@/ui/graph/fileIo";

/** The editor route: menu bar, toolbar, dock area, status bar and global overlays. */
export function Shell() {
  useEffect(() => {
    const off = installGlobalGuards();
    ensureStartupDoc();
    setStatus("Kekenik Shader ready — press Ctrl/Cmd+K for commands");
    return () => {
      off();
      detachDock();
    };
  }, []);

  return (
    <div className="kk-shell" data-kk="shell">
      <MenuBar />
      <Toolbar />
      <main className="kk-dockwrap" data-ctx-scope="dock.root">
        <ErrorBoundary name="Dock">
          <DockHost onReady={attachDock} />
        </ErrorBoundary>
      </main>
      <StatusBar />
      <CommandPalette />
      <AboutDialog />
      <ShortcutsDialog />
      <SaveLayoutDialog />
      <ExportDialog />
      <ErrorBoundary name="Pro dialogs">
        <ProHost />
      </ErrorBoundary>
      <ContextMenuHost />
      <ToastHost />
    </div>
  );
}
