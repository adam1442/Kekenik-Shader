import type { Graph, ParamValue } from "../graph/types";
import { DEF_MASTER } from "../graph/types";
import { ops } from "../graph/ops/make";
import type { GraphOp } from "../graph/ops/types";
import type { MasterBlock, ProfileDef } from "../registry/profile";
import type { Stage } from "../ir/types";

/**
 * Master Stack model (engine-agnostic, S2): the Master Output shows two stacked contexts — Vertex then Fragment —
 * whose blocks are the profile's master blocks. Required blocks are always there; optional blocks can be added / removed
 * (`graph.master` context menu). Blocks whose `shownWhen` option is off stay visible but INACTIVE (dimmed, wire kept).
 */
const HIDDEN_BLOCKS_KEY = "hiddenBlocks";
const CONTEXT_LABEL: Record<Stage, string> = { vertex: "Vertex", fragment: "Fragment", light: "Light (per light)" };

/** Ids of optional blocks the user removed from the stack (stored as a comma-separated graph setting). */
function hiddenBlockIds(settings: Readonly<Record<string, ParamValue>>): string[] {
  const v = settings[HIDDEN_BLOCKS_KEY];
  return typeof v === "string" && v ? v.split(",").filter(Boolean) : [];
}

/** `shownWhen` evaluation (same rule as the compiler: an inactive block's wire is kept but its value ignored). */
const blockActive = (b: MasterBlock, settings: Readonly<Record<string, ParamValue>>): boolean =>
  !b.shownWhen || (settings[b.shownWhen.setting] ?? b.shownWhen.default) === b.shownWhen.equals;

/** Id of the graph's Master Output node (there is exactly one in a normal graph). */
export const masterNodeIdOf = (g: Graph): string | undefined =>
  Object.values(g.nodes).find((n) => n.defId === DEF_MASTER)?.id;

export interface MasterEntry {
  block: MasterBlock;
  context: string;
  /** Removed by the user (optional blocks only) — still listed in the menu so it can be added back. */
  hidden: boolean;
  /** `shownWhen` holds. */
  active: boolean;
  connected: boolean;
}

/** Every block of the profile, Vertex context first, each context in profile order. */
export function masterEntries(graph: Graph, profile: ProfileDef): MasterEntry[] {
  const id = masterNodeIdOf(graph);
  const wired = new Set(
    Object.values(graph.edges)
      .filter((e) => e.to.node === id)
      .map((e) => e.to.port),
  );
  const hidden = new Set(hiddenBlockIds(graph.settings));
  const rows = profile.masterBlocks.map((block): MasterEntry => ({
    block,
    context: CONTEXT_LABEL[block.stage],
    hidden: !block.required && hidden.has(block.id),
    active: blockActive(block, graph.settings),
    connected: wired.has(block.id),
  }));
  return [
    ...rows.filter((r) => r.block.stage === "vertex"),
    ...rows.filter((r) => r.block.stage === "fragment"),
    ...rows.filter((r) => r.block.stage === "light"),
  ];
}

/** Blocks shown as ports: required ones, added optional ones, and any block that still has a wire (never hide a live connection). */
export const visibleMasterEntries = (graph: Graph, profile: ProfileDef): MasterEntry[] =>
  masterEntries(graph, profile).filter((e) => !e.hidden || e.connected);

export interface BlockVisibilityPlan {
  ok: boolean;
  reason?: string;
  ops: GraphOp[];
}

/** Add (`visible`) or remove an optional block. Removing disconnects its wire (the source node stays). Required blocks cannot be removed. */
export function planBlockVisibility(
  graph: Graph,
  profile: ProfileDef,
  blockId: string,
  visible: boolean,
): BlockVisibilityPlan {
  const block = profile.masterBlocks.find((b) => b.id === blockId);
  if (!block) return { ok: false, reason: `Unknown block "${blockId}"`, ops: [] };
  if (block.required && !visible) return { ok: false, reason: `"${block.label}" is required`, ops: [] };
  const hidden = new Set(hiddenBlockIds(graph.settings));
  if (visible === !hidden.has(blockId)) return { ok: true, ops: [] };
  const plan: GraphOp[] = [];
  if (visible) hidden.delete(blockId);
  else {
    const id = masterNodeIdOf(graph);
    for (const e of Object.values(graph.edges))
      if (e.to.node === id && e.to.port === blockId) plan.push(ops.disconnect(e.id));
    hidden.add(blockId);
  }
  plan.push(ops.setSettings({ [HIDDEN_BLOCKS_KEY]: hidden.size ? [...hidden].sort().join(",") : null }));
  return { ok: true, ops: plan };
}
