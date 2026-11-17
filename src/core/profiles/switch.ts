import { applyOperations } from "../graph/ops/apply";
import { ops } from "../graph/ops/make";
import type { GraphOp } from "../graph/ops/types";
import { DEF_MASTER, type Graph, type ParamValue } from "../graph/types";
import { canConvert } from "../types/conversion";
import { validOptionValue } from "./canonical";
import { planLockedProperties } from "./lockedProperties";
import { targetProfiles } from "./registry";
import type { ProfileProblem, TargetProfile } from "./types";

export interface SwitchResult {
  graph: Graph;
  problems: ProfileProblem[];
}

/**
 * Deterministic profile switch. Wires that end at a master block survive when the new profile has a block with the SAME canonical id
 * and a convertible type; others are removed (the source node is NEVER deleted) and reported as `profile.block-dropped`.
 * Options with the same id (and a legal value) are carried over; options that no longer exist are dropped, new ones use their defaults.
 * Engine-level settings (unityVersion, shaderName …) are untouched. The node set never changes.
 */
export function planProfileSwitch(graph: Graph, toId: string): { ops: GraphOp[]; problems: ProfileProblem[] } {
  const to = targetProfiles.get(toId);
  const from = targetProfiles.get(graph.profileId);
  const problems: ProfileProblem[] = [];
  if (!to)
    return {
      ops: [],
      problems: [{ rule: "profile.unknown", severity: "error", message: `Unknown profile "${toId}"` }],
    };
  const list: GraphOp[] = [];
  const master = Object.values(graph.nodes).find((n) => n.defId === DEF_MASTER);
  if (master && from) {
    for (const e of Object.values(graph.edges)) {
      if (e.to.node !== master.id) continue;
      const oldB = from.blocks.find((b) => b.id === e.to.port);
      const newB = to.blocks.find((b) => b.id === e.to.port);
      if (newB && oldB && canConvert(oldB.type, newB.type)) continue;
      list.push(ops.disconnect(e.id));
      const src = graph.nodes[e.from.node];
      problems.push({
        rule: "profile.block-dropped",
        severity: "warning",
        nodeId: e.from.node,
        message: `Block "${oldB?.label ?? e.to.port}" does not exist in "${to.label}"; the connection from node "${src?.label ?? src?.defId ?? e.from.node}" was removed`,
      });
    }
  }
  const patch: Record<string, ParamValue | null> = {};
  const keep = new Set<string>(to.engineSettings);
  const optionIds = new Set<string>();
  for (const d of to.surfaceOptions) {
    optionIds.add(d.id);
    optionIds.add(`expose_${d.id}`);
  }
  const oldOptionIds = new Set<string>();
  for (const d of from?.surfaceOptions ?? []) {
    oldOptionIds.add(d.id);
    oldOptionIds.add(`expose_${d.id}`);
  }
  for (const key of Object.keys(graph.settings)) {
    if (keep.has(key) || !oldOptionIds.has(key)) continue; // engine / unrelated settings stay
    const def = to.surfaceOptions.find((d) => d.id === key);
    const carried = def && validOptionValue(def, graph.settings[key]);
    const exposeOk = key.startsWith("expose_") && optionIds.has(key) && typeof graph.settings[key] === "boolean";
    if (!carried && !exposeOk) patch[key] = null;
  }
  if (Object.keys(patch).length) list.push(ops.setSettings(patch));
  list.push(...planLockedProperties(graph, from, to));
  list.push(ops.setProfile(toId));
  return { ops: list, problems };
}

export function switchProfile(graph: Graph, toId: string): SwitchResult {
  const plan = planProfileSwitch(graph, toId);
  return { graph: plan.ops.length ? applyOperations(graph, plan.ops).graph : graph, problems: plan.problems };
}

export const profileOf = (graph: Graph): TargetProfile | undefined => targetProfiles.get(graph.profileId);
