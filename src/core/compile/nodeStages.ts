import { type Diagnostic, makeDiagnostic } from "../diagnostics";
import type { ProfileDef } from "../registry/profile";
import type { BodyAnalysis } from "./infer";

/**
 * Node-level stage rules . The IR already rejects ops that cannot exist in a stage (implicit-LOD sampling, derivatives,
 * fragment-only inputs). Some nodes are stage-bound for reasons the IR cannot see (a vertex deformation, a pipeline texture read):
 * they declare `NodeDef.stage`, and this pass reports every such node that feeds a master block of the OTHER stage.
 * Scope: the main graph (subgraph bodies are checked through the IR rules only — documented limit).
 */
export function checkNodeStages(main: BodyAnalysis, profile: ProfileDef): Diagnostic[] {
  const out: Diagnostic[] = [];
  const rootId = main.rootId;
  if (!rootId) return out;
  const into = new Map<string, Array<{ node: string; port: string }>>();
  for (const e of main.flat.edges)
    (into.get(e.to.node) ?? into.set(e.to.node, []).get(e.to.node)!).push({ node: e.from.node, port: e.to.port });
  const seen = new Set<string>();
  for (const block of profile.masterBlocks) {
    const visited = new Set<string>();
    const stack = (into.get(rootId) ?? []).filter((e) => e.port === block.id).map((e) => e.node);
    while (stack.length) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const def = main.info.get(id)?.def;
      if (def?.stage && def.stage !== block.stage && !seen.has(`${id}:${block.id}`)) {
        seen.add(`${id}:${block.id}`);
        const fix =
          def.stage === "light"
            ? `Connect it to a Light-stage slot (Diffuse Light / Specular Light — Godot spatial, Surface Options ▸ Custom light())`
            : def.stage === "vertex"
              ? `Connect it to a vertex slot (e.g. Vertex Offset) instead of "${block.label}"`
              : `Connect it to a fragment slot instead of "${block.label}"`;
        out.push(
          makeDiagnostic(
            "E_STAGE_VIOLATION",
            `Node "${def.name}" is ${def.stage}-only and cannot feed the ${block.stage}-stage slot "${block.label}". ${fix}.`,
            { nodeId: id },
          ),
        );
      }
      for (const e of into.get(id) ?? []) stack.push(e.node);
    }
  }
  return out;
}
