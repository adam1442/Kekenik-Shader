import { type BakeRecord, type Graph, costModule, compileGraph, liveBakes } from "@/core";
import { deleteAsset, getAssetBlob, importFile } from "@/preview/assets/assetStore";
import { type BakeAnalysis, analyzeBake } from "@/preview/bake/analysis";
import { type BakeChoice, planBake, rebakeOps } from "@/preview/bake/plan";
import type { BakeImage } from "@/preview/bake/render";
import { usePreview } from "@/preview/previewStore";
import { toast } from "@/ui";
import { commit, getActiveDoc, getActiveScope, getGraph, newNodeId } from "@/ui/graph/graphStore";
import { useProUi } from "./proState";

/** Open the Bake-to-Texture dialog for a node of the active (main) graph. */
export function openBake(nodeId: string): void {
  if (getActiveScope() !== undefined) {
    toast.show({
      kind: "info",
      title: "Open the main graph",
      description: "Bake to Texture works on the main graph, not inside a subgraph tab.",
    });
    return;
  }
  useProUi.getState().set({ bakeNode: nodeId });
}

/** The Sample / source record a node belongs to (for the "Re-bake" menu entry), if any. */
export const bakeRecordOf = (graph: Graph, nodeId: string): BakeRecord | undefined =>
  liveBakes(graph).find((r) => r.sample === nodeId || r.src === nodeId);

/** Costliest node that a bake could replace (Budget quick fix). Undefined when nothing bakeable exists. */
function heaviestBakeable(graph: Graph): { id: string; cost: number } | undefined {
  const m = compileGraph(graph, { skipEmit: true }).module;
  if (!m) return undefined;
  const cost = costModule(m, "desktop");
  const ranked = Object.entries(cost.perNode)
    .filter(([id]) => !!graph.nodes[id])
    .sort((a, b) => b[1].cost - a[1].cost || a[0].localeCompare(b[0]));
  for (const [id, c] of ranked) if (c.cost >= 8 && analyzeBake(graph, id).ok) return { id, cost: c.cost };
  return undefined;
}

/** "Bake node to texture" quick fix: opens the dialog for the costliest bakeable node. Returns 1 when a dialog was opened. */
export function applyBakeFix(): number {
  const g = getActiveDoc()?.graph;
  const hit = g ? heaviestBakeable(g) : undefined;
  if (!hit) {
    toast.show({
      kind: "info",
      title: "Nothing to bake",
      description:
        "No expensive node depends only on UV and constants. Wire Time / properties out of the cone, or bake a smaller sub-tree from its context menu.",
    });
    return 0;
  }
  openBake(hit.id);
  return 1;
}

const asFile = (png: Blob, name: string): File => new File([png], name, { type: "image/png" });

/** Commit a bake: import the PNG as an asset, replace the cone (one undo step), bind the texture in the preview. Returns the new property id. */
export async function applyBake(
  nodeId: string,
  a: BakeAnalysis,
  choice: BakeChoice,
  img: BakeImage,
): Promise<string | null> {
  const g = getGraph();
  const ids = {
    prop: newNodeId("prop"),
    propNode: newNodeId("n"),
    sample: newNodeId("n"),
    swizzle: newNodeId("n"),
    group: newNodeId("grp"),
  };
  const plan = planBake(g, nodeId, a, { ...choice, tileable: img.seam.tileable }, ids);
  if (!plan) return null;
  const res = await importFile(asFile(img.png, plan.record.file));
  if (!res.ok || !res.asset) {
    toast.show({ kind: "danger", title: "Bake failed", description: res.error ?? "The PNG could not be stored." });
    return null;
  }
  if (!commit(`Bake ${g.nodes[nodeId]?.label || "node"} to texture`, plan.ops, { select: [ids.sample] })) {
    await deleteAsset(res.asset.id);
    return null;
  }
  usePreview.getState().bind(ids.prop, res.asset.id);
  return ids.prop;
}

/** Re-render an existing bake from its (detached) source cone and swap the bound asset. */
export async function applyRebake(
  r: BakeRecord,
  choice: Pick<BakeChoice, "res" | "format">,
  img: BakeImage,
): Promise<boolean> {
  const old = usePreview.getState().bindings[r.prop];
  const res = await importFile(asFile(img.png, r.file));
  if (!res.ok || !res.asset) {
    toast.show({ kind: "danger", title: "Re-bake failed", description: res.error ?? "The PNG could not be stored." });
    return false;
  }
  usePreview.getState().bind(r.prop, res.asset.id);
  if (old && old !== res.asset.id) await deleteAsset(old);
  commit("Re-bake texture", rebakeOps(r, { ...choice, tileable: img.seam.tileable }));
  return true;
}

/** PNG bytes of every live bake (for the export zip), keyed by the file name inside `Textures/`. */
export async function collectBakedPngs(graph: Graph): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  for (const r of liveBakes(graph)) {
    const blob = getAssetBlob(usePreview.getState().bindings[r.prop]);
    if (blob) out[r.file] = new Uint8Array(await blob.arrayBuffer());
  }
  return out;
}
