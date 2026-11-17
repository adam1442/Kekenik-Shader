/** Tiny dependency-free fuzzy matcher used by the command palette and menu search. */

export interface FuzzyResult {
  /** Higher is better. */
  score: number;
  /** Indices (into the text) of matched characters. */
  indices: number[];
}

function isBoundary(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  const cur = text[i];
  if (prev === " " || prev === "-" || prev === "_" || prev === "/" || prev === ".") return true;
  // camelCase boundary
  return prev === prev.toLowerCase() && cur !== cur.toLowerCase();
}

/**
 * Subsequence match. Returns null when `query` is not a subsequence of `text`.
 * An empty query matches everything with score 0.
 */
export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (q.length === 0) return { score: 0, indices: [] };
  const t = text.toLowerCase();

  // Fast exact-substring path gives the best scores.
  const sub = t.indexOf(q);
  if (sub >= 0) {
    const indices = Array.from({ length: q.length }, (_, k) => sub + k);
    let score = 100 + q.length * 6 - sub;
    if (isBoundary(text, sub)) score += 25;
    if (t === q) score += 60;
    return { score, indices };
  }

  const indices: number[] = [];
  let ti = 0;
  let score = 0;
  let prevIdx = -2;
  for (let qi = 0; qi < q.length; qi++) {
    let found = -1;
    // Prefer a boundary match within the remaining text, else first occurrence.
    for (let k = ti; k < t.length; k++) {
      if (t[k] !== q[qi]) continue;
      if (found < 0) found = k;
      if (isBoundary(text, k)) {
        found = k;
        break;
      }
    }
    if (found < 0) return null;
    if (found === prevIdx + 1) score += 8;
    else score -= Math.min(6, found - prevIdx - 1);
    if (isBoundary(text, found)) score += 10;
    if (found === 0) score += 6;
    indices.push(found);
    prevIdx = found;
    ti = found + 1;
  }
  return { score, indices };
}

/** Filter and sort items by fuzzy score (stable for equal scores). */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  getText: (item: T) => string,
): Array<{ item: T; result: FuzzyResult }> {
  const out: Array<{ item: T; result: FuzzyResult; i: number }> = [];
  items.forEach((item, i) => {
    const result = fuzzyMatch(query, getText(item));
    if (result) out.push({ item, result, i });
  });
  if (query.trim()) out.sort((a, b) => b.result.score - a.result.score || a.i - b.i);
  return out.map(({ item, result }) => ({ item, result }));
}

/** Split text into highlighted/non-highlighted segments for rendering. */
export function splitHighlight(text: string, indices: number[]): Array<{ text: string; hit: boolean }> {
  if (indices.length === 0) return [{ text, hit: false }];
  const set = new Set(indices);
  const parts: Array<{ text: string; hit: boolean }> = [];
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i);
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += text[i];
    else parts.push({ text: text[i], hit });
  }
  return parts;
}
