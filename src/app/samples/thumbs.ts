import type * as THREE from "three";
import { DEF_MASTER, type Graph, type SampleIndexEntry, parseKShader, readEmbedded } from "@/core";
import { defaultTexture, textureFromBlob, disposeTexture } from "@/preview/engine/textures";
import { ThumbRenderer } from "@/preview/thumbs/thumbRenderer";
import { sampleText } from "./source";

const MASTER_PRIORITY = ["baseColor", "Color", "emission", "color"];

/**
 * Nodes that can represent the sample, best first: the source of the sample's `thumbnailSlot` (default: the master's colour slots in
 * `MASTER_PRIORITY` order), the other master inputs, then the upstream nodes of the best source (breadth-first, ≤ 12). The renderer
 * takes the first one that compiles — samples whose final colour needs engine scene resources (Scene Color / Scene Depth) still get a
 * meaningful thumbnail from an upstream node.
 */
function representativeCandidates(graph: Graph, slot?: string): string[] {
  const master = Object.values(graph.nodes).find((n) => n.defId === DEF_MASTER);
  if (!master) return [];
  const edges = Object.values(graph.edges);
  const into = edges.filter((e) => e.to.node === master.id);
  const out: string[] = [];
  const push = (id: string | undefined): void => { if (id && !out.includes(id) && graph.nodes[id]?.defId !== "portalIn" && graph.nodes[id]?.defId !== "portalOut") out.push(id); };
  for (const sl of [...(slot ? [slot] : []), ...MASTER_PRIORITY]) push(into.find((x) => x.to.port === sl)?.from.node);
  for (const e of into) push(e.from.node);
  const queue = out.slice(0, 1);
  for (let i = 0; i < queue.length && out.length < 12; i++) for (const e of edges) if (e.to.node === queue[i]) { const before = out.length; push(e.from.node); if (out.length > before) queue.push(e.from.node); }
  return out;
}

/** The node whose output best represents the sample (first candidate). */
export const representativeNode = (graph: Graph, slot?: string): string | null => representativeCandidates(graph, slot)[0] ?? null;

/** Pause between two queued thumbnail renders (ms). */
const THUMB_GAP_MS = 16;

const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

let renderer: ThumbRenderer | null = null;
const cache = new Map<string, Promise<string | null>>();
let chain: Promise<unknown> = Promise.resolve();

async function render(entry: SampleIndexEntry, size: number): Promise<string | null> {
  const text = await sampleText(entry.file);
  const graph = parseKShader(text).graph;
  const candidates = representativeCandidates(graph, entry.thumbnailSlot);
  if (candidates.length === 0) return null;
  const payload = readEmbedded(text);
  const nearest = entry.previewConfig.nearest === true;
  const texs = new Map<string, THREE.Texture>();
  try {
    for (const [propId, assetId] of Object.entries(payload?.bindings ?? {})) {
      const a = payload?.assets.find((x) => x.id === assetId);
      if (a) texs.set(propId, await textureFromBlob(new Blob([fromBase64(a.dataBase64) as BlobPart], { type: a.mime }), nearest));
    }
    renderer ??= new ThumbRenderer();
    let e: ReturnType<ThumbRenderer["compile"]> = null;
    for (const node of candidates) {
      const c = renderer.compile(graph, node, { raw: true, texture: (p) => texs.get(p.id) ?? defaultTexture(p.textureDefault) });
      if (c && c.ok) { e = c; break; }
    }
    if (!e) return null;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    return renderer.render(e, canvas, 1.2) ? canvas.toDataURL("image/png") : null;
  } finally {
    for (const t of texs.values()) disposeTexture(t);
  }
}

/** PNG data URL of a live thumbnail of the sample (null = not renderable here). Rendered one at a time on the shared GL context; cached. */
export function sampleThumbnail(entry: SampleIndexEntry, size = 192): Promise<string | null> {
  const key = `${entry.id}@${size}`;
  let p = cache.get(key);
  if (!p) {
    // One render at a time on the shared GL context, with a short pause after each so the UI thread (scrolling, typing, docking) is never starved.
    p = new Promise<string | null>((res) => { chain = chain.then(() => render(entry, size).then(res, () => res(null)).then(() => new Promise<void>((r) => setTimeout(r, THUMB_GAP_MS)))); });
    cache.set(key, p);
  }
  return p;
}
