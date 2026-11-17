export interface AlignRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export type AlignMode = "left" | "right" | "top" | "bottom" | "hcenter" | "vcenter";
export type DistributeAxis = "horizontal" | "vertical";
export type Move = { id: string; position: { x: number; y: number } };

/** Align ≥ 2 rectangles to the extreme edge / centre line of their union. Returns only the nodes that must move. */
export function alignRects(rects: readonly AlignRect[], mode: AlignMode): Move[] {
  if (rects.length < 2) return [];
  const l = Math.min(...rects.map((r) => r.x)),
    r = Math.max(...rects.map((q) => q.x + q.w));
  const t = Math.min(...rects.map((q) => q.y)),
    b = Math.max(...rects.map((q) => q.y + q.h));
  const out: Move[] = [];
  for (const q of rects) {
    let x = q.x,
      y = q.y;
    if (mode === "left") x = l;
    else if (mode === "right") x = r - q.w;
    else if (mode === "hcenter") x = Math.round((l + r) / 2 - q.w / 2);
    else if (mode === "top") y = t;
    else if (mode === "bottom") y = b - q.h;
    else y = Math.round((t + b) / 2 - q.h / 2);
    if (x !== q.x || y !== q.y) out.push({ id: q.id, position: { x, y } });
  }
  return out;
}

/** Equal gaps between ≥ 3 rectangles along an axis (the outermost two stay put; order = current position, ties by id). */
export function distributeRects(rects: readonly AlignRect[], axis: DistributeAxis): Move[] {
  if (rects.length < 3) return [];
  const h = axis === "horizontal";
  const sorted = [...rects].sort((a, b) => (h ? a.x - b.x : a.y - b.y) || (a.id < b.id ? -1 : 1));
  const start = h ? sorted[0]!.x : sorted[0]!.y;
  const last = sorted[sorted.length - 1]!;
  const end = h ? last.x + last.w : last.y + last.h;
  const total = sorted.reduce((s, r) => s + (h ? r.w : r.h), 0);
  const gap = (end - start - total) / (sorted.length - 1);
  const out: Move[] = [];
  let cur = start;
  for (const r of sorted) {
    const p = Math.round(cur);
    if (h ? p !== r.x : p !== r.y) out.push({ id: r.id, position: h ? { x: p, y: r.y } : { x: r.x, y: p } });
    cur += (h ? r.w : r.h) + gap;
  }
  return out;
}
