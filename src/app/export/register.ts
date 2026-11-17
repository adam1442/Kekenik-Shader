import { ClipboardCopy, Download, FileDown, Link2, Package } from "lucide-react";
import type { MenuItem } from "@/ui";
import { buildBundle } from "@/core";
import { getActiveDoc, getGraph } from "@/ui/graph/graphStore";
import { registerCommand } from "../commands/registry";
import { registerContextMenu } from "../contextmenu/registry";
import { APP_VERSION } from "../lib/version";
import { copyFile, copyPath, downloadFile, exportZip } from "./actions";
import { selectionOf, useExport } from "./exportStore";

/** `file.export` command (menu + toolbar + Mod+E) and the `export.file` context-menu scope (right-click a file row in the dialog). */
export function registerExportFeatures(): void {
  registerCommand({
    id: "file.export",
    title: "Export Shader…",
    category: "File",
    icon: Download,
    shortcut: "Mod+E",
    when: () => !!getActiveDoc(),
    run: () => useExport.getState().show(getGraph()),
  });
  registerContextMenu("export.file", (_t, _e, info): MenuItem[] => {
    const s = useExport.getState();
    const bundle = s.graph ? buildBundle(s.graph, selectionOf(s.choices), { generatorVersion: APP_VERSION }) : null;
    const f = bundle?.files.find((x) => x.path === info.id);
    if (!bundle || !f) return [{ label: "No file", disabled: true }];
    return [
      { id: "export.file.copy", label: "Copy file", icon: ClipboardCopy, run: () => void copyFile(f) },
      { id: "export.file.copyPath", label: "Copy path", icon: Link2, run: () => void copyPath(f) },
      { id: "export.file.download", label: "Download this file", icon: FileDown, run: () => downloadFile(f) },
      { separator: true },
      {
        id: "export.file.zip",
        label: "Export all as zip",
        icon: Package,
        run: () => void (s.graph && exportZip(bundle, s.graph)),
      },
    ];
  });
}
