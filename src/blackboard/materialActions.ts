import { materialToJson, parseMaterialJson } from "@/core";
import { copyToClipboard, pasteText } from "@/ui/controls/clipboard";
import { toast } from "@/ui";
import { getGraph } from "@/ui/graph/graphStore";
import { applyMaterialPaste, getKeywordValues, getMaterialValues } from "./materialStore";

/** Current material as portable JSON text (overrides over defaults; textures are not portable). */
const materialJsonText = (): string =>
  JSON.stringify(materialToJson(getGraph(), getMaterialValues(), getKeywordValues()), null, 2);

export async function copyMaterialJson(): Promise<boolean> {
  const ok = await copyToClipboard(materialJsonText());
  toast.show({
    title: ok ? "Parameter values copied" : "Could not access the clipboard",
    kind: ok ? "success" : "danger",
  });
  return ok;
}

/** Apply JSON text (from the clipboard or a test) to the active material. Returns the number of applied entries, or an error. */
function pasteMaterialJson(text: string): { applied: number; warnings: string[] } | { error: string } {
  const r = parseMaterialJson(getGraph(), text);
  if ("error" in r) return r;
  applyMaterialPaste(r);
  return { applied: Object.keys(r.values).length + Object.keys(r.keywords).length, warnings: r.warnings };
}

export async function pasteMaterialFromClipboard(): Promise<void> {
  const r = pasteMaterialJson(await pasteText());
  if ("error" in r) toast.show({ title: "Paste failed", description: r.error, kind: "danger" });
  else
    toast.show({
      title: `Pasted ${r.applied} value${r.applied === 1 ? "" : "s"}`,
      ...(r.warnings.length ? { description: r.warnings.slice(0, 3).join("\n") } : {}),
      kind: r.warnings.length ? "warning" : "success",
    });
}
