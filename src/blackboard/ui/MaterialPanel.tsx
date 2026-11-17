import { ClipboardPaste, Copy, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import {
  DEFAULT_ST,
  type Keyword,
  type Property,
  REF_TARGETS,
  stKey,
  TARGET_LABEL,
  type RefTarget,
  buildMaterialManifest,
  keywordTargetName,
  manifestToJson,
  targetReferenceName,
} from "@/core";
import type { PanelProps } from "@/app/dock/panelRegistry";
import {
  Button,
  CodeView,
  EmptyState,
  PropertyGrid,
  PropertyRow,
  PropertySection,
  ScrollArea,
  Select,
  Tabs,
  Toggle,
} from "@/ui";
import { PropertyTextureSlot } from "@/preview/ui/PropertyTextureSlot";
import { usePreview } from "@/preview/previewStore";
import { useGraphs } from "@/ui/graph/graphStore";
import { updateProperty } from "../actions";
import { copyMaterialJson, pasteMaterialFromClipboard } from "../materialActions";
import {
  resetMaterial,
  resetMaterialValue,
  setKeyword,
  setMaterialValue,
  useKeywordValues,
  useMaterialValues,
} from "../materialStore";
import { ValueEditor } from "./ValueEditor";
import { defaultOf, valuesEqual } from "./valueUtil";

function TextureRow({ p, values }: { p: Property; values: Record<string, unknown> }) {
  const st = (values[stKey(p.id)] as number[] | undefined) ?? DEFAULT_ST;
  return (
    <PropertyTextureSlot
      p={p}
      onDefaultKind={(k) => void updateProperty(p.id, { textureDefault: k }, "Edit default texture")}
      {...(p.tilingOffset
        ? {
            transform: {
              tiling: [st[0]!, st[1]!] as [number, number],
              offset: [st[2]!, st[3]!] as [number, number],
              onChange: (t: [number, number], o: [number, number]) =>
                setMaterialValue(stKey(p.id), [t[0], t[1], o[0], o[1]]),
            },
          }
        : {})}
    />
  );
}

function ParamRow({ p, values, target }: { p: Property; values: Record<string, never>; target: RefTarget }) {
  const overridden = p.id in values;
  const value = overridden ? values[p.id]! : defaultOf(p);
  const boundTex = usePreview((s) => s.bindings[p.id] ?? null);
  const dirty = p.type === "texture2D" ? !!boundTex : overridden && !valuesEqual(value, defaultOf(p));
  const ref = targetReferenceName(p.referenceName, target);
  return (
    <PropertyRow
      label={
        <span title={`${p.tooltip ? `${p.tooltip}\n` : ""}${ref}`} data-testid="mat-label">
          {p.displayName}
        </span>
      }
      dirty={dirty}
      onReset={() => (p.type === "texture2D" ? usePreview.getState().bind(p.id, null) : resetMaterialValue(p.id))}
    >
      <div data-testid="mat-row" data-prop={p.id} className="kk-mat-ctl">
        {p.type === "texture2D" ? (
          <TextureRow p={p} values={values} />
        ) : (
          <ValueEditor
            p={p}
            density="compact"
            value={value}
            defaultValue={defaultOf(p)}
            onChange={(v) => setMaterialValue(p.id, v)}
            onCommit={(v) => setMaterialValue(p.id, v)}
          />
        )}
      </div>
    </PropertyRow>
  );
}

function KeywordRow({ k, value, target }: { k: Keyword; value: number; target: RefTarget }) {
  return (
    <PropertyRow
      label={
        <span title={`${k.tooltip ? `${k.tooltip}\n` : ""}${keywordTargetName(k.referenceName, target)}`}>
          {k.displayName}
        </span>
      }
      dirty={value !== k.default}
      onReset={() => setKeyword(k.id, k.default)}
    >
      <div data-testid="mat-keyword" data-keyword={k.id} className="kk-mat-ctl">
        {k.kind === "boolean" ? (
          <Toggle
            density="compact"
            aria-label={k.displayName}
            checked={value !== 0}
            onChange={(on) => setKeyword(k.id, on ? 1 : 0)}
          />
        ) : (
          <Select<string>
            density="compact"
            searchable={false}
            aria-label={k.displayName}
            value={String(value)}
            options={(k.entries ?? []).map((e, i) => ({ value: String(i), label: e }))}
            onChange={(v) => setKeyword(k.id, Number(v))}
          />
        )}
      </div>
    </PropertyRow>
  );
}

/** Material Inspector emulation: the panel a game engine would auto-generate for this shader. Edits are live in the Preview (uniforms only). */
export function MaterialPanel(_p: PanelProps) {
  const graph = useGraphs((s) => s.docs.find((d) => d.id === s.activeId)?.graph);
  const values = useMaterialValues() as Record<string, never>;
  const kw = useKeywordValues();
  const [tab, setTab] = useState("inspector");
  const [target, setTarget] = useState<RefTarget>("unity");
  const manifest = useMemo(() => (graph ? buildMaterialManifest(graph) : null), [graph]);
  const json = useMemo(() => (manifest ? manifestToJson(manifest) : ""), [manifest]);
  if (!graph || !manifest)
    return (
      <EmptyState
        icon={SlidersHorizontal}
        title="No graph"
        description="Open or create a graph to see its material inspector."
      />
    );
  const byId = new Map(graph.properties.map((p) => [p.id, p]));
  const exposed = manifest.parameters.map((m) => byId.get(m.id)!).filter((p) => !p.perInstance);
  const perInstance = manifest.parameters.map((m) => byId.get(m.id)!).filter((p) => p.perInstance);
  const headers: Array<string | null> = [null, ...manifest.headers];
  const section = (h: string | null) => {
    const ps = exposed.filter((p) => (p.category ?? null) === h);
    const ks = graph.keywords.filter((k) => (k.category ?? null) === h);
    if (!ps.length && !ks.length) return null;
    return (
      <PropertySection key={h ?? "·"} title={h ?? "Surface Inputs"}>
        {ps.map((p) => (
          <ParamRow key={p.id} p={p} values={values} target={target} />
        ))}
        {ks.map((k) => (
          <KeywordRow key={k.id} k={k} value={kw[k.id] ?? k.default} target={target} />
        ))}
      </PropertySection>
    );
  };
  return (
    <div className="kk-mat" data-testid="material-panel">
      <div className="kk-mat__bar">
        <Tabs
          items={[
            { id: "inspector", label: "Inspector" },
            { id: "manifest", label: "Manifest" },
          ]}
          value={tab}
          onChange={setTab}
        />
        <span className="kk-mat__spacer" />
        <Select<RefTarget>
          density="compact"
          searchable={false}
          aria-label="Show names for"
          value={target}
          options={REF_TARGETS.map((t) => ({ value: t, label: TARGET_LABEL[t] }))}
          onChange={setTarget}
        />
      </div>
      {tab === "manifest" ? (
        <div className="kk-mat__manifest" data-testid="material-manifest">
          <CodeView value={json} language="plain" label="Material parameter manifest" lineNumbers />
        </div>
      ) : (
        <ScrollArea style={{ flex: 1, minHeight: 0 }}>
          <div className="kk-mat__head" data-testid="mat-head">
            <b>{graph.name}</b>
            <span>
              Material · {manifest.parameters.length} parameter{manifest.parameters.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="kk-mat__actions">
            <Button size="sm" variant="ghost" onClick={() => resetMaterial()} data-testid="mat-reset">
              <RotateCcw size={12} /> Reset
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void copyMaterialJson()} data-testid="mat-copy">
              <Copy size={12} /> Copy values
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void pasteMaterialFromClipboard()} data-testid="mat-paste">
              <ClipboardPaste size={12} /> Paste values
            </Button>
          </div>
          {exposed.length === 0 && graph.keywords.length === 0 ? (
            <EmptyState
              title="No exposed parameters"
              description="Add properties in the Blackboard. Exposed ones appear here exactly as in your game engine's material inspector."
            />
          ) : (
            <PropertyGrid density="compact" labelWidth={112}>
              {headers.map(section)}
              {perInstance.length > 0 && (
                <PropertySection title="Per-instance (set from code)" defaultOpen={false}>
                  {perInstance.map((p) => (
                    <ParamRow key={p.id} p={p} values={values} target={target} />
                  ))}
                </PropertySection>
              )}
            </PropertyGrid>
          )}
        </ScrollArea>
      )}
    </div>
  );
}
