import { create } from "zustand";
import { type Group, type Comment, type Rect4, type Vec2, ops } from "@/core";
import { commit, getGraph, getScene, getSelection, newNodeId } from "./graphStore";
import { COMMENT_MIN, DEFAULT_COMMENT, GROUP_MIN, fitRect, groupContents, groupRect, type RectOf } from "./frames";

/** Selected group / comment (frames are not nodes, so they have their own selection). */
export type FrameRef = { kind: "group" | "comment"; id: string };
export const useFrameSel = create<{ sel: FrameRef | null; set: (s: FrameRef | null) => void }>((set) => ({
  sel: null,
  set: (sel) => set({ sel }),
}));

/** Node rectangles of the active canvas (for geometry rules). */
export const nodeRectOf = (): RectOf => {
  const scene = getScene();
  return (id) => scene.rect(id);
};

const round = (n: number) => Math.round(n);

/** Group the selected nodes (Ctrl+G): a frame around them with the selected nodes adopted. Returns the new group id. */
export function groupSelection(title = "Group"): string | null {
  const ids = getSelection();
  const rectOf = nodeRectOf();
  const rects = ids.map(rectOf).filter((r): r is Rect4 => !!r);
  const frame = fitRect(rects);
  if (!frame) return null;
  const g = getGraph();
  const id = newNodeId("grp");
  const group: Group = { id, title, nodeIds: ids.filter((i) => rectOf(i)), rect: frame };
  const list = [ops.addGroup(group)];
  // the nodes leave any other group (the new, tighter frame is now their innermost one)
  for (const o of g.groups)
    if (o.nodeIds.some((n) => group.nodeIds.includes(n)))
      list.push(ops.updateGroup(o.id, { nodeIds: o.nodeIds.filter((n) => !group.nodeIds.includes(n)) }));
  if (!commit("Group nodes", list)) return null;
  useFrameSel.getState().set({ kind: "group", id });
  return id;
}

export function addGroupAt(world: Vec2, title = "Group"): string | null {
  const id = newNodeId("grp");
  const rect = { x: round(world.x), y: round(world.y), w: 360, h: 220 };
  const g: Group = { id, title, nodeIds: [], rect };
  if (!commit("Add group", ops.addGroup(g))) return null;
  useFrameSel.getState().set({ kind: "group", id });
  return id;
}

export function addCommentAt(world: Vec2, text = "Note"): string | null {
  const id = newNodeId("cmt");
  const c: Comment = { id, text, position: { x: round(world.x), y: round(world.y) }, size: { ...DEFAULT_COMMENT } };
  if (!commit("Add comment", ops.addComment(c))) return null;
  useFrameSel.getState().set({ kind: "comment", id });
  return id;
}

export const setGroupTitle = (id: string, title: string): boolean =>
  commit("Rename group", ops.updateGroup(id, { title }));
/** U11: fold / unfold a group (one undo step; the flag is persisted only while collapsed). */
export function toggleGroupCollapse(id: string): boolean {
  const g = getGraph().groups.find((x) => x.id === id);
  if (!g) return false;
  return commit(
    g.collapsed ? "Expand group" : "Collapse group",
    ops.updateGroup(id, { collapsed: g.collapsed ? undefined : true }),
  );
}
export const setGroupColor = (id: string, color: string | null): boolean =>
  commit("Group color", ops.updateGroup(id, color === null ? { color: undefined } : { color }));
export const setCommentText = (id: string, text: string): boolean =>
  commit("Edit comment", ops.updateComment(id, { text }));
export const setCommentColor = (id: string, color: string | null): boolean =>
  commit("Comment color", ops.updateComment(id, color === null ? { color: undefined } : { color }));

/** Resize a group so it exactly fits its (adopted + nested) contents plus padding. */
export function fitGroupToContents(id: string): boolean {
  const g = getGraph();
  const rectOf = nodeRectOf();
  const grp = g.groups.find((x) => x.id === id);
  if (!grp) return false;
  const c = groupContents(g, id, rectOf);
  const rects = [
    ...c.nodeIds.map(rectOf),
    ...c.groupIds.map((i) =>
      groupRect(
        g.groups.find((x) => x.id === i)!,
        rectOf,
      ),
    ),
  ].filter((r): r is Rect4 => !!r);
  const frame = fitRect(rects);
  return !!frame && commit("Fit group", ops.updateGroup(id, { rect: frame }));
}

/** Delete the frame only (nodes stay). */
export function removeFrame(ref: FrameRef): boolean {
  const ok = commit(
    ref.kind === "group" ? "Remove group" : "Remove comment",
    ref.kind === "group" ? ops.removeGroup(ref.id) : ops.removeComment(ref.id),
  );
  if (ok) useFrameSel.getState().set(null);
  return ok;
}

export const resizeMin = (kind: FrameRef["kind"]) => (kind === "group" ? GROUP_MIN : COMMENT_MIN);
