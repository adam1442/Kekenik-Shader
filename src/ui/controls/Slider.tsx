import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import {
  clamp,
  clampRange,
  defaultPrecision,
  limitsOf,
  modMultiplier,
  roundTo,
  snapToStep,
  formatFixed,
  safeAdd,
  type NumRange,
} from "@/core/values/numeric";
import { LINEAR, tToValue, valueToT, type SliderMapping } from "@/core/values/mapping";
import { cx } from "../util/cx";
import { useBridge } from "./bridge";
import { NumberField } from "./NumberField";
import { beginDrag } from "./useDrag";
import type { ControlProps } from "./types";
import { parseExpression } from "@/core/values/expr";

export interface SliderProps extends ControlProps<number>, NumRange {
  step?: number;
  precision?: number;
  unit?: string;
  /** linear (default) / log / power mapping between track position and value. */
  mapping?: SliderMapping;
  /** Tick marks: explicit values, or a count of equal divisions. */
  ticks?: number[] | number;
  /** Snap to ticks when dragging (Alt also snaps to step). */
  snapToTicks?: boolean;
  /** Fused numeric field on the right (default true). */
  showField?: boolean;
  /** `inline`: no track — a filled NumberField; a single click reveals the text editor. */
  variant?: "track" | "inline";
}

function tickValues(ticks: SliderProps["ticks"], lo: number, hi: number): number[] {
  if (!ticks) return [];
  if (Array.isArray(ticks)) return ticks;
  const n = Math.max(1, Math.floor(ticks));
  return Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
}

/**
 * Slider with fused numeric field, filled track, ticks, default marker, drag tooltip, log/power mapping,
 * soft/hard limits. Shift while dragging = relative fine mode, Alt = snap to step. Double-click = reset to default.
 */
