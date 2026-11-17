import { type AlignMode, type DistributeAxis, alignRects, autoLayout, distributeRects } from "@/core";
import { frameNodes, moveNodes } from "@/ui/graph/actions";
import { getGraph, getScene, getSelection } from "@/ui/graph/graphStore";

const rectsOf = (ids: readonly string[]) => {
  const scene = getScene();
  return ids.flatMap((id) => {
    const r = scene.rect(id);
    return r ? [{ id, x: r.x, y: r.y, w: r.w, h: r.h }] : [];
  });
};

/** Layered auto-layout of the whole graph (or of the selection when ≥ 2 nodes are selected) as ONE undo step. */
export function autoLayoutGraph(): boolean {
  const g = getGraph();
  const sel = getSelection();
  const ids = new Set(sel.length > 1 ? sel : Object.keys(g.nodes));
  const nodes = rectsOf([...ids]).map((r) => ({ id: r.id, w: r.w, h: r.h, x: r.x, y: r.y }));
  if (nodes.length < 2) return false;
  const edges = Object.values(g.edges)
    .filter((e) => ids.has(e.from.node) && ids.has(e.to.node))
    .map((e) => ({ from: e.from.node, to: e.to.node }));
  const pos = autoLayout(nodes, edges);
  const ok = moveNodes([...pos].map(([id, position]) => ({ id, position })));
  if (ok) frameNodes(null);
  return ok;
}

export const alignSelection = (mode: AlignMode): boolean => moveNodes(alignRects(rectsOf(getSelection()), mode));
export const distributeSelection = (axis: DistributeAxis): boolean =>
  moveNodes(distributeRects(rectsOf(getSelection()), axis));
