import { Plus, X } from "lucide-react";
import {
  type EnumEntry,
  type Property,
  type TextureDefault,
  checkReferenceName,
  propertyUsage,
  takenReferenceNames,
} from "@/core";
import { Badge, Button, EmptyState, Select, SegmentedControl, Toggle } from "@/ui";
import { useGraphs } from "@/ui/graph/graphStore";
import { propertyLock, renameProperty, updateProperty } from "../actions";
import { TYPE_LABEL } from "../typeInfo";
import { CommitNumber, CommitText, Field, Section } from "./fields";
import { NameChecks } from "./NameChecks";
import { UsedBySection } from "./UsedBySection";
import { ValueEditor } from "./ValueEditor";
import { defaultOf } from "./valueUtil";
import { useDraft } from "./useDraft";

const TEXTURE_DEFAULTS: Array<{ value: TextureDefault; label: string }> = [
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
  { value: "grey", label: "Gray" },
  { value: "bump", label: "Bump (flat normal)" },
  { value: "red", label: "Red" },
  { value: "none", label: "None" },
];

function DefaultEditor({ p }: { p: Property }) {
  const d = useDraft(defaultOf(p), (v) => void updateProperty(p.id, { default: v }, "Edit default"));
  return (
    <ValueEditor
      p={p}
      value={d.value}
      onChange={d.onChange}
      onCommit={d.onCommit}
      {...(d.onCancel ? { onCancel: d.onCancel } : {})}
    />
  );
}

