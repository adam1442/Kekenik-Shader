/**
 * Deterministic JSON: object keys sorted (code-point order), arrays keep their order, `-0` → `0`,
 * `undefined`-valued keys omitted, NaN/Infinity rejected (JSON cannot represent them).
 */
function normalise(v: unknown, path: string): unknown {
  if (v === null || typeof v === "string" || typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`Cannot serialise non-finite number at ${path}`);
    return Object.is(v, -0) ? 0 : v;
  }
  if (Array.isArray(v)) return v.map((x, i) => (x === undefined ? null : normalise(x, `${path}[${i}]`)));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = normalise(x, `${path}.${k}`);
    }
    return out;
  }
  throw new Error(`Cannot serialise value of type ${typeof v} at ${path}`);
}

export function stableStringify(value: unknown, indent = 2): string {
  return JSON.stringify(normalise(value, "$"), null, indent);
}
