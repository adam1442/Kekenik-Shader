import { KSHADER_EXTENSION, parseKShader } from "@/core";
import { toast } from "@/ui";
import { downloadText } from "@/app/lib/download";
import { getRootDoc, markSaved, openDoc } from "@/ui/graph/graphStore";
import { usePrefs } from "@/app/prefs/preferences";
import { projectText, restoreEmbedded } from "./embedAssets";
import { restorePreviewSection } from "./previewState";
import { addRecent } from "./recents";
import { clearRecovery } from "./recovery";
import { snapshots } from "./snapshotStore";

/* File System Access API (Chromium) with a download / upload fallback. Handles live in memory per document id. */
interface FsHandle {
  name: string;
  createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }>;
  getFile(): Promise<File>;
}
type Picker = {
  showSaveFilePicker?: (o: unknown) => Promise<FsHandle>;
  showOpenFilePicker?: (o: unknown) => Promise<FsHandle[]>;
};
const picker = (): Picker => (typeof window === "undefined" ? {} : (window as unknown as Picker));
export const hasFileSystemAccess = (): boolean => typeof picker().showSaveFilePicker === "function";
const FILE_TYPES = [{ description: "Kekenik Shader graph", accept: { "application/json": [KSHADER_EXTENSION] } }];
const handles = new Map<string, FsHandle>();

const safeName = (n: string): string => (n || "Untitled").replace(/[^\w\- ]+/g, "_");

/** Record a saved copy in the local history + recents + clear the crash-recovery record. */
async function recordSaved(name: string, text: string, nodes: number, label = "Saved"): Promise<void> {
  const s = (await snapshots.add(name, label, text, nodes)) ?? (await snapshots.list(name))[0];
  if (s) addRecent({ name, time: Date.now(), snapshotId: s.id });
  clearRecovery();
}

/** Save the active project. Uses a real file handle when the browser allows it (no download dialog on repeat saves). */
export async function saveProject(as = false): Promise<boolean> {
  const d = getRootDoc();
  if (!d) return false;
  const text = await projectText(d.graph, usePrefs.getState().embedAssets);
  const nodes = Object.keys(d.graph.nodes).length;
  const base = d.fileName && !as ? d.fileName.replace(/\.kshader$/i, "") : safeName(d.graph.name);
  const fileName = `${base}${KSHADER_EXTENSION}`;
  try {
    const p = picker();
    if (p.showSaveFilePicker) {
      let h = as ? undefined : handles.get(d.id);
      if (!h) h = await p.showSaveFilePicker({ suggestedName: fileName, types: FILE_TYPES });
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
      handles.set(d.id, h);
      markSaved(h.name);
      toast.show({ title: "Graph saved", description: h.name, kind: "success" });
      await recordSaved(d.graph.name, text, nodes);
      return true;
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return false; // user cancelled the picker
    // any other failure (permissions, sandbox) → fall through to the download path
  }
  downloadText(fileName, text);
  markSaved(fileName);
  toast.show({ title: "Graph saved", description: fileName, kind: "success" });
  await recordSaved(d.graph.name, text, nodes);
  return true;
}

/** Open a project: native picker when available, otherwise `<input type=file>`. */
export async function openProject(): Promise<void> {
  const p = picker();
  if (p.showOpenFilePicker) {
    try {
      const [h] = await p.showOpenFilePicker({ types: FILE_TYPES });
      if (!h) return;
      const f = await h.getFile();
      const id = openText(await f.text(), f.name);
      if (id) handles.set(id, h);
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = `${KSHADER_EXTENSION},application/json`;
  input.onchange = async () => {
    const f = input.files?.[0];
    if (f) openText(await f.text(), f.name);
  };
  input.click();
}

/** Parse + open; reports errors with a toast. Returns the new document id. */
export function openText(text: string, fileName = ""): string | null {
  try {
    const { graph } = parseKShader(text);
    void restoreEmbedded(text); // optional embedded textures (no-op for plain projects)
    const id = openDoc(graph, { fileName, fit: true });
    restorePreviewSection(text); // preview / material state saved in the file (after the document is active)
    return id;
  } catch (e) {
    toast.show({ title: "Could not open file", description: (e as Error).message, kind: "danger" });
    return null;
  }
}