function EnumEditor({ p }: { p: Property }) {
  const list = p.enumValues ?? [];
  const set = (next: EnumEntry[]) => void updateProperty(p.id, { enumValues: next }, "Edit dropdown entries");
  return (
    <div className="kk-bb-enum" data-testid="enum-entries">
      {list.map((e, i) => (
        <div key={i} className="kk-bb-enum__row">
          <CommitText
            aria-label={`Entry ${i + 1} name`}
            value={e.name}
            onCommit={(v) => set(list.map((x, j) => (j === i ? { ...x, name: v || x.name } : x)))}
          />
          <CommitNumber
            aria-label={`Entry ${i + 1} value`}
            value={e.value}
            integer={p.type === "int"}
            step={1}
            onCommit={(v) => set(list.map((x, j) => (j === i ? { ...x, value: v } : x)))}
          />
          <Button
            size="sm"
            variant="ghost"
            aria-label="Remove entry"
            onClick={() => set(list.filter((_, j) => j !== i))}
          >
            <X size={12} />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => set([...list, { name: `Option ${list.length + 1}`, value: list.length }])}
      >
        <Plus size={12} /> Add entry
      </Button>
    </div>
  );
}

function RangeSection({ p }: { p: Property }) {
  const ranged = p.min !== undefined || p.max !== undefined;
  const slider = !!p.slider && p.min !== undefined && p.max !== undefined;
  const enumOn = !!p.enumValues?.length;
  return (
    <Section title={p.type === "int" ? "Integer" : "Float"}>
      <Field label="Dropdown" hint="Show a dropdown of named values instead of a number field">
        <Toggle
          aria-label="Enum dropdown"
          checked={enumOn}
          onChange={(on) =>
            void updateProperty(
              p.id,
              on
                ? {
                    enumValues: [
                      { name: "Off", value: 0 },
                      { name: "On", value: 1 },
                    ],
                    slider: false,
                  }
                : { enumValues: undefined },
              "Toggle dropdown",
            )
          }
        />
      </Field>
      {enumOn ? (
        <EnumEditor p={p} />
      ) : (
        <>
          <Field label="Limit range">
            <Toggle
              aria-label="Limit range"
              checked={ranged}
              onChange={(on) =>
                void updateProperty(
                  p.id,
                  on ? { min: 0, max: 1 } : { min: undefined, max: undefined, slider: false },
                  "Toggle range",
                )
              }
            />
          </Field>
          {ranged && (
            <>
              <Field label="Min">
                <CommitNumber
                  aria-label="Minimum"
                  value={p.min ?? 0}
                  integer={p.type === "int"}
                  onCommit={(v) =>
                    void updateProperty(
                      p.id,
                      { min: v, ...(p.max !== undefined && v > p.max ? { max: v } : {}) },
                      "Edit range",
                    )
                  }
                />
              </Field>
              <Field label="Max">
                <CommitNumber
                  aria-label="Maximum"
                  value={p.max ?? 1}
                  integer={p.type === "int"}
                  onCommit={(v) =>
                    void updateProperty(
                      p.id,
                      { max: v, ...(p.min !== undefined && v < p.min ? { min: v } : {}) },
                      "Edit range",
                    )
                  }
                />
              </Field>
              <Field label="Control">
                <SegmentedControl<"field" | "slider">
                  block
                  value={slider ? "slider" : "field"}
                  options={[
                    { value: "field", label: "Field" },
                    { value: "slider", label: "Slider" },
                  ]}
                  onChange={(v) => void updateProperty(p.id, { slider: v === "slider" }, "Edit control")}
                  aria-label="Slider or field"
                />
              </Field>
            </>
          )}
          <Field label="Step" hint="Drag / arrow-key increment">
            <CommitNumber
              aria-label="Step"
              value={p.step ?? (p.type === "int" ? 1 : 0.01)}
              min={0.000001}
              onCommit={(v) => void updateProperty(p.id, { step: v }, "Edit step")}
            />
          </Field>
        </>
      )}
    </Section>
  );
}

/** Property tab: every piece of metadata the exported material inspector needs. */
export function PropertyInspector({ id }: { id: string }) {
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  const p = graph?.properties.find((x) => x.id === id);
  if (!graph || !p)
    return (
      <EmptyState
        title="No property selected"
        description="Select a property in the Blackboard to edit its metadata."
      />
    );
  const check = checkReferenceName(p.referenceName, takenReferenceNames(graph.properties, graph.keywords, p.id));
  const uses = propertyUsage(graph, p.id);
  const lock = propertyLock(p.id);
  const color = p.type === "color" || p.type === "color4";
  return (
    <div className="kk-insp" data-testid="inspector-property" data-prop={p.id}>
      <div className="kk-insp__head">
        <div>
          <div className="kk-insp__title">{p.displayName}</div>
          <div className="kk-insp__sub">
            Property · <Badge tone="cyan">{TYPE_LABEL[p.type]}</Badge> · {p.exposed ? "exposed" : "internal"}
            {lock && (
              <>
                {" "}
                ·{" "}
                <span title={lock}>
                  <Badge>locked</Badge>
                </span>
              </>
            )}
          </div>
        </div>
      </div>
      <Section title="Identity">
        <Field label="Display name">
          <CommitText
            aria-label="Property display name"
            value={p.displayName}
            onCommit={(v) => void renameProperty(p.id, v)}
          />
        </Field>
        <Field
          label="Reference"
          hint={lock ?? "Name used inside shaders and by the engine's material API (Unity: _PascalCase)"}
        >
          <CommitText
            mono
            disabled={!!lock}
            aria-label="Property reference name"
            value={p.referenceName}
            invalid={check.status === "error"}
            onCommit={(v) => void updateProperty(p.id, { referenceName: v }, "Edit reference name")}
          />
        </Field>
        <NameChecks check={check} />
      </Section>
      <Section title="Default">
        {p.type === "texture2D" ? (
          <Field label="Texture">
            <Select<TextureDefault>
              searchable={false}
              aria-label="Default texture"
              value={p.textureDefault ?? "white"}
              options={TEXTURE_DEFAULTS}
              onChange={(v) => void updateProperty(p.id, { textureDefault: v }, "Edit default texture")}
            />
          </Field>
        ) : (
          <Field label="Value">
            <DefaultEditor p={p} />
          </Field>
        )}
      </Section>
      {(p.type === "float" || p.type === "int") && <RangeSection p={p} />}
      {color && (
        <Section title="Color">
          <Field label="HDR" hint="Allow intensities above 1 (emission, bloom)">
            <Toggle
              aria-label="HDR color"
              checked={!!p.hdr}
              onChange={(on) => void updateProperty(p.id, { hdr: on }, "Toggle HDR")}
            />
          </Field>
          <Field
            label="Color space"
            hint="Linear: the shader receives the value as is (Unity default). sRGB: the shader receives the picker's sRGB numbers (Unity [Gamma])"
          >
            <SegmentedControl<"linear" | "srgb">
              block
              value={p.colorSpace ?? "linear"}
              options={[
                { value: "linear", label: "Linear" },
                { value: "srgb", label: "sRGB" },
              ]}
              onChange={(v) => void updateProperty(p.id, { colorSpace: v }, "Edit color space")}
              aria-label="Color space"
            />
          </Field>
        </Section>
      )}
      {p.type === "texture2D" && (
        <Section title="Texture">
          <Field
            label="Tiling / offset"
            hint="Expose Tiling and Offset in the material inspector. Exported in the manifest; the Preview and every exporter apply it as uv · tiling + offset."
          >
            <Toggle
              aria-label="Expose tiling and offset"
              checked={!!p.tilingOffset}
              onChange={(on) => void updateProperty(p.id, { tilingOffset: on }, "Toggle tiling/offset")}
            />
          </Field>
        </Section>
      )}
      <Section title="Inspector">
        <Field label="Exposed" hint="Off = internal constant, hidden from the material inspector">
          <Toggle
            aria-label="Exposed"
            checked={p.exposed}
            onChange={(on) => void updateProperty(p.id, { exposed: on }, "Toggle exposed")}
          />
        </Field>
        <Field
          label="Per-instance"
          hint="Set from code per renderer (Unity [PerRendererData]); not stored in the material"
        >
          <Toggle
            aria-label="Per-instance"
            checked={p.perInstance}
            onChange={(on) => void updateProperty(p.id, { perInstance: on }, "Toggle per-instance")}
          />
        </Field>
        {p.type !== "texture2D" && (
          <Field
            label="Godot global"
            hint="Godot only: export as `global uniform` — create the same name + type in Project Settings → Shader Globals or the shader will not compile"
          >
            <Toggle
              aria-label="Godot global uniform"
              checked={!!p.godotGlobal}
              onChange={(on) => void updateProperty(p.id, { godotGlobal: on || undefined }, "Toggle Godot global")}
            />
          </Field>
        )}
        <Field label="Header">
          <CommitText
            aria-label="Category header"
            value={p.category ?? ""}
            placeholder="(none)"
            onCommit={(v) => void updateProperty(p.id, { category: v.trim() || undefined }, "Edit header")}
          />
        </Field>
        <Field label="Tooltip">
          <CommitText
            aria-label="Tooltip"
            value={p.tooltip ?? ""}
            placeholder="Shown on hover in the material inspector"
            onCommit={(v) => void updateProperty(p.id, { tooltip: v.trim() || undefined }, "Edit tooltip")}
          />
        </Field>
      </Section>
      <UsedBySection kind="property" id={p.id} uses={uses} />
    </div>
  );
}
