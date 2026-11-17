import type { Graph } from "../graph/types";

/**
 * Bake-to-Texture bookkeeping . A bake replaces a UV-only cone by a Sample Texture 2D node; everything needed to
 * RE-BAKE or to document the texture in an export lives in `graph.settings` under `bake:<sampleNodeId>` as JSON (settings are
 * persisted by `.kshader`, copied by snapshots, ignored by every backend). The original cone stays in the graph, detached and
 * wrapped in a group, so no data is ever lost.
 */
export interface BakeRecord {
  v: 1;
  /** Node whose first output was baked (kept, detached, inside the "Baked source" group). */
  src: string;
  /** Output port id of `src` that was baked. */
  port: string;
  /** Texture property created for the result. */
  prop: string;
  /** Sample Texture 2D node that replaced the cone. */
  sample: string;
  /** "Baked source" group id. */
  group: string;
  /** Edge length in pixels (square bake). */
  res: number;
  format: BakeFormat;
  /** File name of the exported PNG (without folder). */
  file: string;
  /** Seam measurement at bake time (see `seamReport`). */
  tileable: boolean;
}

export type BakeFormat = "r8" | "rgba8";
const BAKE_PREFIX = "bake:";
export const bakeKey = (sampleId: string): string => `${BAKE_PREFIX}${sampleId}`;
export const BAKE_RESOLUTIONS = [64, 128, 256, 512, 1024, 2048] as const;

/** All bake records of a graph (malformed entries are ignored), ordered by sample node id. */
function readBakes(graph: Pick<Graph, "settings">): BakeRecord[] {
  const out: BakeRecord[] = [];
  for (const [k, v] of Object.entries(graph.settings)) {
    if (!k.startsWith(BAKE_PREFIX) || typeof v !== "string") continue;
    try {
      const r = JSON.parse(v) as Partial<BakeRecord>;
      if (
        r.v === 1 &&
        typeof r.src === "string" &&
        typeof r.sample === "string" &&
        typeof r.prop === "string" &&
        typeof r.file === "string"
      )
        out.push(r as BakeRecord);
    } catch {
      /* ignore a corrupt record */
    }
  }
  return out.sort((a, b) => a.sample.localeCompare(b.sample));
}

/** Records whose Sample node still exists (a deleted sample node orphans its record). */
export const liveBakes = (graph: Graph): BakeRecord[] =>
  readBakes(graph).filter((r) => !!graph.nodes[r.sample] && !!graph.nodes[r.src]);

/** README section listing the baked textures that ship next to the shaders (empty when the graph has none). */
export function bakeReadme(graph: Graph): string {
  const bakes = liveBakes(graph);
  if (bakes.length === 0) return "";
  const rows = bakes.map((b) => {
    const p = graph.properties.find((x) => x.id === b.prop);
    return `- \`Textures/${b.file}\` — ${b.res}×${b.res} ${b.format === "r8" ? "R8 (grey)" : "RGBA8"}, ${b.tileable ? "tileable" : "NOT seamless"}; assign it to the material texture **${p?.displayName ?? b.prop}** (\`${p?.referenceName ?? b.prop}\`).`;
  });
  return [
    "## Baked textures (Bake to Texture)",
    "",
    "Expensive UV-only node trees were replaced by one texture read. The PNGs are in `Textures/`; import them with **sRGB (colour texture) OFF** — the bake stores the shader's linear values unchanged — **no compression** for gradients, **Repeat** wrap for tileable bakes, **Bilinear** filtering.",
    "",
    ...rows,
    "",
  ].join("\n");
}
