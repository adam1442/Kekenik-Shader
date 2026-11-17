import type { BudgetClass, SampleCategory, SampleDifficulty, SampleIndexEntry, SampleTarget } from "./meta";

/** Sample Browser filter state (pure; the UI store and the tests share this). `"all"` = no restriction. */
export interface SampleFilter {
  query: string;
  category: SampleCategory | "all";
  target: SampleTarget | "all";
  difficulty: SampleDifficulty | "all";
  budget: BudgetClass | "all";
  tag: string | null;
}
export const EMPTY_SAMPLE_FILTER: SampleFilter = { query: "", category: "all", target: "all", difficulty: "all", budget: "all", tag: null };

const haystack = (s: SampleIndexEntry): string => [s.title, s.description, s.category, s.difficulty, s.budgetClass, ...s.tags, ...s.parameters.map((p) => p.name)].join(" ").toLowerCase();

/** AND-filter + every whitespace-separated query token must occur in title / description / tags / parameter names. Order is preserved. */
export function filterSamples(entries: readonly SampleIndexEntry[], f: SampleFilter): SampleIndexEntry[] {
  const tokens = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((s) =>
    (f.category === "all" || s.category === f.category) && (f.target === "all" || s.targets.includes(f.target)) &&
    (f.difficulty === "all" || s.difficulty === f.difficulty) && (f.budget === "all" || s.budgetClass === f.budget) &&
    (f.tag === null || s.tags.includes(f.tag)) && tokens.every((t) => haystack(s).includes(t)));
}

/** Tags of `entries` ordered by frequency (then alphabetically). */
export function sampleTags(entries: readonly SampleIndexEntry[], limit = 14): string[] {
  const n = new Map<string, number>();
  for (const s of entries) for (const t of s.tags) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([t]) => t);
}
