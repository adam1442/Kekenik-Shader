import { type Graph, type GraphOp, type Group, type Rect4, ops } from "@/core";

/** Pure geometry + membership rules of groups (frames) and comments (sticky notes). */
const GROUP_PAD = 32;
export const GROUP_HEAD = 30;
export const GROUP_MIN = { w: 160, h: 80 };
export const COMMENT_MIN = { w: 120, h: 60 };
export const DEFAULT_COMMENT = { w: 240, h: 140 };

export interface Pt2 {
  x: number;
  y: number;
}

const rectContains = (r: Rect4, p: Pt2): boolean => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
const rectInside = (inner: Rect4, outer: Rect4): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;
const area = (r: Rect4): number => r.w * r.h;

/** Bounding box of rectangles grown by `pad` (room for the title bar on top). null for no rectangles. */
export function fitRect(rects: readonly Rect4[], pad = GROUP_PAD): Rect4 | null {
  if (rects.length === 0) return null;
  const x0 = Math.min(...rects.map((r) => r.x)),
    y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w)),
    y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0 - pad, y: y0 - pad - GROUP_HEAD, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 + GROUP_HEAD };
}

export type RectOf = (nodeId: string) => Rect4 | null;

/** The frame of a group: its stored rect, or (legacy / rect-less groups) the fit of its members. */
export function groupRect(g: Group, rectOf: RectOf): Rect4 {
  if (g.rect) return g.rect;
  return fitRect(g.nodeIds.map(rectOf).filter((r): r is Rect4 => !!r)) ?? { x: 0, y: 0, ...GROUP_MIN };
}

/** Groups nested in `outer` = groups whose frame lies completely inside it. */
function nestedGroups(groups: readonly Group[], outer: Group, rectOf: RectOf): Group[] {
  const o = groupRect(outer, rectOf);
  return groups.filter(
    (g) => g.id !== outer.id && rectInside(groupRect(g, rectOf), o) && area(groupRect(g, rectOf)) < area(o),
  );
}

export interface FrameContents {
  nodeIds: string[];
  groupIds: string[];
  commentIds: string[];
}

/** Everything that moves with a group: adopted nodes, nested groups (and THEIR nodes), comments whose centre lies inside. */
export function groupContents(graph: Graph, groupId: string, rectOf: RectOf): FrameContents {
  const root = graph.groups.find((g) => g.id === groupId);
  if (!root) return { nodeIds: [], groupIds: [], commentIds: [] };
  const inner = nestedGroups(graph.groups, root, rectOf);
  const frame = groupRect(root, rectOf);
  return {
    nodeIds: [...new Set([root, ...inner].flatMap((g) => g.nodeIds))].filter((id) => !!rectOf(id)),
    groupIds: inner.map((g) => g.id),
    commentIds: graph.comments
      .filter((c) => rectContains(frame, { x: c.position.x + c.size.w / 2, y: c.position.y + c.size.h / 2 }))
      .map((c) => c.id),
  };
}

/** Operations that move a group, its nested groups, adopted nodes and enclosed comments by (dx, dy). */
export function moveGroupOps(
  graph: Graph,
  groupId: string,
  dx: number,
  dy: number,
  rectOf: RectOf,
  positionOf: (id: string) => Pt2 | null,
): GraphOp[] {
  const c = groupContents(graph, groupId, rectOf);
  const list: GraphOp[] = [];
  const moves = c.nodeIds
    .map((id) => ({ id, position: positionOf(id)! }))
    .filter((m) => m.position)
    .map((m) => ({ id: m.id, position: { x: m.position.x + dx, y: m.position.y + dy } }));
  if (moves.length) list.push(ops.moveNodes(moves));
  for (const id of [groupId, ...c.groupIds]) {
    const g = graph.groups.find((x) => x.id === id)!;
    const r = groupRect(g, rectOf);
    list.push(ops.updateGroup(id, { rect: { ...r, x: r.x + dx, y: r.y + dy } }));
  }
  for (const id of c.commentIds) {
    const cm = graph.comments.find((x) => x.id === id)!;
    list.push(ops.updateComment(id, { position: { x: cm.position.x + dx, y: cm.position.y + dy } }));
  }
  return list;
}

/**
 * Membership rule: a node belongs to the INNERMOST group whose frame contains its centre. Returns the operations that
 * make `nodeIds` consistent with that rule (adopt when dropped inside, release when dragged out).
 */
export function adoptionOps(
  graph: Graph,
  nodeIds: readonly string[],
  centerOf: (id: string) => Pt2 | null,
  rectOf: RectOf,
): GraphOp[] {
  if (graph.groups.length === 0) return [];
  const frames = graph.groups.map((g) => ({ g, r: groupRect(g, rectOf) })).sort((a, b) => area(a.r) - area(b.r));
  const next = new Map(graph.groups.map((g) => [g.id, new Set(g.nodeIds)]));
  for (const id of nodeIds) {
    const c = centerOf(id);
    if (!c) continue;
    const target = frames.find((f) => rectContains(f.r, c))?.g.id;
    for (const g of graph.groups) {
      const set = next.get(g.id)!;
      if (g.id === target) set.add(id);
      else set.delete(id);
    }
  }
  const list: GraphOp[] = [];
  for (const g of graph.groups) {
    const set = next.get(g.id)!;
    if (set.size !== g.nodeIds.length || g.nodeIds.some((n) => !set.has(n)))
      list.push(ops.updateGroup(g.id, { nodeIds: [...set] }));
  }
  return list;
}

/** Palette used by groups and comments. */
export const FRAME_COLORS: Array<{ name: string; value: string | null }> = [
  { name: "Default", value: null },
  { name: "Yellow", value: "#fbbf24" },
  { name: "Orange", value: "#fb923c" },
  { name: "Red", value: "#f87171" },
  { name: "Pink", value: "#f472b6" },
  { name: "Violet", value: "#a78bfa" },
  { name: "Blue", value: "#60a5fa" },
  { name: "Cyan", value: "#22d3ee" },
  { name: "Green", value: "#4ade80" },
];
