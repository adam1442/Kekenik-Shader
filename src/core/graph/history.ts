import type { Graph } from "./types";
import { applyOperation } from "./ops/apply";
import type { GraphOp } from "./ops/types";

/**
 * Pure undo/redo built on operation inverses. `undo` stack entries are inverses; `redo` entries are the
 * original operations. No timers, no mutation.
 */
interface History {
  graph: Graph;
  undo: GraphOp[];
  redo: GraphOp[];
}

export const createHistory = (graph: Graph): History => ({ graph, undo: [], redo: [] });

export function commit(h: History, op: GraphOp): History {
  const r = applyOperation(h.graph, op);
  return { graph: r.graph, undo: [...h.undo, r.inverse], redo: [] };
}

export function undo(h: History): History {
  const inv = h.undo[h.undo.length - 1];
  if (!inv) return h;
  const r = applyOperation(h.graph, inv);
  return { graph: r.graph, undo: h.undo.slice(0, -1), redo: [...h.redo, r.inverse] };
}

export function redo(h: History): History {
  const op = h.redo[h.redo.length - 1];
  if (!op) return h;
  const r = applyOperation(h.graph, op);
  return { graph: r.graph, undo: [...h.undo, r.inverse], redo: h.redo.slice(0, -1) };
}
