import { type Diagnostic, makeDiagnostic } from "../diagnostics";
import { ops } from "../graph/ops/make";
import type { Graph } from "../graph/types";
import { REF_TARGETS, type RefTarget, targetReferenceName, uniquifyName } from "../properties/names";
import { recursionDiagnostics } from "../graph/subgraph";

/**
 * Graph-wide checks that do not depend on node types:
 *  - duplicate property display names / keyword names
 *  - reference-name collisions (checked AFTER per-target sanitisation, because `My Tex` and `My_Tex` may collide in Godot only)
 *  - subgraph recursion
 */
export function globalChecks(graph: Graph): Diagnostic[] {
  const out: Diagnostic[] = [];

  const seenDisplay = new Map<string, string>();
  const takenRefs = new Set(graph.properties.map((p) => p.referenceName));
  for (const p of graph.properties) {
    const first = seenDisplay.get(p.displayName);
    if (first !== undefined) {
      out.push(
        makeDiagnostic("E_DUPLICATE_NAME", `Property display name "${p.displayName}" is used more than once`, {
          quickFix: { label: "Rename", operation: ops.updateProperty(p.id, { displayName: `${p.displayName} 2` }) },
        }),
      );
    } else seenDisplay.set(p.displayName, p.id);
  }

  const claimed = new Map<RefTarget, Map<string, string>>(REF_TARGETS.map((t) => [t, new Map()]));
  const reported = new Set<string>();
  const items = [
    ...graph.properties.map((p) => ({ id: p.id, ref: p.referenceName, kind: "property" as const })),
    ...graph.keywords.map((k) => ({ id: k.id, ref: k.referenceName, kind: "keyword" as const })),
  ];
  for (const it of items) {
    for (const t of REF_TARGETS) {
      const name = targetReferenceName(it.ref, t);
      const m = claimed.get(t)!;
      if (m.has(name) && !reported.has(it.id)) {
        reported.add(it.id);
        const fixed = uniquifyName(it.ref, takenRefs);
        out.push(
          makeDiagnostic(
            "E_DUPLICATE_NAME",
            `Reference name "${it.ref}" collides with another ${it.kind}/property in ${t} ("${name}")`,
            {
              ...(it.kind === "property"
                ? {
                    quickFix: {
                      label: `Rename to ${fixed}`,
                      operation: ops.updateProperty(it.id, { referenceName: fixed }),
                    },
                  }
                : {}),
            },
          ),
        );
      } else if (!m.has(name)) m.set(name, it.id);
    }
  }

  out.push(...recursionDiagnostics(graph));
  return out;
}
