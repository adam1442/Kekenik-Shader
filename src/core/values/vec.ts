/** Vector / matrix value helpers: paste parsing, formatting, linked editing, mixed state (no DOM). */
import { normalizeDigits, parseExpression } from "./expr";
import { formatFixed } from "./numeric";

export const AXES = ["x", "y", "z", "w"] as const;

/** Parse "1, 2, 3" / "(1 2 3)" / "[1;2;3]" / JSON array / JSON object {x,y,z,w} / "vec3(1,2,3)". A single value splats. */
export function parseVecText(text: string, n: number, keys: readonly string[] = AXES): number[] | null {
  const src = normalizeDigits(text, false).trim();
  if (!src) return null;
  let parts: unknown[] | null = null;
  if (src.startsWith("{") || src.startsWith("[")) {
    try {
      const j: unknown = JSON.parse(src);
      if (Array.isArray(j)) parts = j;
      else if (j && typeof j === "object") {
        const o = j as Record<string, unknown>;
        const alt = ["r", "g", "b", "a"];
        parts = keys.slice(0, n).map((k, i) => o[k] ?? o[alt[i]!] ?? o[String(i)]);
      }
    } catch {
      /* fall through to loose parsing */
    }
  }
  if (!parts) {
    const inner = src.replace(/^[a-z]*[0-9]*\s*[([{]/i, "").replace(/[)\]}]\s*$/, "");
    parts = inner.split(/[\s,;]+/).filter((s) => s.length > 0);
  }
  const nums: number[] = [];
  for (const p of parts) {
    if (typeof p === "number" && Number.isFinite(p)) nums.push(p);
    else if (typeof p === "string") {
      const r = parseExpression(p);
      if (!r.ok) return null;
      nums.push(r.value);
    } else return null;
  }
  if (nums.length === n) return nums;
  if (nums.length === 1) return Array.from({ length: n }, () => nums[0]!);
  return null;
}

export function formatVecText(v: readonly number[], precision = 4): string {
  return v.map((x) => formatFixed(x, precision)).join(", ");
}

export type LinkMode = "off" | "uniform" | "proportional";

/**
 * Apply a change of component `index` to `value`, honouring the link mode.
 * uniform: every component becomes the new value. proportional: others scale by new/old (falls back to uniform when old is 0).
 */
export function applyLinked(prev: readonly number[], index: number, next: number, mode: LinkMode): number[] {
  const out = prev.slice();
  if (mode === "off") {
    out[index] = next;
    return out;
  }
  if (mode === "uniform") return out.map(() => next);
  const old = prev[index]!;
  if (old === 0) return out.map(() => next);
  const k = next / old;
  return out.map((x, i) => (i === index ? next : x * k));
}

/** Per-component mixed state for multi-selection editing: component is `null` where selected values differ. */
export function mergeMixed(values: ReadonlyArray<readonly number[]>): Array<number | null> {
  if (values.length === 0) return [];
  const n = values[0]!.length;
  return Array.from({ length: n }, (_, i) => {
    const first = values[0]![i]!;
    return values.every((v) => v[i] === first) ? first : null;
  });
}

/* ── matrices (column-major flat arrays, like the IR) ─────────────────── */

export function identityMatrix(n: number): number[] {
  return Array.from({ length: n * n }, (_, i) => (i % (n + 1) === 0 ? 1 : 0));
}

export function isIdentityMatrix(m: readonly number[], n: number): boolean {
  const id = identityMatrix(n);
  return m.length === id.length && m.every((x, i) => x === id[i]);
}

export function transposeMatrix(m: readonly number[], n: number): number[] {
  const out = new Array<number>(n * n);
  for (let c = 0; c < n; c++) for (let r = 0; r < n; r++) out[r * n + c] = m[c * n + r]!;
  return out;
}

export function parseMatrixText(text: string, n: number): number[] | null {
  const flat = text.replace(/[[\]()]/g, " ");
  const v = parseVecText(flat, n * n);
  return v && v.length === n * n ? v : null;
}
