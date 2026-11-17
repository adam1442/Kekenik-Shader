import type { CompileResult } from "@/core";

/** Graph node that produced generated line `line` (1-based) of `file`, or undefined. */
export function nodeAtLine(
  result: CompileResult | null | undefined,
  file: string,
  line: number,
): { nodeId: string; scope?: string } | undefined {
  const e = result?.sourceLines?.[file]?.find((x) => x.line === line);
  return e ? { nodeId: e.nodeId, ...(e.scope ? { scope: e.scope } : {}) } : undefined;
}

/** All generated lines (ascending, unique) that originate from any of `nodeIds`. */
export function linesForNodes(
  result: CompileResult | null | undefined,
  file: string,
  nodeIds: readonly string[],
): number[] {
  if (!nodeIds.length) return [];
  const ids = new Set(nodeIds);
  const out = new Set<number>();
  for (const e of result?.sourceLines?.[file] ?? []) if (ids.has(e.nodeId)) out.add(e.line);
  return [...out].sort((a, b) => a - b);
}
