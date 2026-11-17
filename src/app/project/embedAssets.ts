import { withPreviewSection } from "./previewState";
import {
  type EmbeddedAsset,
  type EmbeddedPayload,
  type Graph,
  embedPayload,
  readEmbedded,
  serializeGraph,
} from "@/core";
import { getAssetBlob, getAssetMeta, importFile, useAssets } from "@/preview/assets/assetStore";
import { usePreview } from "@/preview/previewStore";

const CHUNK = 0x8000;
const toBase64 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(s);
};
const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Textures bound to the graph's texture properties → embeddable payload (assets missing from the store are skipped). */
async function collectEmbedded(graph: Graph): Promise<EmbeddedPayload> {
  const bound = usePreview.getState().bindings;
  const bindings: Record<string, string> = {};
  const assets = new Map<string, EmbeddedAsset>();
  for (const p of graph.properties) {
    const id = p.type === "texture2D" ? bound[p.id] : null;
    const blob = id ? getAssetBlob(id) : undefined;
    const meta = getAssetMeta(id);
    if (!id || !blob || !meta) continue;
    bindings[p.id] = id;
    if (!assets.has(id))
      assets.set(id, {
        id,
        name: meta.name,
        mime: blob.type || meta.mime,
        dataBase64: toBase64(new Uint8Array(await blob.arrayBuffer())),
      });
  }
  return { assets: [...assets.values()], bindings };
}

/** Project text for saving: the graph, plus the bound textures when `embed` is on. */
export async function projectText(graph: Graph, embed: boolean): Promise<string> {
  const text = withPreviewSection(serializeGraph(graph));
  return embed ? embedPayload(text, await collectEmbedded(graph)) : text;
}

/** After opening a project: import embedded textures that this browser does not have yet (same ids) and bind them. Returns how many were imported. */
export async function restoreEmbedded(text: string): Promise<number> {
  const p = readEmbedded(text);
  if (!p) return 0;
  let n = 0;
  for (const a of p.assets) {
    if (useAssets.getState().items.some((x) => x.id === a.id)) continue;
    const bytes = fromBase64(a.dataBase64);
    const r = await importFile(new File([bytes as BlobPart], a.name, { type: a.mime }), a.id);
    if (r.ok) n++;
  }
  for (const [prop, asset] of Object.entries(p.bindings))
    if (getAssetMeta(asset)) usePreview.getState().bind(prop, asset);
  return n;
}
