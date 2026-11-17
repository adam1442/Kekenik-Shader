import type { Keyword } from "./model";

/**
 * Keyword (static switch) variants. A *variant* is one concrete choice for every keyword of a graph.
 * The IR stays keyword-free: switch nodes pick their branch while the module is built (see `nodes/keyword.ts`),
 * so each variant compiles to ordinary code. Exporters compile every variant they ship.
 */
export type KeywordValues = Readonly<Record<string, number>>;

/** Clamp a raw value to what the keyword can hold (boolean: 0/1, enum: a valid entry index). */
export function clampKeywordValue(k: Keyword, v: number): number {
  const n = Number.isFinite(v) ? Math.round(v) : k.default;
  if (k.kind === "boolean") return n ? 1 : 0;
  const last = Math.max(0, (k.entries?.length ?? 1) - 1);
  return Math.min(last, Math.max(0, n));
}

/** Active value of every keyword: the override when present, else the keyword's default. */
export function resolveKeywordValues(
  keywords: readonly Keyword[],
  overrides: KeywordValues = {},
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keywords) out[k.id] = clampKeywordValue(k, overrides[k.id] ?? k.default);
  return out;
}

/** Stable cache key of a variant (`""` for graphs without keywords). */
export function variantKey(keywords: readonly Keyword[], overrides: KeywordValues = {}): string {
  const r = resolveKeywordValues(keywords, overrides);
  return keywords.map((k) => `${k.id}=${r[k.id]}`).join(",");
}

/** Number of distinct variants (product of every keyword's cardinality). */
export function variantCount(keywords: readonly Keyword[]): number {
  return keywords.reduce((n, k) => n * (k.kind === "boolean" ? 2 : Math.max(1, k.entries?.length ?? 1)), 1);
}

/** IR uniform id of a runtime keyword (`BuildContext.keywordSelector`); backends map it to their keyword macro. */
const KEYWORD_UNIFORM_PREFIX = "kw:";
export const keywordUniformId = (keywordId: string): string => `${KEYWORD_UNIFORM_PREFIX}${keywordId}`;
export const isKeywordUniform = (propId: string): boolean => propId.startsWith(KEYWORD_UNIFORM_PREFIX);
