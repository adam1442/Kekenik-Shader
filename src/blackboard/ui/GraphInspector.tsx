import { EmptyState, Badge, Checkbox, SegmentedControl } from "@/ui";
import { precisionModeOf, type PrecisionMode } from "@/core";
import { renameGraph, setGraphSetting } from "@/ui/graph/actions";
import { getGraph, useGraphs } from "@/ui/graph/graphStore";
import { CommitText, Field, Section } from "./fields";
import { MasterStackSection } from "./MasterStackSection";
import { UnitySettings } from "./UnitySettings";

const setSetting = (key: string, value: Parameters<typeof setGraphSetting>[1], label: string) =>
  void setGraphSetting(key, value, label);

/** Graph tab: name, description, target profile (read-only placeholder until the master stacks), precision. */
export function GraphInspector() {
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  if (!graph) return <EmptyState title="No graph" description="Open or create a graph to edit its settings." />;
  const precision = precisionModeOf(graph.settings);
  return (
    <div className="kk-insp" data-testid="inspector-graph-settings">
      <Section title="Graph">
        <Field label="Name">
          <CommitText aria-label="Graph name" value={graph.name} onCommit={(v) => void renameGraph(v)} />
        </Field>
        <Field label="Description">
          <CommitText
            aria-label="Graph description"
            value={typeof graph.settings.description === "string" ? graph.settings.description : ""}
            placeholder="What does this shader do?"
            onCommit={(v) => setSetting("description", v.trim() ? v : null, "Edit description")}
          />
        </Field>
      </Section>
      <Section title="Precision">
        <Field
          label="Precision"
          hint="Full = every value float (bit-exact). Auto = only values with a proven small range (colour math, masks, unit vectors) become half / mediump / min16float in the FRAGMENT stage. Half = every eligible bounded value. Positions, time, UVs used for sampling, derivative inputs, matrices and unbounded values always stay float. WGSL stays f32 (f16 is Deferred). Preview: use Preview → Performance → fp16 emulation to see the rounding."
        >
          <SegmentedControl<PrecisionMode>
            block
            value={precision}
            options={[
              { value: "full", label: "Full" },
              { value: "auto", label: "Auto" },
              { value: "half", label: "Half" },
            ]}
            onChange={(v) => setSetting("precision", v === "full" ? null : v, "Edit precision")}
            aria-label="Precision"
          />
        </Field>
        {precision !== "full" && (
          <Field
            label="Mobile-aggressive"
            hint="Also demotes UV math that feeds texture samples. Can cause swimming / blocky texture lookups on large textures — check on device."
          >
            <Checkbox
              label=""
              aria-label="Mobile-aggressive precision"
              checked={graph.settings.precisionAggressive === true}
              onChange={(c) => setSetting("precisionAggressive", c ? true : null, "Edit mobile-aggressive precision")}
            />
          </Field>
        )}
      </Section>
      <UnitySettings graph={graph} />
      <MasterStackSection graph={graph} />
      <Section title="Contents">
        <Field label="Nodes">
          <span>{Object.keys(graph.nodes).length}</span>
        </Field>
        <Field label="Wires">
          <span>{Object.keys(getGraph().edges).length}</span>
        </Field>
        <Field label="Properties">
          <span>
            {graph.properties.length} <Badge>{graph.properties.filter((p) => p.exposed).length} exposed</Badge>
          </span>
        </Field>
        <Field label="Keywords">
          <span>{graph.keywords.length}</span>
        </Field>
      </Section>
    </div>
  );
}
