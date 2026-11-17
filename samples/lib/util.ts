import type { PortValue, ShaderType, SubgraphDef } from "@/core";
import { type Block, type Canvas, COLORS } from "../build/canvas";
import { defineSubgraph } from "../build/dsl";

/** Subgraph port declaration helper (every library port has a tooltip — see docs/SAMPLES.md). */
export const port = (id: string, name: string, type: ShaderType, tooltip: string, def?: PortValue) => ({ id, name, type, tooltip, ...(def !== undefined ? { default: def } : {}) });

const memo = new Map<string, SubgraphDef>();

/**
 * One-block subgraph: `body(b, c)` fills a single titled group (with the explanatory note). The result is memoised per id, so
 * every sample that `use()`s a kit shares one identical definition.
 */
export function kit(
  spec: { id: string; name: string; inputs: ReturnType<typeof port>[]; outputs: ReturnType<typeof port>[]; note: string; color?: string },
  body: (b: Block, c: Canvas) => void,
  deps: SubgraphDef[] = [],
): SubgraphDef {
  const hit = memo.get(spec.id);
  if (hit) return hit;
  const def = defineSubgraph({ id: spec.id, name: spec.name, inputs: spec.inputs, outputs: spec.outputs }, (c) => {
    body(c.block("body", spec.name, spec.note, { col: 0, color: spec.color ?? COLORS.blue }), c);
  }, deps);
  memo.set(spec.id, def);
  return def;
}
