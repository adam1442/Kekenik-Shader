export interface DiffRow {
  kind: "same" | "change" | "del" | "add";
  left?: string | undefined;
  right?: string | undefined;
}

/** Line diff (LCS) as aligned side-by-side rows: runs of deletions and additions are paired into "change" rows. */
function diffRows(a: readonly string[], b: readonly string[]): DiffRow[] {
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const rows: DiffRow[] = [];
  let dels: string[] = [];
  let adds: string[] = [];
  const flush = (): void => {
    const k = Math.max(dels.length, adds.length);
    for (let x = 0; x < k; x++) {
      const l = dels[x];
      const r = adds[x];
      rows.push({
        kind: l !== undefined && r !== undefined ? "change" : l !== undefined ? "del" : "add",
        left: l,
        right: r,
      });
    }
    dels = [];
    adds = [];
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      rows.push({ kind: "same", left: a[i], right: b[j] });
      i++;
      j++;
    } else if (j >= m || (i < n && lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) dels.push(a[i++]!);
    else adds.push(b[j++]!);
  }
  flush();
  return rows;
}

/** Side-by-side diff of two generated files (e.g. WGSL vs HLSL). */
export function DiffView({
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  left: string;
  right: string;
  leftLabel: string;
  rightLabel: string;
}) {
  const rows = diffRows(left.split("\n"), right.split("\n"));
  const changed = rows.filter((r) => r.kind !== "same").length;
  const cls = (r: DiffRow, side: "l" | "r"): string => {
    const v = side === "l" ? r.left : r.right;
    if (v === undefined) return "kk-diff__line is-gap";
    return `kk-diff__line${r.kind === "same" ? "" : side === "l" ? " is-del" : " is-add"}`;
  };
  return (
    <div
      className="kk-diff"
      data-kk="code-diff"
      aria-label={`Diff ${leftLabel} / ${rightLabel}: ${changed} differing lines`}
    >
      <div className="kk-diff__col" data-side="left" title={leftLabel}>
        {rows.map((r, i) => (
          <div key={i} className={cls(r, "l")}>
            {r.left ?? ""}
          </div>
        ))}
      </div>
      <div className="kk-diff__col" data-side="right" title={rightLabel}>
        {rows.map((r, i) => (
          <div key={i} className={cls(r, "r")}>
            {r.right ?? ""}
          </div>
        ))}
      </div>
    </div>
  );
}
