/**
 * Sample layout engine (docs/SAMPLES.md §Layout). Every logical block is laid out on its own with the core's layered `autoLayout`
 * (left → right, no overlaps), framed by a titled group with an explanatory note INSIDE the frame (so the note moves with the group),
 * and the frames are placed on a coarse grid (`col` = reading order, `row` = stacking). Sizes are conservative estimates of the canvas
 * geometry (`ui/graph/layout.ts`: header 32, rows 24, width ≤ 236) — over-estimating only costs whitespace.
 */
import { type Comment, type Group, type LayoutEdge, type LayoutNode, type NodeInstance, type SubgraphDef, activeBlocks, autoLayout, defaultNodeRegistry, targetProfiles } from "@/core";

const HEADER_H = 32;
const ROW_H = 24;
const NODE_W = 236;
const FRAME_PAD = 22;
const FRAME_TITLE = 34;
const COL_GAP = 160;
const ROW_GAP = 70;

export interface Size { w: number; h: number }
export interface PortLists { inputs: string[]; outputs: string[]; params: number }

export interface LayoutEnv {
  subDefs: Readonly<Record<string, SubgraphDef>>;
  profileId?: string;
  settings?: Readonly<Record<string, string | number | boolean | number[]>>;
  /** Port lists of the enclosing subgraph's boundary nodes. */
  io?: { inputs: string[]; outputs: string[] };
}

/** Port ids of a node (static ports, dynamic ports, subgraph instances, master blocks, subgraph I/O). */
export function portsOf(n: NodeInstance, env: LayoutEnv): PortLists {
  if (n.defId === "subgraphInputs") return { inputs: [], outputs: env.io?.inputs ?? [], params: 0 };
  if (n.defId === "subgraphOutputs") return { inputs: env.io?.outputs ?? [], outputs: [], params: 0 };
  if (n.defId === "subgraph") {
    const d = env.subDefs[String(n.params.subgraph)];
    if (!d) throw new Error(`Node "${n.id}" instantiates an unknown subgraph "${String(n.params.subgraph)}"`);
    return { inputs: d.inputs.map((p) => p.id), outputs: d.outputs.map((p) => p.id), params: 0 };
  }
  if (n.defId === "masterOutput") {
    const tp = targetProfiles.get(env.profileId ?? "");
    if (!tp) throw new Error(`Unknown profile "${env.profileId}"`);
    return { inputs: activeBlocks(tp, env.settings ?? {}).map((b) => b.id), outputs: [], params: 0 };
  }
  if (n.defId === "property") return { inputs: [], outputs: ["out"], params: 0 };
  const def = defaultNodeRegistry.get(n.defId);
  if (!def) throw new Error(`Unknown node def "${n.defId}" (node "${n.id}")`);
  const dyn = def.dynamicPorts?.(n, { properties: [], keywords: [], subgraphDefs: {} } as never);
  const inputs = (dyn?.inputs ?? def.inputs).map((p) => p.id);
  const outputs = (dyn?.outputs ?? def.outputs).map((p) => p.id);
  return { inputs, outputs, params: (def.params ?? []).length };
}

/** Conservative on-canvas size of a node. */
export function sizeOf(n: NodeInstance, env: LayoutEnv): Size {
  if (n.defId === "reroute") return { w: 24, h: 24 };
  if (n.defId === "portalIn" || n.defId === "portalOut") return { w: 150, h: 34 };
  const p = portsOf(n, env);
  const rows = p.inputs.length + p.outputs.length + p.params + (n.defId === "masterOutput" ? 3 : 0);
  return { w: NODE_W, h: HEADER_H + 12 + rows * ROW_H + (n.previewEnabled ? 96 : 0) };
}

export interface BlockSpec {
  id: string;
  title: string;
  note: string;
  col: number;
  row: number;
  color?: string;
  members: string[];
}

