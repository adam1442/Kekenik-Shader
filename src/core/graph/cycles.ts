import type { FlatBody } from "./flatten";

export interface TopoResult {
  /** Dependency order (sources first) of every node NOT involved in / downstream of a cycle. */
  order: string[];
  /** Nodes that sit on a dependency cycle (self-loops included). */
  cyclic: string[];
}

/**
 * Kahn topological sort over a flattened body. Because flattening already resolved reroutes and portals,
 * cycles that run THROUGH portals/reroutes show up here as ordinary cycles.
 */
export function topoSort(flat: FlatBody): TopoResult {
  const ids = Object.keys(flat.nodes);
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  const inc = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of flat.edges) {
    if (!indeg.has(e.from.node) || !indeg.has(e.to.node)) continue;
    indeg.set(e.to.node, indeg.get(e.to.node)! + 1);
    out.get(e.from.node)!.push(e.to.node);
    inc.get(e.to.node)!.push(e.from.node);
  }
  const order: string[] = [];
  const queue = ids.filter((id) => indeg.get(id) === 0);
  for (let h = 0; h < queue.length; h++) {
    const id = queue[h]!;
    order.push(id);
    for (const to of out.get(id)!) {
      const d = indeg.get(to)! - 1;
      indeg.set(to, d);
      if (d === 0) queue.push(to);
    }
  }
  if (order.length === ids.length) return { order, cyclic: [] };

  // Remaining nodes are on a cycle or downstream of one. Peel off the downstream ones (no remaining successors).
  const done = new Set(order);
  const remaining = new Set(ids.filter((id) => !done.has(id)));
  const outDeg = new Map<string, number>();
  for (const id of remaining) outDeg.set(id, out.get(id)!.filter((t) => remaining.has(t)).length);
  const stack = [...remaining].filter((id) => outDeg.get(id) === 0);
  while (stack.length) {
    const id = stack.pop()!;
    remaining.delete(id);
    for (const from of inc.get(id)!) {
      if (!remaining.has(from)) continue;
      const d = outDeg.get(from)! - 1;
      outDeg.set(from, d);
      if (d === 0) stack.push(from);
    }
  }
  return { order, cyclic: ids.filter((id) => remaining.has(id)) };
}
