import { type Bundle, type BundleFile, type Graph, concatForClipboard } from "@/core";
import { collectBakedPngs } from "../pro/bakeActions";
import { copyToClipboard, toast } from "@/ui";
import { downloadBytes, downloadText } from "../lib/download";
import { bundleToZip } from "./zip";

/** Export dialog actions (shared by the buttons and the `export.file` context menu). Clipboard / download are the only browser boundaries. */
export const baseName = (path: string): string => path.split("/").pop() ?? path;

export async function copyFile(f: BundleFile): Promise<boolean> {
  const ok = await copyToClipboard(f.content);
  toast.show(
    ok
      ? { title: `Copied ${baseName(f.path)}`, kind: "success", duration: 1600 }
      : { title: "Copy failed", description: "The browser blocked clipboard access.", kind: "danger" },
  );
  return ok;
}
export async function copyPath(f: BundleFile): Promise<boolean> {
  const ok = await copyToClipboard(f.path);
  toast.show(
    ok
      ? { title: "Copied path", description: f.path, kind: "success", duration: 1600 }
      : { title: "Copy failed", kind: "danger" },
  );
  return ok;
}
export function downloadFile(f: BundleFile): void {
  downloadText(baseName(f.path), f.content);
}
function downloadZip(b: Bundle, binaries: Readonly<Record<string, Uint8Array>> = {}): void {
  try {
    downloadBytes(`${b.root}.zip`, bundleToZip(b, binaries));
    toast.show({
      title: "Exported zip",
      description: `${b.files.length + Object.keys(binaries).length} files in ${b.root}.zip`,
      kind: "success",
      duration: 2400,
    });
  } catch (e) {
    toast.show({ title: "Export failed", description: (e as Error).message, kind: "danger" });
  }
}
/** Zip including the PNGs of every live Bake-to-Texture result (`Textures/`), as listed in the bundle README (O9). */
export async function exportZip(b: Bundle, graph: Graph): Promise<void> {
  downloadZip(b, await collectBakedPngs(graph));
}
export async function copyAll(b: Bundle): Promise<boolean> {
  const ok = await copyToClipboard(concatForClipboard(b.files));
  toast.show(
    ok
      ? { title: "Copied all selected shaders", kind: "success", duration: 1800 }
      : { title: "Copy failed", kind: "danger" },
  );
  return ok;
}
