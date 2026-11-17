import { Link2, Unlink2 } from "lucide-react";
import { useRef, useState, type ClipboardEvent } from "react";
import { applyLinked, AXES, formatVecText, parseVecText, type LinkMode } from "@/core/values/vec";
import { clampRange, type NumRange } from "@/core/values/numeric";
import { cx } from "../util/cx";
import { useBridge } from "./bridge";
import { NumberField } from "./NumberField";
import type { ControlProps } from "./types";

export interface VecFieldProps extends Omit<ControlProps<number[]>, "mixed">, NumRange {
  /** Number of components (2–4). Defaults to value.length. */
  dim?: 2 | 3 | 4;
  /** Axis labels, e.g. ["U","V"] or ["R","G","B","A"]. */
  labels?: readonly string[];
  /** Show the link / uniform-scale lock button. */
  linkable?: boolean;
  /** Initial link mode when `linkable`. */
  defaultLink?: LinkMode;
  /** Per-component mixed state (multi-selection). */
  mixed?: boolean[];
  step?: number;
  precision?: number;
  unit?: string;
  /** `row` (default) or `stacked` (one component per line). */
  layout?: "row" | "stacked";
  /** Normalise the result on commit/paste (direction vectors). */
  normalize?: boolean;
}

const AXIS_COLORS = ["#f06a6a", "#6fd36f", "#6a9cf0", "#bdbdbd"];

/** Vec2/3/4 editor: per-axis scrub on the label, link lock, paste "1, 2, 3" / "(1 2 3)" / JSON, per-component mixed state. */
export function VecField(props: VecFieldProps) {
  const {
    value,
    onChange,
    onCommit,
    disabled,
    readOnly,
    density = "regular",
    layout = "row",
    className,
    linkable,
    label,
    tooltip,
    defaultValue,
    invalid,
    message,
    step = 0.01,
    precision,
    unit,
    normalize,
  } = props;
  const dim = props.dim ?? (value.length as 2 | 3 | 4);
  const labels = props.labels ?? AXES.map((a) => a.toUpperCase());
  const [link, setLink] = useState<LinkMode>(props.defaultLink ?? "off");
  const cur = useRef(value);
  cur.current = value;
  const locked = disabled || readOnly;
  const range: NumRange = { min: props.min, max: props.max, softMin: props.softMin, softMax: props.softMax };

  const norm = (v: number[]): number[] => {
    if (!normalize) return v;
    const len = Math.hypot(...v);
    return len > 1e-9 ? v.map((x) => x / len) : v;
  };
  const setComp = (i: number, v: number, commit: boolean) => {
    const next = applyLinked(cur.current, i, v, link).map((x) => clampRange(x, range, "hard"));
    const out = commit ? norm(next) : next;
    cur.current = out;
    onChange?.(out);
    if (commit) onCommit?.(out);
  };
  const applyAll = (v: number[]) => {
    const out = norm(v.map((x) => clampRange(x, range, "hard")));
    cur.current = out;
    onChange?.(out);
    onCommit?.(out);
  };
  const modified =
    defaultValue !== undefined && (props.mixed?.some(Boolean) || defaultValue.some((d, i) => d !== value[i]));
  const { ref, props: ctxProps } = useBridge({
    kind: "vec",
    copyText: () => formatVecText(value),
    copyJson: () => JSON.stringify(Object.fromEntries(value.map((v, i) => [AXES[i], v]))),
    paste: (t) => {
      const v = parseVecText(t, dim);
      if (!v || locked) return false;
      applyAll(v);
      return true;
    },
    reset: defaultValue ? () => applyAll(defaultValue) : undefined,
    canReset: () => !!modified,
    disabled,
    readOnly,
  });
  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData("text");
    if (locked || !/[\s,;()[\]{}]/.test(text.trim())) return; // a single number pastes into the focused component normally
    const v = parseVecText(text, dim);
    if (!v) return;
    e.preventDefault();
    applyAll(v);
  };

  return (
    <div
      ref={ref}
      {...ctxProps}
      data-kk="vec-field"
      data-no-pan=""
      data-dim={dim}
      data-density={density}
      role="group"
      aria-label={props["aria-label"] ?? (typeof label === "string" ? label : "Vector")}
      className={cx(
        "kk-vec",
        `kk-vec--${layout}`,
        `kk-vec--${density}`,
        invalid && "is-invalid",
        locked && "is-disabled",
        className,
      )}
      title={invalid ? message : tooltip}
      onPaste={onPaste}
    >
      {Array.from({ length: dim }, (_, i) => (
        <div key={i} className="kk-vec__cell" data-axis={labels[i]} style={{ ["--kk-axis" as string]: AXIS_COLORS[i] }}>
          <NumberField
            value={value[i] ?? 0}
            label={labels[i]}
            aria-label={`${labels[i]}`}
            density={density}
            step={step}
            precision={precision}
            unit={unit}
            min={props.min}
            max={props.max}
            softMin={props.softMin}
            softMax={props.softMax}
            disabled={disabled}
            readOnly={readOnly}
            mixed={props.mixed?.[i]}
            invalid={invalid}
            onChange={(v) => setComp(i, v, false)}
            onCommit={(v) => setComp(i, v, true)}
            onCancel={props.onCancel}
          />
        </div>
      ))}
      {linkable && (
        <button
          type="button"
          className={cx("kk-vec__link", link !== "off" && "is-on")}
          aria-pressed={link !== "off"}
          aria-label={link === "off" ? "Link components" : "Unlink components"}
          title={
            link === "off"
              ? "Link components (uniform)"
              : link === "uniform"
                ? "Uniform — click for proportional"
                : "Proportional — click to unlink"
          }
          disabled={locked}
          onClick={() => setLink(link === "off" ? "uniform" : link === "uniform" ? "proportional" : "off")}
        >
          {link === "off" ? <Unlink2 size={12} /> : <Link2 size={12} />}
          {link === "proportional" && <span className="kk-vec__linkmark">%</span>}
        </button>
      )}
    </div>
  );
}

type Dim = Omit<VecFieldProps, "dim" | "value" | "onChange" | "onCommit" | "defaultValue"> & {
  value: readonly number[];
  onChange?: (v: number[]) => void;
  onCommit?: (v: number[]) => void;
  defaultValue?: readonly number[];
};
const wrap = (dim: 2 | 3 | 4, labels?: readonly string[]) =>
  function Vec(p: Dim) {
    return (
      <VecField
        labels={labels}
        {...p}
        value={p.value as number[]}
        defaultValue={p.defaultValue as number[] | undefined}
        dim={dim}
      />
    );
  };
export const Vec2Field = wrap(2);
export const Vec3Field = wrap(3);
export const Vec4Field = wrap(4);
/** Rect (x, y, width, height). */
export const RectField = wrap(4, ["X", "Y", "W", "H"]);