export function Slider(props: SliderProps) {
  const {
    value,
    onChange,
    onCommit,
    onCancel,
    step = 0.01,
    disabled,
    readOnly,
    mixed,
    density = "regular",
    defaultValue,
    mapping = LINEAR,
    className,
    label,
    tooltip,
    invalid,
    message,
    unit,
    showField = true,
    variant = "track",
  } = props;
  const precision = props.precision ?? defaultPrecision(step);
  const range: NumRange = { min: props.min ?? 0, max: props.max ?? 1, softMin: props.softMin, softMax: props.softMax };
  const { lo, hi } = limitsOf(range, "soft");
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const L = useRef({ ...props, step, precision, range, lo, hi, mapping });
  L.current = { ...props, step, precision, range, lo, hi, mapping };
  const cur = useRef(value);
  cur.current = value;
  const locked = disabled || readOnly;
  const ticks = tickValues(props.ticks, lo, hi);

  const quantize = (v: number, alt: boolean): number => {
    const l = L.current;
    let q = clamp(v, l.lo, l.hi);
    if (l.snapToTicks && ticks.length) {
      const near = ticks.reduce((a, b) => (Math.abs(b - q) < Math.abs(a - q) ? b : a));
      if (Math.abs(valueToT(near, l.lo, l.hi, l.mapping) - valueToT(q, l.lo, l.hi, l.mapping)) < 0.02) q = near;
    }
    if (alt || l.mapping.kind === "linear") q = alt ? snapToStep(q, l.step, l.lo) : snapToStep(q, l.step, l.lo);
    else q = roundTo(q, l.precision);
    return clamp(roundTo(q, l.precision + 2), l.lo, l.hi);
  };

  const emit = (v: number) => {
    if (v !== cur.current || mixed) {
      cur.current = v;
      L.current.onChange?.(v);
    }
  };

  const valueAtX = (clientX: number): number => {
    const r = trackRef.current!.getBoundingClientRect();
    const t = r.width > 0 ? clamp((clientX - r.left) / r.width, 0, 1) : 0;
    return tToValue(t, L.current.lo, L.current.hi, L.current.mapping);
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (locked || e.button !== 0 || !trackRef.current) return;
    e.preventDefault();
    e.currentTarget.focus();
    const startVal = cur.current;
    let changed = false;
    let acc = valueAtX(e.clientX);
    let fine = false;
    const apply = (raw: number, alt: boolean) => {
      const before = cur.current;
      emit(quantize(raw, alt));
      if (cur.current !== before) changed = true;
    };
    apply(acc, e.altKey);
    beginDrag(
      {
        clientX: e.clientX,
        clientY: e.clientY,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        target: e.currentTarget,
      },
      {
        onStart: () => setDragging(true),
        onMove: (p) => {
          const l = L.current;
          const shift = p.event.shiftKey;
          if (shift) {
            const w = trackRef.current!.getBoundingClientRect().width || 1;
            const t0 = valueToT(fine ? acc : cur.current, l.lo, l.hi, l.mapping);
            acc = tToValue(clamp(t0 + (p.dx / w) * 0.1, 0, 1), l.lo, l.hi, l.mapping);
            fine = true;
            apply(acc, p.event.altKey);
          } else {
            fine = false;
            acc = valueAtX(p.clientX);
            apply(acc, p.event.altKey);
          }
        },
        onEnd: ({ cancelled }) => {
          setDragging(false);
          if (cancelled) {
            cur.current = startVal;
            L.current.onChange?.(startVal);
            L.current.onCancel?.();
          } else if (changed) L.current.onCommit?.(cur.current);
        },
      },
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    const mult = modMultiplier({ shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey });
    let next: number | null = null;
    const base = Number.isFinite(value) ? value : lo;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = safeAdd(base, step * mult);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = safeAdd(base, -step * mult);
    else if (e.key === "Home") next = lo;
    else if (e.key === "End") next = hi;
    else if (e.key === "PageUp") next = safeAdd(base, step * 10);
    else if (e.key === "PageDown") next = safeAdd(base, -step * 10);
    if (next !== null) {
      e.preventDefault();
      const q = clampRange(roundTo(next, precision + 2), range, "soft");
      emit(q);
      onCommit?.(q);
    }
  };

  const reset = () => {
    if (defaultValue === undefined || locked) return;
    cur.current = defaultValue;
    onChange?.(defaultValue);
    onCommit?.(defaultValue);
  };
  const modified = defaultValue !== undefined && (mixed || defaultValue !== value);
  const { ref: rootRef, props: ctxProps } = useBridge({
    kind: "slider",
    copyText: () => formatFixed(value, precision),
    copyJson: () => JSON.stringify(value),
    paste: (t) => {
      const r = parseExpression(t, { unit });
      if (!r.ok || locked) return false;
      const q = clampRange(r.value, range, "hard");
      emit(q);
      onCommit?.(q);
      return true;
    },
    reset: defaultValue !== undefined ? reset : undefined,
    canReset: () => modified,
    disabled,
    readOnly,
  });

  const field = (
    <NumberField
      value={value}
      min={range.min}
      max={range.max}
      softMin={range.softMin}
      softMax={range.softMax}
      step={step}
      precision={props.precision}
      unit={unit}
      mixed={mixed}
      disabled={disabled}
      readOnly={readOnly}
      invalid={invalid}
      message={message}
      density="compact"
      hideInlineLabel
      aria-label={props["aria-label"] ?? (typeof label === "string" ? label : "Value")}
      className={variant === "inline" ? "kk-slider__inlinefield" : "kk-numfield--bare kk-slider__field"}
      clickToEdit={variant === "inline"}
      onChange={(v) => emit(v)}
      onCommit={(v) => onCommit?.(v)}
      onCancel={onCancel}
    />
  );

  if (variant === "inline") {
    return (
      <div
        ref={rootRef}
        {...ctxProps}
        data-kk="slider"
        data-no-pan=""
        className={cx("kk-slider kk-slider--inline", className)}
        title={tooltip}
      >
        {field}
      </div>
    );
  }

  const t = clamp(valueToT(Number.isFinite(value) ? value : lo, lo, hi, mapping), 0, 1);
  const td = defaultValue !== undefined ? clamp(valueToT(defaultValue, lo, hi, mapping), 0, 1) : null;
  return (
    <div
      ref={rootRef}
      {...ctxProps}
      data-kk="slider"
      data-no-pan=""
      data-density={density}
      className={cx(
        "kk-slider",
        `kk-slider--${density}`,
        locked && "is-disabled",
        mixed && "is-mixed",
        invalid && "is-invalid",
        dragging && "is-dragging",
        modified && "is-modified",
        className,
      )}
      title={tooltip}
    >
      <div
        role="slider"
        className="kk-slider__control"
        tabIndex={locked ? -1 : 0}
        aria-valuemin={lo}
        aria-valuemax={hi}
        aria-valuenow={mixed ? undefined : value}
        aria-valuetext={mixed ? "mixed" : formatFixed(value, precision)}
        aria-label={props["aria-label"] ?? (typeof label === "string" ? label : undefined)}
        aria-disabled={disabled || undefined}
        aria-readonly={readOnly || undefined}
        aria-orientation="horizontal"
        onPointerDown={onPointerDown}
        onDoubleClick={reset}
        onKeyDown={onKeyDown}
      >
        <div ref={trackRef} className="kk-slider__track">
          {ticks.map((tv, i) => (
            <span
              key={i}
              className="kk-slider__tick"
              style={{ left: `${clamp(valueToT(tv, lo, hi, mapping), 0, 1) * 100}%` }}
            />
          ))}
          {!mixed && <div className="kk-slider__fill" style={{ width: `${t * 100}%` }} />}
          {td !== null && <span className="kk-slider__default" style={{ left: `${td * 100}%` }} title="Default" />}
          {!mixed && <div className="kk-slider__thumb" style={{ left: `${t * 100}%` }} />}
          {dragging && (
            <div className="kk-slider__tip" style={{ left: `${t * 100}%` }}>
              {formatFixed(value, precision)}
              {unit}
            </div>
          )}
        </div>
      </div>
      {showField && field}
    </div>
  );
}

interface RangeSliderProps extends Omit<ControlProps<[number, number]>, "label"> {
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  label?: React.ReactNode;
}

/** Two-handle min–max slider. The handles cannot cross; Shift = fine; arrows step. */
export function RangeSlider({
  value,
  onChange,
  onCommit,
  onCancel,
  min = 0,
  max = 1,
  step = 0.01,
  precision,
  disabled,
  readOnly,
  density = "regular",
  className,
  label,
  tooltip,
  defaultValue,
  mixed,
}: RangeSliderProps) {
  const prec = precision ?? defaultPrecision(step);
  const trackRef = useRef<HTMLDivElement>(null);
  const cur = useRef(value);
  cur.current = value;
  const L = useRef({ onChange, onCommit, onCancel, min, max, step, prec });
  L.current = { onChange, onCommit, onCancel, min, max, step, prec };
  const [active, setActive] = useState<0 | 1 | null>(null);
  const locked = disabled || readOnly;
  const pos = (v: number) => clamp((v - min) / (max - min || 1), 0, 1) * 100;
  const set = (i: 0 | 1, v: number): [number, number] => {
    const q = roundTo(
      clamp(snapToStep(v, L.current.step, L.current.min), L.current.min, L.current.max),
      L.current.prec + 2,
    );
    const next: [number, number] =
      i === 0 ? [Math.min(q, cur.current[1]), cur.current[1]] : [cur.current[0], Math.max(q, cur.current[0])];
    if (next[0] !== cur.current[0] || next[1] !== cur.current[1]) {
      cur.current = next;
      L.current.onChange?.(next);
    }
    return next;
  };
  const valueAtX = (x: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return L.current.min + clamp((x - r.left) / (r.width || 1), 0, 1) * (L.current.max - L.current.min);
  };
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (locked || e.button !== 0 || !trackRef.current) return;
    e.preventDefault();
    const v = valueAtX(e.clientX);
    const which: 0 | 1 =
      Math.abs(v - cur.current[0]) <= Math.abs(v - cur.current[1]) ? (v > cur.current[1] ? 1 : 0) : 1;
    const startVal: [number, number] = [cur.current[0], cur.current[1]];
    let changed = false;
    const apply = (x: number) => {
      const before = cur.current;
      set(which, valueAtX(x));
      if (before !== cur.current) changed = true;
    };
    setActive(which);
    apply(e.clientX);
    beginDrag(
      {
        clientX: e.clientX,
        clientY: e.clientY,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        target: e.currentTarget,
      },
      {
        onMove: (p) => apply(p.clientX),
        onEnd: ({ cancelled }) => {
          setActive(null);
          if (cancelled) {
            cur.current = startVal;
            L.current.onChange?.(startVal);
            L.current.onCancel?.();
          } else if (changed) L.current.onCommit?.(cur.current);
        },
      },
    );
  };
  const keyFor = (i: 0 | 1) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    const mult = modMultiplier({ shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey });
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    onCommit?.(set(i, safeAdd(cur.current[i], dir * step * mult)));
  };
  const modified = defaultValue !== undefined && (defaultValue[0] !== value[0] || defaultValue[1] !== value[1]);
  const { ref: rootRef, props: ctxProps } = useBridge({
    kind: "range",
    copyText: () => `${formatFixed(value[0], prec)}, ${formatFixed(value[1], prec)}`,
    copyJson: () => JSON.stringify(value),
    reset: defaultValue
      ? () => {
          onChange?.(defaultValue);
          onCommit?.(defaultValue);
        }
      : undefined,
    canReset: () => modified,
    disabled,
    readOnly,
  });
  return (
    <div
      ref={rootRef}
      {...ctxProps}
      data-kk="range-slider"
      data-no-pan=""
      data-density={density}
      className={cx("kk-slider kk-rangeslider", locked && "is-disabled", mixed && "is-mixed", className)}
      title={tooltip}
      aria-label={typeof label === "string" ? label : undefined}
    >
      <NumberField
        value={value[0]}
        min={min}
        max={value[1]}
        step={step}
        precision={precision}
        density="compact"
        className="kk-numfield--bare kk-slider__field"
        hideInlineLabel
        aria-label="Minimum"
        disabled={disabled}
        readOnly={readOnly}
        onChange={(v) => set(0, v)}
        onCommit={(v) => onCommit?.([v, cur.current[1]])}
      />
      <div className="kk-slider__control" onPointerDown={onDown}>
        <div ref={trackRef} className="kk-slider__track">
          <div
            className="kk-slider__fill kk-slider__fill--range"
            style={{ left: `${pos(value[0])}%`, width: `${pos(value[1]) - pos(value[0])}%` }}
          />
          {([0, 1] as const).map((i) => (
            <div
              key={i}
              role="slider"
              tabIndex={locked ? -1 : 0}
              aria-label={i === 0 ? "Minimum" : "Maximum"}
              aria-valuemin={min}
              aria-valuemax={max}
              aria-valuenow={value[i]}
              className={cx("kk-slider__thumb", active === i && "is-active")}
              style={{ left: `${pos(value[i])}%` }}
              onKeyDown={keyFor(i)}
            />
          ))}
        </div>
      </div>
      <NumberField
        value={value[1]}
        min={value[0]}
        max={max}
        step={step}
        precision={precision}
        density="compact"
        className="kk-numfield--bare kk-slider__field"
        hideInlineLabel
        aria-label="Maximum"
        disabled={disabled}
        readOnly={readOnly}
        onChange={(v) => set(1, v)}
        onCommit={(v) => onCommit?.([cur.current[0], v])}
      />
    </div>
  );
}
