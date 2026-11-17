import type { Rect } from "../viewport";

export type Direction = "left" | "right" | "up" | "down";

/**
 * Keyboard navigation between nodes: the nearest node in the pressed direction, measured between rectangle centres.
 * Candidates must lie inside a 100° cone around the direction; lateral offset is penalised so ↑/↓ stay in a column.
 */
export function pickNeighbor(rects: ReadonlyMap<string, Rect>, from: string, dir: Direction): string | null {
  const a = rects.get(from);
  if (!a) return null;
  const ax = a.x + a.w / 2,
    ay = a.y + a.h / 2;
  let best: string | null = null;
  let bestCost = Infinity;
  for (const [id, r] of rects) {
    if (id === from) continue;
    const dx = r.x + r.w / 2 - ax,
      dy = r.y + r.h / 2 - ay;
    const along = dir === "right" ? dx : dir === "left" ? -dx : dir === "down" ? dy : -dy;
    const across = dir === "left" || dir === "right" ? dy : dx;
    if (along <= 1 || Math.abs(across) > along * 1.2 + 40) continue;
    const cost = along + Math.abs(across) * 2.2;
    if (cost < bestCost) {
      bestCost = cost;
      best = id;
    }
  }
  return best;
}
