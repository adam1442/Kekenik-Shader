import {
  type GraphOp,
  canonicalFromDisplayName,
  createNode,
  freeReferenceName,
  makeProperty,
  ops,
  takenReferenceNames,
  uniquifyName,
} from "@/core";
import { getAssetMeta } from "@/preview/assets/assetStore";
import { usePreview } from "@/preview/previewStore";
import { commit, getGraph, newNodeId } from "@/ui/graph/graphStore";

/**
 * A texture asset dropped on the canvas becomes a Texture2D property (named after the file) + Property node + Sample Texture 2D node,
 * wired and created as ONE undo step; the asset is bound to the property so the preview shows it immediately.
 * Returns the property id (null for non-texture assets / unknown ids).
 */
export function dropTextureAsset(assetId: string, world: { x: number; y: number }): string | null {
  const a = getAssetMeta(assetId);
  if (!a || a.kind !== "texture") return null;
  const g = getGraph();
  const taken = new Set([...g.properties.map((p) => p.displayName), ...g.keywords.map((k) => k.displayName)]);
  const display = uniquifyName(
    a.name
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim() || "Texture",
    taken,
  );
  const pid = newNodeId("prop");
  const prop = makeProperty(pid, display, "texture2D", {
    referenceName: freeReferenceName(canonicalFromDisplayName(display), takenReferenceNames(g.properties, g.keywords)),
  });
  const pos = { x: Math.round(world.x - 20), y: Math.round(world.y - 14) };
  const pn = createNode(newNodeId("n"), "property", { position: pos, params: { property: pid } });
  const sn = createNode(newNodeId("n"), "sampleTexture2D", { position: { x: pos.x + 230, y: pos.y - 10 } });
  const list: GraphOp[] = [
    ops.addProperty(prop),
    ops.addNode(pn),
    ops.addNode(sn),
    ops.connect({ node: pn.id, port: "out" }, { node: sn.id, port: "tex" }),
  ];
  if (!commit(`Add texture ${display}`, list, { select: [sn.id] })) return null;
  usePreview.getState().bind(pid, assetId);
  return pid;
}
