import { Select, type SelectOption } from "@/ui";
import { setSubgraphOutput, useGraphs } from "./graphStore";

/**
 * U13: output selector of a subgraph tab (Preview header + Code panel). Renders nothing outside subgraph tabs or when the subgraph has a
 * single output. The choice is per tab (`GraphDoc.outputId`); unknown / removed outputs fall back to the first one.
 */
export function SubgraphOutputSelect({ className }: { className?: string }) {
  const doc = useGraphs((s) => s.docs.find((d) => d.id === s.activeId));
  const def = doc?.scope ? doc.graph.subgraphDefs[doc.scope] : undefined;
  if (!doc || !def || def.outputs.length < 2) return null;
  const options: SelectOption<string>[] = def.outputs.map((o) => ({ value: o.id, label: o.name, description: o.type }));
  const value = def.outputs.some((o) => o.id === doc.outputId) ? doc.outputId! : def.outputs[0]!.id;
  return (
    <span data-testid="subgraph-output-select" className={className}>
      <Select<string>
        density="compact"
        value={value}
        options={options}
        onChange={setSubgraphOutput}
        searchable={false}
        tooltip="Subgraph output shown in Preview / Code"
        aria-label="Subgraph output"
      />
    </span>
  );
}
