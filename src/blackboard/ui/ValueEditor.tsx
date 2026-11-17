import type { Property, PropertyValue } from "@/core";
import { type Density, ColorField, IntField, NumberField, Select, Slider, Toggle, VecField } from "@/ui";
import { defaultOf, toNum, toVec } from "./valueUtil";

export interface ValueEditorProps {
  p: Property;
  value: PropertyValue;
  /** Live change (drag ticks). */
  onChange: (v: PropertyValue) => void;
  /** Once per gesture. */
  onCommit: (v: PropertyValue) => void;
  onCancel?: () => void;
  density?: Density;
  /** Marker + reset affordance target (the shader default for a material override). */
  defaultValue?: PropertyValue;
  disabled?: boolean;
}

const LABELS = ["X", "Y", "Z", "W"] as const;

/**
 * One control per property type, picked exactly as a game-engine inspector would:
 * Range → slider, float → field, int → int field, enum → dropdown, bool → toggle, vectors → N fields, colour → picker (HDR aware).
 * Used by the Property tab (draft + commit) AND the Material Inspector (live).
 */
export function ValueEditor({
  p,
  value,
  onChange,
  onCommit,
  onCancel,
  density = "regular",
  defaultValue,
  disabled,
}: ValueEditorProps) {
  const label = p.displayName;
  const common = { density, disabled, "aria-label": label } as const;
  const both = (v: PropertyValue) => {
    onChange(v);
    onCommit(v);
  };
  const live = { onChange, onCommit, ...(onCancel ? { onCancel } : {}) };
  const range = { ...(p.min !== undefined ? { min: p.min } : {}), ...(p.max !== undefined ? { max: p.max } : {}) };
  const def = defaultValue ?? defaultOf(p);

  if ((p.type === "float" || p.type === "int") && p.enumValues?.length) {
    return (
      <Select<string>
        {...common}
        searchable={false}
        value={String(toNum(value))}
        options={p.enumValues.map((e) => ({ value: String(e.value), label: e.name }))}
        onChange={(s) => both(Number(s))}
      />
    );
  }
  switch (p.type) {
    case "float":
      if (p.slider && p.min !== undefined && p.max !== undefined) {
        return (
          <Slider
            {...common}
            {...live}
            min={p.min}
            max={p.max}
            step={p.step ?? 0.01}
            value={toNum(value)}
            defaultValue={toNum(def)}
          />
        );
      }
      return (
        <NumberField
          {...common}
          {...live}
          {...range}
          step={p.step ?? 0.01}
          value={toNum(value)}
          defaultValue={toNum(def)}
        />
      );
    case "int":
      if (p.slider && p.min !== undefined && p.max !== undefined) {
        return (
          <Slider
            {...common}
            {...live}
            min={p.min}
            max={p.max}
            step={Math.max(1, Math.round(p.step ?? 1))}
            precision={0}
            value={toNum(value)}
            defaultValue={toNum(def)}
          />
        );
      }
      return <IntField {...common} {...live} {...range} value={toNum(value)} defaultValue={toNum(def)} />;
    case "bool":
      return <Toggle {...common} checked={!!value} onChange={(b) => both(b)} />;
    case "vec2":
    case "vec3":
    case "vec4": {
      const dim = Number(p.type[3]) as 2 | 3 | 4;
      return (
        <VecField
          {...common}
          {...live}
          dim={dim}
          labels={LABELS.slice(0, dim)}
          step={p.step ?? 0.01}
          value={toVec(value, dim)}
          defaultValue={toVec(def, dim)}
        />
      );
    }
    case "color":
    case "color4": {
      const n = p.type === "color4" ? 4 : 3;
      const arr = toVec(value, n, 1);
      const darr = toVec(def, n, 1);
      const toRgba = (a: number[]) => ({ r: a[0] ?? 0, g: a[1] ?? 0, b: a[2] ?? 0, a: a[3] ?? 1 });
      const fromRgba = (c: { r: number; g: number; b: number; a: number }): number[] =>
        n === 4 ? [c.r, c.g, c.b, c.a] : [c.r, c.g, c.b];
      return (
        <ColorField
          {...common}
          hdr={!!p.hdr}
          alpha={n === 4}
          showHex={density !== "compact"}
          value={toRgba(arr)}
          defaultValue={toRgba(darr)}
          onChange={(c) => onChange(fromRgba(c))}
          onCommit={(c) => onCommit(fromRgba(c))}
          {...(onCancel ? { onCancel } : {})}
        />
      );
    }
    default:
      return null;
  }
}
