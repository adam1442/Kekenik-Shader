import { Crosshair, Magnet, Maximize2, Shapes, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import {
  evaluate,
  moveKey,
  parseCurve,
  removeKey,
  serializeCurve,
  setKeyMode,
  setWrap,
  solveTangents,
  valueRange,
  type Curve,
  type TangentMode,
  type WrapMode,
} from "@/core/values/curve";
import { CURVE_PRESETS } from "@/core/values/curvePresets";
import { cx } from "../util/cx";
import { useBridge } from "./bridge";
import { CurveCanvas, type CurveCanvasApi } from "./CurveCanvas";
import type { Hit } from "./curveView";
import { NumberField } from "./NumberField";
import { Popover } from "./Popover";
import { SegmentedControl } from "./Segmented";
import { Toggle } from "./Switches";
import type { ControlProps } from "./types";

const CH_COLORS = ["#ff6b6b", "#6bdc7a", "#6b9cff", "#d0d4e0"];
const MODE_BTNS: Array<{ value: TangentMode; label: string; title: string }> = [
  { value: "auto", label: "Auto", title: "Auto-smooth tangents" },
  { value: "free", label: "Free", title: "Free smooth (mirrored handles)" },
  { value: "flat", label: "Flat", title: "Flat tangents" },
  { value: "linear", label: "Linear", title: "Linear toward neighbours" },
  { value: "constant", label: "Step", title: "Constant / stepped" },
  { value: "broken", label: "Broken", title: "Independent left/right handles" },
];
const WRAPS: Array<{ value: WrapMode; label: string }> = [
  { value: "clamp", label: "Clamp" },
  { value: "loop", label: "Loop" },
  { value: "pingpong", label: "Ping-pong" },
];

/** Small SVG preview of a curve over its key range (unit box when `unit`). */
function CurveThumb({ curve, color = "#9b86ff", className }: { curve: Curve; color?: string; className?: string }) {
  const k = curve.keys;
  const t0 = k[0]?.t ?? 0;
  const t1 = k[k.length - 1]?.t ?? 1;
  const [lo, hi] = valueRange(curve, 48);
  const span = hi - lo || 1;
  const pts = Array.from({ length: 41 }, (_, i) => {
    const t = t0 + ((t1 - t0) * i) / 40;
    return `${(i / 40) * 100},${100 - ((evaluate(curve, t) - lo) / span) * 86 - 7}`;
  }).join(" ");
  return (
    <svg className={cx("kk-curvethumb", className)} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface BodyProps {
  curves: Curve[];
  labels?: string[];
  colors?: string[];
  range: "unit" | "free";
  height?: number;
  readOnly?: boolean;
  disabled?: boolean;
  onChange?: (c: Curve[]) => void;
  onCommit?: (c: Curve[]) => void;
  onCancel?: () => void;
  extraBridge?: { defaultValue?: Curve[] };
  "aria-label"?: string;
  className?: string;
  tooltip?: string;
  defaultValue?: Curve[];
}

function CurveBody(props: BodyProps) {
  const { curves, range, readOnly, disabled, onChange, onCommit, onCancel, defaultValue, className, tooltip } = props;
  const locked = readOnly || disabled;
  const multi = curves.length > 1;
  const colors = props.colors ?? (multi ? CH_COLORS : ["#9b86ff"]);
  const labels = props.labels ?? (multi ? ["R", "G", "B", "A"].slice(0, curves.length) : []);
  const [active, setActive] = useState(0);
  const [selection, setSelection] = useState<number[]>([]);
  const [snap, setSnap] = useState(false);
  const [lockRgb, setLockRgb] = useState(true);
  const [presets, setPresets] = useState(false);
  const presetBtn = useRef<HTMLButtonElement>(null);
  const api = useRef<CurveCanvasApi | null>(null);
  const hitRef = useRef<Hit>(null);
  const cur = useRef(curves);
  cur.current = curves;
  const unit = range === "unit";
  const a = Math.min(active, curves.length - 1);
  const curve = curves[a]!;

  const apply = (c: Curve, to: Curve[] = cur.current): Curve[] => {
    const linked = multi && lockRgb && a < 3 && curves.length >= 3;
    return to.map((x, i) => (i === a || (linked && i < 3) ? c : x));
  };
  const live = (c: Curve) => {
    const next = apply(c);
    cur.current = next;
    onChange?.(next);
  };
  const commit = () => onCommit?.(cur.current);
  const cancel = (start: Curve) => {
    const next = apply(start);
    cur.current = next;
    onChange?.(next);
    onCancel?.();
  };
  const edit = (c: Curve) => {
    live(c);
    commit();
  };
  const withSel = (fn: (c: Curve, i: number) => Curve) => {
    let c = curve;
    for (const i of selection) c = fn(c, i);
    edit(c);
  };
  const setMode = (m: TangentMode) => withSel((c, i) => setKeyMode(c, i, m));
  const one = selection.length === 1 ? curve.keys[selection[0]!] : undefined;
  const deleteSel = () => {
    let c = curve;
    for (const i of [...selection].sort((x, y) => y - x)) c = removeKey(c, i);
    setSelection([]);
    edit(c);
  };

  const json = () => JSON.stringify(curves.length === 1 ? serializeCurve(curve) : curves.map(serializeCurve));
  const parseAny = (t: string): Curve[] | null => {
    try {
      const j: unknown = JSON.parse(t);
      const arr = Array.isArray(j) ? j.map(parseCurve) : [parseCurve(j)];
      return arr.every(Boolean) && arr.length === curves.length ? (arr as Curve[]) : null;
    } catch {
      return null;
    }
  };
  const equalsDefault =
    defaultValue !== undefined &&
    JSON.stringify(defaultValue.map(serializeCurve)) === JSON.stringify(curves.map(serializeCurve));
  const { ref, props: ctxProps } = useBridge({
    kind: "curve",
    copyText: json,
    copyJson: () => JSON.stringify(curves.length === 1 ? serializeCurve(curve) : curves.map(serializeCurve), null, 2),
    paste: (t) => {
      const c = parseAny(t);
      if (!c || locked) return false;
      cur.current = c;
      onChange?.(c);
      onCommit?.(c);
      return true;
    },
    reset: defaultValue
      ? () => {
          cur.current = defaultValue;
          onChange?.(defaultValue);
          onCommit?.(defaultValue);
        }
      : undefined,
    canReset: () => defaultValue !== undefined && !equalsDefault,
    disabled,
    readOnly,
    extra: () => {
      const h = hitRef.current;
      const keyItems =
        (h?.kind === "key" || selection.length > 0) && !locked
          ? [
              ...MODE_BTNS.map((m) => ({
                label: `Tangent: ${m.label}`,
                type: "radio" as const,
                checked: one?.mode === m.value,
                run: () => setMode(m.value),
              })),
              { label: "Delete key", danger: true, run: deleteSel },
            ]
          : [];
      return [
        ...keyItems,
        { label: "Frame all", shortcut: "A", run: () => api.current?.frameAll() },
        {
          label: "Frame selection",
          shortcut: "F",
          disabled: !selection.length,
          run: () => api.current?.frameSelection(),
        },
        ...CURVE_PRESETS.slice(0, 8).map((p) => ({
          label: `Preset: ${p.name}`,
          disabled: locked,
          run: () => edit(p.build()),
        })),
      ];
    },
  });

  return (
    <div
      ref={ref}
      {...ctxProps}
      data-kk="curve-editor"
      data-no-pan=""
      className={cx("kk-curve", locked && "is-disabled", className)}
      title={tooltip}
    >
      <div className="kk-curve__bar">
        {multi && (
          <SegmentedControl<string>
            value={String(a)}
            onChange={(v) => {
              setActive(Number(v));
              setSelection([]);
            }}
            density="compact"
            aria-label="Channel"
            options={curves.map((_, i) => ({
              value: String(i),
              label: labels[i] ?? String(i),
              title: `Edit ${labels[i] ?? i}`,
            }))}
          />
        )}
        {multi && curves.length >= 3 && (
          <Toggle checked={lockRgb} onChange={setLockRgb} label="Lock RGB" density="compact" />
        )}
        <span className="kk-curve__spacer" />
        <button
          type="button"
          className={cx("kk-minibtn kk-minibtn--icon", snap && "is-on")}
          aria-pressed={snap}
          onClick={() => setSnap(!snap)}
          aria-label="Snap to grid"
          title="Snap to grid (hold Ctrl to snap temporarily)"
        >
          <Magnet size={12} />
        </button>
        <button
          type="button"
          className="kk-minibtn kk-minibtn--icon"
          onClick={() => api.current?.frameAll()}
          aria-label="Frame all"
          title="Frame all (A)"
        >
          <Maximize2 size={12} />
        </button>
        <button
          type="button"
          className="kk-minibtn kk-minibtn--icon"
          disabled={!selection.length}
          onClick={() => api.current?.frameSelection()}
          aria-label="Frame selection"
          title="Frame selection (F)"
        >
          <Crosshair size={12} />
        </button>
        <button
          ref={presetBtn}
          type="button"
          className="kk-minibtn"
          disabled={locked}
          onClick={() => setPresets(!presets)}
          aria-haspopup="dialog"
          aria-expanded={presets}
        >
          <Shapes size={12} /> Presets
        </button>
      </div>

      <CurveCanvas
        curves={curves}
        active={a}
        colors={colors}
        unit={unit}
        snap={snap}
        selection={selection}
        readOnly={locked}
        height={props.height}
        apiRef={api}
        onSelect={setSelection}
        onEdit={live}
        onCommitEdit={commit}
        onCancelEdit={cancel}
        onContextHit={(h) => (hitRef.current = h)}
        aria-label={props["aria-label"]}
      />

      <div className="kk-curve__bar">
        <SegmentedControl<TangentMode>
          value={(one?.mode ?? "auto") as TangentMode}
          onChange={setMode}
          options={MODE_BTNS}
          density="compact"
          disabled={locked || !selection.length}
          aria-label="Tangent mode"
        />
        {one && selection.length === 1 && (
          <>
            <NumberField
              label="T"
              aria-label="Key time"
              density="compact"
              value={one.t}
              step={0.01}
              precision={3}
              disabled={locked}
              min={unit ? 0 : undefined}
              max={unit ? 1 : undefined}
              onChange={(t) => live(moveKey(curve, selection[0]!, t, one.v, { unit }))}
              onCommit={commit}
            />
            <NumberField
              label="V"
              aria-label="Key value"
              density="compact"
              value={one.v}
              step={0.01}
              precision={3}
              disabled={locked}
              min={unit ? 0 : undefined}
              max={unit ? 1 : undefined}
              onChange={(v) => live(moveKey(curve, selection[0]!, one.t, v, { unit }))}
              onCommit={commit}
            />
          </>
        )}
        <button
          type="button"
          className="kk-minibtn kk-minibtn--icon"
          disabled={locked || !selection.length || curve.keys.length <= 1}
          onClick={deleteSel}
          aria-label="Delete selected keys"
          title="Delete (Del)"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <div className="kk-curve__bar kk-curve__bar--wrap">
        <span className="kk-curve__lbl">Pre</span>
        <SegmentedControl<WrapMode>
          value={curve.preWrap}
          onChange={(w) => edit(setWrap(curve, w, curve.postWrap))}
          options={WRAPS}
          density="compact"
          disabled={locked}
          aria-label="Pre-wrap mode"
        />
        <span className="kk-curve__lbl">Post</span>
        <SegmentedControl<WrapMode>
          value={curve.postWrap}
          onChange={(w) => edit(setWrap(curve, curve.preWrap, w))}
          options={WRAPS}
          density="compact"
          disabled={locked}
          aria-label="Post-wrap mode"
        />
        <Toggle
          checked={curve.overshootSafe}
          onChange={(v) => edit(solveTangents({ ...curve, overshootSafe: v }))}
          label="No overshoot"
          density="compact"
          disabled={locked}
          tooltip="Auto-smooth tangents never overshoot neighbouring key values"
        />
      </div>

      <Popover
        open={presets}
        anchor={presetBtn.current}
        onClose={() => setPresets(false)}
        ariaLabel="Curve presets"
        width={220}
        align="end"
      >
        <div className="kk-presets kk-presets--curves">
          {CURVE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="kk-preset kk-preset--curve"
              onClick={() => {
                edit(p.build());
                setPresets(false);
                setSelection([]);
              }}
            >
              <CurveThumb curve={p.build()} />
              <span className="kk-preset__name">{p.name}</span>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

interface CurveEditorProps extends Omit<ControlProps<Curve>, "label" | "mixed"> {
  /** `unit`: keys are limited to the 0–1 box (normalised); `free`: unlimited. */
  range?: "unit" | "free";
  height?: number;
}

/** Keyframe curve editor (single curve). */
function CurveEditor(p: CurveEditorProps) {
  return (
    <CurveBody
      curves={[p.value]}
      range={p.range ?? "unit"}
      height={p.height}
      readOnly={p.readOnly}
      disabled={p.disabled}
      className={p.className}
      tooltip={p.tooltip}
      aria-label={p["aria-label"]}
      defaultValue={p.defaultValue ? [p.defaultValue] : undefined}
      onChange={(c) => p.onChange?.(c[0]!)}
      onCommit={(c) => p.onCommit?.(c[0]!)}
      onCancel={p.onCancel}
    />
  );
}

interface CurvesEditorProps extends Omit<ControlProps<Curve[]>, "label" | "mixed"> {
  labels?: string[];
  colors?: string[];
  range?: "unit" | "free";
  height?: number;
}

/** Multi-channel ("Curves"-style) editor: channel tabs, per-channel editing, lock-to-RGB. */
export function CurvesEditor(p: CurvesEditorProps) {
  return (
    <CurveBody
      curves={p.value}
      labels={p.labels}
      colors={p.colors}
      range={p.range ?? "unit"}
      height={p.height}
      readOnly={p.readOnly}
      disabled={p.disabled}
      className={p.className}
      tooltip={p.tooltip}
      aria-label={p["aria-label"]}
      defaultValue={p.defaultValue}
      onChange={p.onChange}
      onCommit={p.onCommit}
      onCancel={p.onCancel}
    />
  );
}

interface CurveFieldProps extends Omit<ControlProps<Curve>, "mixed"> {
  range?: "unit" | "free";
}

/** Compact thumbnail trigger that opens the full curve editor in a popover. */
export function CurveField(props: CurveFieldProps) {
  const {
    value,
    onChange,
    onCommit,
    onCancel,
    disabled,
    readOnly,
    invalid,
    message,
    density = "regular",
    className,
    defaultValue,
    tooltip,
    label,
    range,
  } = props;
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const locked = disabled || readOnly;
  const modified =
    defaultValue !== undefined &&
    JSON.stringify(serializeCurve(defaultValue)) !== JSON.stringify(serializeCurve(value));
  const { ref, props: ctxProps } = useBridge(
    {
      kind: "curve.field",
      copyText: () => JSON.stringify(serializeCurve(value)),
      copyJson: () => JSON.stringify(serializeCurve(value), null, 2),
      paste: (t) => {
        try {
          const c = parseCurve(JSON.parse(t));
          if (!c || locked) return false;
          onChange?.(c);
          onCommit?.(c);
          return true;
        } catch {
          return false;
        }
      },
      reset: defaultValue
        ? () => {
            onChange?.(defaultValue);
            onCommit?.(defaultValue);
          }
        : undefined,
      canReset: () => modified,
      disabled,
      readOnly,
    },
    "control.curve",
  );
  return (
    <div
      ref={ref}
      {...ctxProps}
      data-kk="curve-field"
      data-no-pan=""
      data-density={density}
      className={cx(
        "kk-curvefield",
        `kk-curvefield--${density}`,
        locked && "is-disabled",
        invalid && "is-invalid",
        modified && "is-modified",
        className,
      )}
      title={invalid ? message : tooltip}
    >
      <button
        ref={btn}
        type="button"
        className="kk-curvefield__btn"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={props["aria-label"] ?? (typeof label === "string" ? label : "Curve")}
        onClick={() => !readOnly && setOpen((o) => !o)}
      >
        <CurveThumb curve={value} />
      </button>
      <Popover open={open} anchor={btn.current} onClose={() => setOpen(false)} ariaLabel="Curve editor" width={340}>
        <CurveEditor
          value={value}
          range={range}
          onChange={onChange}
          onCommit={onCommit}
          onCancel={onCancel}
          defaultValue={defaultValue}
        />
      </Popover>
    </div>
  );
}
