import { Plus, X } from "lucide-react";
import {
  type KeywordDefinition,
  REF_TARGETS,
  TARGET_LABEL,
  checkReferenceName,
  keywordTargetName,
  keywordUsage,
  takenReferenceNames,
  variantCount,
} from "@/core";
import { Badge, Button, EmptyState, SegmentedControl, Select, Toggle } from "@/ui";
import { useGraphs } from "@/ui/graph/graphStore";
import { renameKeyword, updateKeyword } from "../actions";
import { CommitText, Field, Section } from "./fields";
import { NameChecks } from "./NameChecks";
import { UsedBySection } from "./UsedBySection";

const DEFINITIONS: Array<{ value: KeywordDefinition; label: string; description: string }> = [
  { value: "shader_feature", label: "Shader Feature", description: "Only variants used by materials are built" },
  { value: "multi_compile", label: "Multi Compile", description: "Every variant is always built" },
  { value: "static", label: "Static (inlined)", description: "Resolved at export time, no variants" },
];

/** Property tab for a Keyword (static switch): exposes the toggle / enum of the material inspector. */
export function KeywordInspector({ id }: { id: string }) {
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  const k = graph?.keywords.find((x) => x.id === id);
  if (!graph || !k)
    return <EmptyState title="No keyword selected" description="Select a keyword in the Blackboard to edit it." />;
  const check = checkReferenceName(k.referenceName, takenReferenceNames(graph.properties, graph.keywords, k.id));
  const uses = keywordUsage(graph, k.id);
  const entries = k.entries ?? [];
  const setEntries = (next: string[]) => void updateKeyword(k.id, { entries: next }, "Edit keyword entries");
  return (
    <div className="kk-insp" data-testid="inspector-keyword" data-keyword={k.id}>
      <div className="kk-insp__head">
        <div>
          <div className="kk-insp__title">{k.displayName}</div>
          <div className="kk-insp__sub">
            Keyword · <Badge tone="cyan">{k.kind === "boolean" ? "Boolean" : "Enum"}</Badge> · {variantCount([k])}{" "}
            variants
          </div>
        </div>
      </div>
      <Section title="Identity">
        <Field label="Display name">
          <CommitText
            aria-label="Keyword display name"
            value={k.displayName}
            onCommit={(v) => void renameKeyword(k.id, v)}
          />
        </Field>
        <Field label="Reference" hint="Keyword spelling is derived per target (Unity: _UPPER_SNAKE)">
          <CommitText
            mono
            aria-label="Keyword reference name"
            value={k.referenceName}
            invalid={check.status === "error"}
            onCommit={(v) => void updateKeyword(k.id, { referenceName: v }, "Edit keyword reference")}
          />
        </Field>
        <NameChecks check={check} />
        <div className="kk-bb-names" data-testid="keyword-exported-names">
          {REF_TARGETS.map((t) => (
            <div key={t} className="kk-bb-names__row">
              <span className="kk-bb-names__t">{TARGET_LABEL[t]}</span>
              <code className="kk-bb-names__n">{keywordTargetName(k.referenceName, t)}</code>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Behaviour">
        <Field label="Definition">
          <Select<KeywordDefinition>
            searchable={false}
            aria-label="Keyword definition"
            value={k.definition}
            options={DEFINITIONS}
            onChange={(v) => void updateKeyword(k.id, { definition: v }, "Edit keyword definition")}
          />
        </Field>
        <Field label="Scope" hint="Local: per shader. Global: shared by all materials / shaders">
          <SegmentedControl<"local" | "global">
            block
            value={k.scope}
            options={[
              { value: "local", label: "Local" },
              { value: "global", label: "Global" },
            ]}
            onChange={(v) => void updateKeyword(k.id, { scope: v }, "Edit keyword scope")}
            aria-label="Keyword scope"
          />
        </Field>
        {k.kind === "enum" && (
          <div className="kk-bb-enum" data-testid="keyword-entries">
            {entries.map((e, i) => (
              <div key={i} className="kk-bb-enum__row kk-bb-enum__row--one">
                <CommitText
                  aria-label={`Entry ${i + 1}`}
                  value={e}
                  onCommit={(v) => setEntries(entries.map((x, j) => (j === i ? v || x : x)))}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Remove entry"
                  disabled={entries.length <= 2}
                  onClick={() => setEntries(entries.filter((_, j) => j !== i))}
                >
                  <X size={12} />
                </Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setEntries([...entries, `Option ${entries.length + 1}`])}>
              <Plus size={12} /> Add entry
            </Button>
          </div>
        )}
        <Field label="Default">
          {k.kind === "boolean" ? (
            <Toggle
              aria-label="Keyword default"
              checked={k.default !== 0}
              onChange={(on) => void updateKeyword(k.id, { default: on ? 1 : 0 }, "Edit keyword default")}
            />
          ) : (
            <Select<string>
              searchable={false}
              aria-label="Keyword default"
              value={String(k.default)}
              options={entries.map((e, i) => ({ value: String(i), label: e }))}
              onChange={(v) => void updateKeyword(k.id, { default: Number(v) }, "Edit keyword default")}
            />
          )}
        </Field>
      </Section>
      <Section title="Inspector">
        <Field label="Header">
          <CommitText
            aria-label="Keyword header"
            value={k.category ?? ""}
            placeholder="(none)"
            onCommit={(v) => void updateKeyword(k.id, { category: v.trim() || undefined }, "Edit keyword header")}
          />
        </Field>
        <Field label="Tooltip">
          <CommitText
            aria-label="Keyword tooltip"
            value={k.tooltip ?? ""}
            placeholder="Shown on hover"
            onCommit={(v) => void updateKeyword(k.id, { tooltip: v.trim() || undefined }, "Edit keyword tooltip")}
          />
        </Field>
      </Section>
      <UsedBySection kind="keyword" id={k.id} uses={uses} />
    </div>
  );
}
