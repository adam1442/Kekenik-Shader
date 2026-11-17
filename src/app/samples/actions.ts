import { type SampleIndexEntry, sampleSubgraphBundle } from "@/core";
import { toast } from "@/ui";
import { getActiveDoc } from "@/ui/graph/graphStore";
import { importSubgraphText } from "@/ui/graph/subgraphActions";
import { openText } from "@/app/project/projectIo";
import { sampleText } from "./source";

/** Open a sample as a NEW project tab (embedded textures + preview configuration are restored by `openText`). Returns the document id. */
export async function openSampleAsProject(entry: SampleIndexEntry): Promise<string | null> {
  try {
    const id = openText(await sampleText(entry.file));
    if (id) toast.show({ title: `Opened “${entry.title}”`, description: "Save it with Ctrl/Cmd+S to make your own copy.", kind: "success" });
    return id;
  } catch (e) {
    toast.show({ title: "Could not load the sample", description: (e as Error).message, kind: "danger" });
    return null;
  }
}

/** Insert one reusable subgraph of a sample (with its dependencies) into the ACTIVE project. */
export async function insertSampleSubgraph(entry: SampleIndexEntry, subgraphId: string): Promise<boolean> {
  if (!getActiveDoc()) { toast.show({ title: "Open a project first", description: "Subgraphs are inserted into the active project.", kind: "warning" }); return false; }
  try {
    const bundle = sampleSubgraphBundle(await sampleText(entry.file), subgraphId);
    if (!bundle) throw new Error(`The sample has no subgraph “${subgraphId}”`);
    const r = importSubgraphText(bundle);
    toast.show(r.ok ? { title: "Subgraph inserted", description: `${subgraphId} — find it under Subgraphs in the node search`, kind: "success" } : { title: "Could not insert the subgraph", description: r.error, kind: "danger" });
    return r.ok;
  } catch (e) {
    toast.show({ title: "Could not insert the subgraph", description: (e as Error).message, kind: "danger" });
    return false;
  }
}
