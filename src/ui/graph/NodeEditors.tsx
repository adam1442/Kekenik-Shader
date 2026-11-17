import { useState } from "react";
import type { ParamSchema, PortDef, PortValue, ParamValue, ShaderType } from "@/core";
import { ColorField, IntField, NumberField, Select, TextField, Toggle, VecField, type Density } from "@/ui";
import { setParam, setPortValue } from "./actions";

/** Local draft so live `onChange` ticks do not hit the graph; the graph gets ONE op per gesture (`onCommit`). */
function useDraft<T>(stored: T, commit: (v: T) => void) {
  const [draft, setDraft] = useState<T | null>(null);
  return {
    value: draft ?? stored,
    onChange: (v: T) => setDraft(v),
    onCommit: (v: T) => {
      setDraft(null);
      commit(v);
    },
    onCancel: () => setDraft(null),
  };
}

const DIM: Partial<Record<ShaderType, number>> = { vec2: 2, vec3: 3, vec4: 4, color: 3, color4: 4 };
export const isInlineEditable = (t: ShaderType | undefined): boolean =>
  t === "float" || t === "int" || t === "bool" || (t !== undefined && t in DIM);

/** Stored inline values are scalars (splat) or arrays; normalise to `dim` numbers (colour alpha defaults to 1). */
export function toComponents(v: PortValue | undefined, dim: number, alphaDefault = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < dim; i++) {
    const d = i === 3 ? alphaDefault : 0;
    out.push(Array.isArray(v) ? (v[i] ?? d) : typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : d);
  }
  return out;
}

const LABELS = ["X", "Y", "Z", "W"] as const;

interface PortEditorProps {
  nodeId: string;
  port: PortDef;
  /** Resolved type of the port (after generic inference). */
  type: ShaderType;
  value: PortValue | undefined;
  density?: Density;
}

/** Inline constant editor of an UNCONNECTED input (graph nodes use `compact`, the Inspector `regular`). */
export function PortValueEditor({ nodeId, port, type, value, density = "compact" }: PortEditorProps) {
  const raw = value ?? port.default;
  const label = `${port.name}`;
  const save = (v: PortValue) => setPortValue(nodeId, port.id, v);
  const scalar =
    typeof raw === "number" ? raw : typeof raw === "boolean" ? (raw ? 1 : 0) : Array.isArray(raw) ? (raw[0] ?? 0) : 0;
  const d = useDraft<number>(scalar, save);
  const dim = DIM[type] ?? 0;
  const comps = toComponents(raw, dim || 1, type === "color4" ? 1 : 0);
  const v = useDraft<number[]>(comps, save);
  const colorV = useDraft<{ r: number; g: number; b: number; a: number }>(
    { r: comps[0] ?? 0, g: comps[1] ?? 0, b: comps[2] ?? 0, a: comps[3] ?? 1 },
    (c) => save(type === "color4" ? [c.r, c.g, c.b, c.a] : [c.r, c.g, c.b]),
  );

  if (type === "float") return <NumberField density={density} step={0.01} aria-label={label} {...d} />;
  if (type === "int") return <IntField density={density} aria-label={label} {...d} />;
  if (type === "bool")
    return <Toggle density={density} aria-label={label} checked={!!scalar} onChange={(b) => save(b)} />;
  if (type === "color" || type === "color4")
    return (
      <ColorField
        density={density}
        alpha={type === "color4"}
        aria-label={label}
        showHex={density !== "compact"}
        {...colorV}
      />
    );
  if (dim)
    return (
      <VecField
        density={density}
        dim={dim as 2 | 3 | 4}
        labels={LABELS.slice(0, dim)}
        step={0.01}
        aria-label={label}
        {...v}
      />
    );
  return null;
}

interface ParamEditorProps {
  nodeId: string;
  schema: ParamSchema;
  value: ParamValue | undefined;
  density?: Density;
  /** Where the value goes. Default: the node parameter `schema.id` of `nodeId` (also used for profile settings by passing a custom saver). */
  onSave?: (v: ParamValue) => void;
  /** HDR mode of a colour parameter (Color node `hdr` toggle): intensity / EV slider, values above 1 allowed and never clamped. */
  hdr?: boolean;
}

/** Editor of one parameter described by a `ParamSchema` (`NodeDef.params`, profile settings). */
export function ParamEditor({ nodeId, schema, value, density = "compact", onSave, hdr = false }: ParamEditorProps) {
  const cur = value ?? schema.default;
  const save = onSave ?? ((v: ParamValue) => setParam(nodeId, schema.id, v));
  const num = typeof cur === "number" ? cur : 0;
  const nd = useDraft<number>(num, save);
  const text = useDraft<string>(typeof cur === "string" ? cur : String(cur), save);
  const arr = Array.isArray(cur) ? cur : [0, 0, 0];
  const vd = useDraft<number[]>(arr, save);
  const cd = useDraft<{ r: number; g: number; b: number; a: number }>(
    { r: arr[0] ?? 0, g: arr[1] ?? 0, b: arr[2] ?? 0, a: arr[3] ?? 1 },
    (c) => save(arr.length > 3 ? [c.r, c.g, c.b, c.a] : [c.r, c.g, c.b]),
  );
  const common = { density, "aria-label": schema.label } as const;
  switch (schema.control) {
    case "number":
      return (
        <NumberField
          {...common}
          step={schema.step ?? 0.01}
          {...(schema.min !== undefined ? { min: schema.min } : {})}
          {...(schema.max !== undefined ? { max: schema.max } : {})}
          {...nd}
        />
      );
    case "int":
      return (
        <IntField
          {...common}
          {...(schema.min !== undefined ? { min: schema.min } : {})}
          {...(schema.max !== undefined ? { max: schema.max } : {})}
          {...nd}
        />
      );
    case "bool":
      return <Toggle {...common} checked={!!cur} onChange={(b) => save(b)} />;
    case "enum":
      return (
        <Select
          {...common}
          value={String(cur)}
          options={(schema.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
          onChange={(s) => save(s)}
        />
      );
    case "string":
      return (
        <TextField
          {...common}
          mono
          value={text.value}
          onChange={text.onChange}
          onCommit={text.onCommit}
          onCancel={text.onCancel}
        />
      );
    case "color":
      return <ColorField {...common} hdr={hdr} alpha={arr.length > 3} showHex={density !== "compact"} {...cd} />;
    case "vector":
      return (
        <VecField
          {...common}
          dim={Math.min(4, Math.max(2, arr.length)) as 2 | 3 | 4}
          labels={LABELS.slice(0, arr.length)}
          step={schema.step ?? 0.01}
          {...vd}
        />
      );
  }
}
