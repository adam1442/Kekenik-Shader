export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/** Line diff (LCS; both inputs capped at `max` lines, the remainder is reported as a single trailing "…" line). */
export function diffLines(a: string, b: string, max = 1200): DiffLine[] {
  const x = a.split("\n").slice(0, max);
  const y = b.split("\n").slice(0, max);
  const n = x.length,
    m = y.length;
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: DiffLine[] = [];
  let i = 0,
    j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ kind: "same", text: x[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: "del", text: x[i++]! });
    else out.push({ kind: "add", text: y[j++]! });
  }
  while (i < n) out.push({ kind: "del", text: x[i++]! });
  while (j < m) out.push({ kind: "add", text: y[j++]! });
  return out;
}

export const diffStats = (d: readonly DiffLine[]): { added: number; removed: number } => ({
  added: d.filter((l) => l.kind === "add").length,
  removed: d.filter((l) => l.kind === "del").length,
});
