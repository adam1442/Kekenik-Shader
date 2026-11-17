import type { Graph } from "../graph/types";
import { ops } from "../graph/ops/make";
import type { GraphOp } from "../graph/ops/types";
import { type Property, makeProperty } from "../properties/model";
import { propertyUsage } from "../properties/usage";
import { targetProfiles } from "./registry";
import type { LockedPropertyDef, TargetProfile } from "./types";

/** Locked properties of the graph's current profile. */
const lockedPropertyDefs = (graph: Graph): readonly LockedPropertyDef[] =>
  targetProfiles.get(graph.profileId)?.lockedProperties ?? [];

/** The definition that locks `p` (matched by reference name), if any. */
const lockedDefOf = (graph: Graph, p: Property): LockedPropertyDef | undefined =>
  lockedPropertyDefs(graph).find((d) => d.referenceName === p.referenceName && d.type === p.type);

/** Why the Blackboard refuses to delete / re-reference `p` (undefined = not locked). */
export const lockedReason = (graph: Graph, p: Property): string | undefined => lockedDefOf(graph, p)?.tooltip;

/**
 * Property ops of a profile switch: create the new profile's locked properties that are missing and remove the old profile's ones
 * that nothing reads (a still-used one stays; the exporter then reports it, e.g. `unity.ref-collision`).
 */
export function planLockedProperties(graph: Graph, from: TargetProfile | undefined, to: TargetProfile): GraphOp[] {
  const list: GraphOp[] = [];
  const keep = new Set((to.lockedProperties ?? []).map((d) => d.referenceName));
  for (const d of from?.lockedProperties ?? []) {
    if (keep.has(d.referenceName)) continue;
    const p = graph.properties.find((x) => x.referenceName === d.referenceName && x.type === d.type);
    if (p && propertyUsage(graph, p.id).length === 0) list.push(ops.removeProperty(p.id));
  }
  const names = new Set(graph.properties.map((p) => p.displayName));
  for (const d of to.lockedProperties ?? []) {
    if (graph.properties.some((p) => p.referenceName === d.referenceName)) continue;
    let display = d.displayName;
    for (let i = 2; names.has(display); i++) display = `${d.displayName} ${i}`;
    const id = graph.properties.some((p) => p.id === d.id) ? `${d.id}_${graph.properties.length}` : d.id;
    list.push(
      ops.addProperty(
        makeProperty(id, display, d.type, {
          referenceName: d.referenceName,
          textureDefault: d.textureDefault,
          tooltip: d.tooltip,
        }),
        0,
      ),
    );
  }
  return list;
}
