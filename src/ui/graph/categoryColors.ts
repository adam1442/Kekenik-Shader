/** Accent colour of a node category (first path segment of `NodeDef.category`, e.g. "Math/Basic" → "Math"). */
const ACCENTS: Record<string, string> = {
  Input: "#34d399",
  Math: "#60a5fa",
  Channel: "#f59e0b",
  Vector: "#22d3ee",
  Matrix: "#a78bfa",
  Utility: "#94a3b8",
  Master: "#f472b6",
  Subgraph: "#c084fc",
  Procedural: "#fb923c",
  Artistic: "#f87171",
  UV: "#2dd4bf",
};

const topCategory = (category: string): string => category.split("/")[0] ?? category;

export function categoryColor(category: string | undefined): string {
  if (!category) return "#ef4444";
  const top = topCategory(category);
  const known = ACCENTS[top];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < top.length; i++) h = (h * 31 + top.charCodeAt(i)) % 360;
  return `hsl(${h} 60% 62%)`;
}
