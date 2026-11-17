import {
  type BakeFormat,
  type BakeRecord,
  type Graph,
  type GraphOp,
  bakeKey,
  canonicalFromDisplayName,
  createNode,
  freeReferenceName,
  makeProperty,
  ops,
  takenReferenceNames,
  uniquifyName,
} from "@/core";
import type { BakeAnalysis } from "./analysis";

export interface BakeChoice {
  res: number;
  format: BakeFormat;
  name: string;
  tileable: boolean;
}
export interface BakeIds {
  prop: string;
  propNode: string;
  sample: string;
  swizzle: string;
  group: string;
}

/** Nodes that exist ONLY to feed `nodeId` (its upstream cone minus anything another consumer still reads). */
function exclusiveCone(graph: Graph, nodeId: string, ignoreEdges: ReadonlySet<string>): string[] {
  const edges = Object.values(graph.edges).filter((e) => !ignoreEdges.has(e.id));
  const cone = new Set<string>([nodeId]);
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const e of edges)
      if (e.to.node === id && !cone.has(e.from.node)) {
        cone.add(e.from.node);
        stack.push(e.from.node);
      }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...cone]) {
      if (id === nodeId) continue;
      if (edges.some((e) => e.from.node === id && !cone.has(e.to.node))) {
        cone.delete(id);
        changed = true;
      }
    }
  }
  return [...cone].sort();
}

/**
 * The graph edit that replaces the baked cone by a texture read (ONE undo step when committed together):
 * texture property + Property node + Sample Texture 2D (UV0), a Swizzle `x` for float cones, every consumer of the baked output re-wired,
 * the original cone left in place (detached, because nothing reads it any more) inside a "Baked source" group, and the re-bake record.
 */
export function planBake(
  graph: Graph,
  nodeId: string,
  a: BakeAnalysis,
  c: BakeChoice,
  ids: BakeIds,
): { ops: GraphOp[]; record: BakeRecord } | null {
  const node = graph.nodes[nodeId];
  if (!node || !a.ok || !a.port || !a.channels) return null;
  const consumers = Object.values(graph.edges).filter((e) => e.from.node === nodeId && e.from.port === a.port);
  const taken = new Set([...graph.properties.map((p) => p.displayName), ...graph.keywords.map((k) => k.displayName)]);
  const display = uniquifyName(c.name.trim() || "Baked", taken);
  const ref = freeReferenceName(
    canonicalFromDisplayName(display),
    takenReferenceNames(graph.properties, graph.keywords),
  );
  const file = `${ref.replace(/^_+/, "") || "baked"}.png`;
  const prop = makeProperty(ids.prop, display, "texture2D", {
    referenceName: ref,
    textureDefault: "white",
    colorSpace: "linear",
  });
  const at = { x: node.position.x + 300, y: node.position.y };
  const reader = createNode(ids.propNode, "property", {
    position: { x: at.x, y: at.y + 90 },
    params: { property: ids.prop },
  });
  const sample = createNode(ids.sample, "sampleTexture2D", { position: { x: at.x + 230, y: at.y } });
  const list: GraphOp[] = [
    ops.addProperty(prop),
    ops.addNode(reader),
    ops.addNode(sample),
    ops.connect({ node: reader.id, port: "out" }, { node: sample.id, port: "tex" }),
  ];
  let source = { node: sample.id, port: "rgb" };
  if (a.channels === 1) {
    list.push(
      ops.addNode(createNode(ids.swizzle, "swizzle", { position: { x: at.x + 460, y: at.y }, params: { mask: "x" } })),
      ops.connect(source, { node: ids.swizzle, port: "in" }),
    );
    source = { node: ids.swizzle, port: "out" };
  }
  for (const e of consumers) list.push(ops.disconnect(e.id), ops.connect(source, e.to));
  const cone = exclusiveCone(graph, nodeId, new Set(consumers.map((e) => e.id)));
  const label = node.label || nodeId;
  list.push(
    ops.addGroup({
      id: ids.group,
      title: `Baked source — ${label} (detached; right-click → Re-bake)`,
      color: "#64748b",
      nodeIds: cone,
    }),
  );
  const record: BakeRecord = {
    v: 1,
    src: nodeId,
    port: a.port,
    prop: ids.prop,
    sample: ids.sample,
    group: ids.group,
    res: c.res,
    format: c.format,
    file,
    tileable: c.tileable,
  };
  list.push(ops.setSettings({ [bakeKey(ids.sample)]: JSON.stringify(record) }));
  return { ops: list, record };
}

/** Record update after a re-bake (new resolution / format / seam result). */
export const rebakeOps = (r: BakeRecord, c: Pick<BakeChoice, "res" | "format" | "tileable">): GraphOp[] => [
  ops.setSettings({
    [bakeKey(r.sample)]: JSON.stringify({ ...r, res: c.res, format: c.format, tileable: c.tileable }),
  }),
];

/** Measure how well a bake tiles: wrap-around edge differences compared with the typical neighbour difference ALONG THE SAME AXIS (0…255 units). */
export interface SeamReport {
  horizontal: number;
  vertical: number;
  neighbour: number;
  tileable: boolean;
}
export function seamReport(px: ArrayLike<number>, w: number, h: number, channels: 1 | 3 = 3): SeamReport {
  const at = (x: number, y: number, ch: number): number => px[(y * w + x) * 4 + ch]!;
  const diff = (x0: number, y0: number, x1: number, y1: number): number => {
    let d = 0;
    for (let ch = 0; ch < channels; ch++) d += Math.abs(at(x0, y0, ch) - at(x1, y1, ch));
    return d / channels;
  };
  let hz = 0,
    vt = 0,
    nbH = 0,
    nbV = 0,
    n = 0;
  for (let y = 0; y < h; y++) hz += diff(0, y, w - 1, y);
  for (let x = 0; x < w; x++) vt += diff(x, 0, x, h - 1);
  const step = Math.max(1, Math.floor(Math.min(w, h) / 64));
  for (let y = 0; y < h - 1; y += step)
    for (let x = 0; x < w - 1; x += step) {
      nbH += diff(x, y, x + 1, y);
      nbV += diff(x, y, x, y + 1);
      n++;
    }
  nbH = n ? nbH / n : 0;
  nbV = n ? nbV / n : 0;
  const horizontal = hz / h,
    vertical = vt / w;
  // Per-axis comparison: a pattern that only varies along x must not be judged against the (zero) differences along y.
  const tileable = horizontal <= 1.5 * nbH + 2 && vertical <= 1.5 * nbV + 2;
  return { horizontal, vertical, neighbour: (nbH + nbV) / 2, tileable };
}