export interface LayoutResult {
  positions: Map<string, { x: number; y: number }>;
  groups: Group[];
  comments: Comment[];
  /** Positions of loose boundary nodes (subgraph inputs / outputs). */
}

/** Estimated height of a markdown note rendered at width `w` (≈ 7 px per character, 17 px per line). */
function noteHeight(text: string, w: number): number {
  const perLine = Math.max(10, Math.floor((w - 28) / 7));
  const lines = text.split("\n").reduce((s, l) => s + Math.max(1, Math.ceil(l.length / perLine)), 0);
  return 22 + lines * 17;
}

interface Frame { spec: BlockSpec; w: number; h: number; noteH: number; inner: Map<string, { x: number; y: number }> }

function frameOf(spec: BlockSpec, nodes: Record<string, NodeInstance>, edges: LayoutEdge[], env: LayoutEnv): Frame {
  const ln: LayoutNode[] = spec.members.map((id) => ({ id, ...sizeOf(nodes[id]!, env), x: 0, y: 0 }));
  const set = new Set(spec.members);
  const pos = autoLayout(ln, edges.filter((e) => set.has(e.from) && set.has(e.to)), { gapX: 70, gapY: 26 });
  let maxX = 0, maxY = 0;
  for (const n of ln) {
    const p = pos.get(n.id) ?? { x: 0, y: 0 };
    maxX = Math.max(maxX, p.x + n.w);
    maxY = Math.max(maxY, p.y + n.h);
  }
  const noteW = Math.max(300, maxX + FRAME_PAD * 2 - 2 * FRAME_PAD);
  const noteH = spec.note ? noteHeight(spec.note, noteW) + 10 : 0;
  const w = Math.max(noteW, maxX) + FRAME_PAD * 2;
  return { spec, w, h: FRAME_TITLE + noteH + maxY + FRAME_PAD * 2, noteH, inner: pos };
}

/**
 * Lay out all blocks. Returns absolute node positions (shifted by `origin`), group frames and note comments.
 * `leftWidth` reserves room at the left for boundary nodes (subgraph inputs).
 */
export function layoutBlocks(blocks: BlockSpec[], nodes: Record<string, NodeInstance>, edges: LayoutEdge[], env: LayoutEnv, origin = { x: 0, y: 0 }): LayoutResult & { width: number; height: number } {
  const frames = blocks.map((b) => frameOf(b, nodes, edges, env));
  const cols = [...new Set(blocks.map((b) => b.col))].sort((a, b) => a - b);
  const positions = new Map<string, { x: number; y: number }>();
  const groups: Group[] = [];
  const comments: Comment[] = [];
  let x = origin.x;
  let height = 0;
  for (const c of cols) {
    const inCol = frames.filter((f) => f.spec.col === c).sort((a, b) => a.spec.row - b.spec.row);
    let y = origin.y;
    const colW = Math.max(...inCol.map((f) => f.w));
    for (const f of inCol) {
      const rect = { x, y, w: f.w, h: f.h };
      const ox = x + FRAME_PAD, oy = y + FRAME_TITLE + f.noteH + FRAME_PAD;
      for (const [id, p] of f.inner) positions.set(id, { x: Math.round(ox + p.x), y: Math.round(oy + p.y) });
      groups.push({ id: `grp_${f.spec.id}`, title: f.spec.title, ...(f.spec.color ? { color: f.spec.color } : {}), nodeIds: [...f.spec.members], rect });
      if (f.spec.note) {
        comments.push({ id: `note_${f.spec.id}`, text: f.spec.note, position: { x: x + FRAME_PAD, y: y + FRAME_TITLE }, size: { w: f.w - FRAME_PAD * 2, h: f.noteH - 10 }, ...(f.spec.color ? { color: f.spec.color } : {}) });
      }
      y += f.h + ROW_GAP;
    }
    height = Math.max(height, y - ROW_GAP - origin.y);
    x += colW + COL_GAP;
  }
  return { positions, groups, comments, width: Math.max(0, x - COL_GAP - origin.x), height };
}
