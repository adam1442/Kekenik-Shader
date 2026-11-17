import type { Graph, Group, Rect4 } from "@/core";
import { GROUP_HEAD, type RectOf, groupContents, groupRect } from "./frames";

/**
 * U11 — group collapse (pure, no DOM). A collapsed group is drawn as just its title bar; its members (and the members of nested groups)
 * are hidden and every wire that touches a hidden member is attached to the group's border (left edge = inputs, right edge = outputs)
 * through a VISUAL proxy. Nothing here changes graph semantics: the graph keeps all nodes, edges and positions.
 */
export interface CollapseInfo {
  /** hidden node id → the OUTERMOST collapsed group that hides it. */
  nodes: ReadonlyMap<string, string>;
  /** groups hidden because they are nested inside a collapsed group. */
  groups: ReadonlySet<string>;
  /** collapsed (visible) group id → its displayed rectangle (title bar only). */
  rects: ReadonlyMap<string, Rect4>;
}

const EMPTY_COLLAPSE: CollapseInfo = { nodes: new Map(), groups: new Set(), rects: new Map() };

/** Displayed frame of a group: the stored frame, or only the title bar when collapsed. */
export const displayRect = (g: Group, rectOf: RectOf): Rect4 => {
  const r = groupRect(g, rectOf);
  return g.collapsed ? { x: r.x, y: r.y, w: r.w, h: GROUP_HEAD } : r;
};

/** Compute what a graph's collapsed groups hide. Outer collapsed groups win over inner ones. */
export function collapseInfo(graph: Graph, rectOf: RectOf): CollapseInfo {
  if (!graph.groups.some((g) => g.collapsed)) return EMPTY_COLLAPSE;
  const nodes = new Map<string, string>();
  const groups = new Set<string>();
  const rects = new Map<string, Rect4>();
  const collapsed = graph.groups.filter((g) => g.collapsed);
  // Visit collapsed groups from the largest frame down so an outer group claims nested ones first.
  const byArea = [...collapsed].sort((a, b) => {
    const ra = groupRect(a, rectOf),
      rb = groupRect(b, rectOf);
    return rb.w * rb.h - ra.w * ra.h;
  });
  for (const g of byArea) {
    if (groups.has(g.id)) continue; // nested in an already collapsed group
    const c = groupContents(graph, g.id, rectOf);
    for (const id of c.nodeIds) if (!nodes.has(id)) nodes.set(id, g.id);
    for (const id of c.groupIds) groups.add(id);
    rects.set(g.id, displayRect(g, rectOf));
  }
  // A nested group that is itself collapsed is hidden: drop it from the visible rects.
  for (const id of groups) rects.delete(id);
  return { nodes, groups, rects };
}

/** Where a wire end attached to a hidden node is drawn: the middle of the collapsed group's left (in) / right (out) border. */
export function proxyPoint(info: CollapseInfo, nodeId: string, dir: "in" | "out"): { x: number; y: number } | null {
  const gid = info.nodes.get(nodeId);
  const r = gid ? info.rects.get(gid) : undefined;
  return r ? { x: dir === "out" ? r.x + r.w : r.x, y: r.y + r.h / 2 } : null;
}

/** Wires between two members of the same collapsed group are internal: not drawn. */
export const isInternalEdge = (info: CollapseInfo, from: string, to: string): boolean => {
  const a = info.nodes.get(from);
  return a !== undefined && a === info.nodes.get(to);
};

/** Number of wires that cross the border of a collapsed group (shown in the tooltip). */
export const borderWireCount = (info: CollapseInfo, graph: Graph, groupId: string): number =>
  Object.values(graph.edges).filter(
    (e) => (info.nodes.get(e.from.node) === groupId) !== (info.nodes.get(e.to.node) === groupId),
  ).length;
