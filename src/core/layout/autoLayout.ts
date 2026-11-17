/**
 * Layered (Sugiyama-style) auto-layout, left → right. Custom instead of dagre: no dependency (offline, zero bundle cost), it knows
 * our variable node sizes, and it is fully deterministic (every tie is broken by node id). Guarantees: no two rectangles overlap,
 * wires point right, disconnected components are stacked, the result is anchored at the original top-left corner.
 */
export interface LayoutNode {
  id: string;
  w: number;
  h: number;
  x: number;
  y: number;
}
export interface LayoutEdge {
  from: string;
  to: string;
}
export interface LayoutOptions {
  gapX?: number;
  gapY?: number;
  /** Order-preserving relaxation passes toward neighbour medians. */
  passes?: number;
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function autoLayout(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  opts: LayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const gapX = opts.gapX ?? 90;
  const gapY = opts.gapY ?? 36;
  const passes = opts.passes ?? 4;
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return out;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ids = [...byId.keys()].sort(cmp);
  const succ = new Map<string, string[]>(ids.map((i) => [i, []]));
  const pred = new Map<string, string[]>(ids.map((i) => [i, []]));
  const seen = new Set<string>();
  for (const e of [...edges].sort((a, b) => cmp(a.from + ">" + a.to, b.from + ">" + b.to))) {
    if (e.from === e.to || !byId.has(e.from) || !byId.has(e.to)) continue;
    const k = `${e.from}>${e.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    succ.get(e.from)!.push(e.to);
    pred.get(e.to)!.push(e.from);
  }

  // Drop back edges (DFS) so the layering is well-defined even for cyclic input.
  const back = new Set<string>();
  const state = new Map<string, 1 | 2>();
  const dfs = (u: string): void => {
    state.set(u, 1);
    for (const v of succ.get(u)!) {
      if (state.get(v) === 1) back.add(`${u}>${v}`);
      else if (!state.has(v)) dfs(v);
    }
    state.set(u, 2);
  };
  for (const i of ids) if (!state.has(i)) dfs(i);
  const fwdPred = (v: string): string[] => pred.get(v)!.filter((u) => !back.has(`${u}>${v}`));

  // Longest-path layering (memoised, iterative-safe through DAG recursion depth = graph depth).
  const layerOf = new Map<string, number>();
  const layer = (v: string): number => {
    const hit = layerOf.get(v);
    if (hit !== undefined) return hit;
    const l = fwdPred(v).reduce((m, u) => Math.max(m, layer(u) + 1), 0);
    layerOf.set(v, l);
    return l;
  };
  ids.forEach(layer);

  // Connected components (undirected), each laid out on its own and stacked.
  const comp = new Map<string, number>();
  let nComp = 0;
  for (const i of ids) {
    if (comp.has(i)) continue;
    const stack = [i];
    comp.set(i, nComp);
    while (stack.length) {
      const u = stack.pop()!;
      for (const v of [...succ.get(u)!, ...pred.get(u)!])
        if (!comp.has(v)) {
          comp.set(v, nComp);
          stack.push(v);
        }
    }
    nComp++;
  }

  let top = 0;
  for (let c = 0; c < nComp; c++) {
    const members = ids.filter((i) => comp.get(i) === c);
    const maxLayer = members.reduce((m, i) => Math.max(m, layerOf.get(i)!), 0);
    const cols: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
    for (const i of members) cols[layerOf.get(i)!]!.push(i);
    // Crossing reduction: barycentre sweeps with id tie-breaks.
    const order = new Map<string, number>();
    cols.forEach((col) => col.forEach((i, k) => order.set(i, k)));
    const bary = (i: string, nbrs: string[]): number =>
      nbrs.length ? nbrs.reduce((s, n) => s + order.get(n)!, 0) / nbrs.length : order.get(i)!;
    for (let sweep = 0; sweep < 4; sweep++) {
      const range =
        sweep % 2 === 0
          ? cols.map((_, k) => k).slice(1)
          : cols
              .map((_, k) => k)
              .slice(0, -1)
              .reverse();
      for (const k of range) {
        const nbrs = (i: string): string[] =>
          sweep % 2 === 0 ? fwdPred(i) : succ.get(i)!.filter((v) => !back.has(`${i}>${v}`));
        const keyed = cols[k]!.map((i) => ({ i, b: bary(i, nbrs(i)) }));
        keyed.sort((a, b) => a.b - b.b || cmp(a.i, b.i));
        cols[k] = keyed.map((x) => x.i);
        cols[k]!.forEach((i, r) => order.set(i, r));
      }
    }
    // Coordinates: columns left → right, nodes stacked top → bottom, then order-preserving relaxation toward neighbour medians.
    const colW = cols.map((col) => col.reduce((m, i) => Math.max(m, byId.get(i)!.w), 0));
    const colX: number[] = [];
    colW.reduce((x, w, k) => ((colX[k] = x), x + w + gapX), 0);
    const y = new Map<string, number>();
    for (const col of cols) col.reduce((yy, i) => (y.set(i, yy), yy + byId.get(i)!.h + gapY), 0);
    const centre = (i: string): number => y.get(i)! + byId.get(i)!.h / 2;
    for (let p = 0; p < passes; p++) {
      const seq = p % 2 === 0 ? cols.map((_, k) => k) : cols.map((_, k) => k).reverse();
      for (const k of seq) {
        const col = cols[k]!;
        let floor = -Infinity;
        for (const i of col) {
          const nb = [...fwdPred(i), ...succ.get(i)!.filter((v) => !back.has(`${i}>${v}`))];
          const want = nb.length
            ? nb.map(centre).sort((a, b) => a - b)[Math.floor(nb.length / 2)]! - byId.get(i)!.h / 2
            : y.get(i)!;
          const placed = Math.max(want, floor);
          y.set(i, placed);
          floor = placed + byId.get(i)!.h + gapY;
        }
      }
    }
    const minY = Math.min(...members.map((i) => y.get(i)!));
    const maxY = Math.max(...members.map((i) => y.get(i)! + byId.get(i)!.h));
    for (const i of members) out.set(i, { x: colX[layerOf.get(i)!]!, y: y.get(i)! - minY + top });
    top += maxY - minY + gapY * 2;
  }

  // Anchor at the original top-left corner and round to whole pixels.
  const ox = Math.min(...nodes.map((n) => n.x));
  const oy = Math.min(...nodes.map((n) => n.y));
  for (const [i, p] of out) out.set(i, { x: Math.round(p.x + ox), y: Math.round(p.y + oy) });
  return out;
}

/** True when any two rectangles intersect (tests / diagnostics). */
export function hasOverlap(rects: ReadonlyArray<{ x: number; y: number; w: number; h: number }>): boolean {
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!,
        b = rects[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) return true;
    }
  return false;
}
