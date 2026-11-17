/** Sample → `.kshader` text + index entry. Deterministic: identical input ⇒ byte-identical output. */
import { type Graph, type SampleIndexEntry, type SampleMeta, embedPayload, embedPreview, previewSectionOf, serializeGraph, summarizeParameters } from "@/core";
import { encodePng, toBase64 } from "../textures/png";
import type { Sample } from "./dsl";

export interface SampleModule { meta: SampleMeta; build: () => Sample }

export interface Emitted { file: string; text: string; entry: SampleIndexEntry; graph: Graph }

export function emitSample(m: SampleModule): Emitted {
  const s = m.build();
  const graph = s.build();
  const bindings = Object.fromEntries(s.textures.map((t) => [t.propId, t.assetId]));
  const { prefs, sim } = previewSectionOf(m.meta.previewConfig);
  let text = embedPreview(serializeGraph(graph), { prefs, sim, bindings, material: { values: {}, keywords: {} }, presets: {} });
  text = embedPayload(text, {
    assets: s.textures.map((t) => ({ id: t.assetId, name: `${t.name}.png`, mime: "image/png", dataBase64: toBase64(encodePng(t.tex)) })),
    bindings,
  });
  const file = `${m.meta.id}.kshader`;
  const entry: SampleIndexEntry = {
    ...m.meta, file, nodes: Object.keys(graph.nodes).length, groups: graph.groups.length, comments: graph.comments.length,
    subgraphs: Object.keys(graph.subgraphDefs).sort(), textures: s.textures.map((t) => `${t.name} (${t.tex.w}×${t.tex.h})`),
    parameters: summarizeParameters(graph.properties, Object.fromEntries(s.textures.map((t) => [t.propId, t.name]))), bytes: text.length,
  };
  return { file, text, entry, graph };
}
