import { SAMPLE_GRAPHS } from "@/core";
import { openProject, saveProject } from "@/app/project/projectIo";
import { getActiveDoc, getRootDoc, openDoc } from "./graphStore";

/** Save the active graph (real file handle where the browser allows it, `.kshader` download otherwise) + local history + recents — see `app/project/projectIo`. */
export function saveActiveGraph(as = false): boolean {
  if (!getRootDoc()) return false;
  void saveProject(as);
  return true;
}

/** Open a `.kshader` through the native picker (File System Access) or the upload fallback — implemented once in `app/project/projectIo`. */
export const openGraphFile = (): void => void openProject();

/** First run: open the first sample graph so the canvas is never empty. */
export function ensureStartupDoc(): void {
  if (getActiveDoc()) return;
  const s = SAMPLE_GRAPHS[0];
  if (s) openDoc(s.build(), { emitOptions: s.emitOptions ?? {}, fit: true });
}
