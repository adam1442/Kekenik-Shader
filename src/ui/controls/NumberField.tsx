import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { parseExpression } from "@/core/values/expr";
import {
  clamp,
  clampRange,
  defaultPrecision,
  formatFixed,
  formatHex,
  limitsOf,
  parseHexInt,
  roundTo,
  scrubStep,
  stepValue,
  type NumRange,
} from "@/core/values/numeric";
import { cx } from "../util/cx";
import { copyText } from "./clipboard";
import { useBridge } from "./bridge";
import { beginDrag } from "./useDrag";
import type { ControlProps } from "./types";

export interface NumberFieldProps extends ControlProps<number>, NumRange {
  /** Step for arrows / wheel and default scrub quantum. */
  step?: number;
  /** Displayed decimals (default: from step). Trailing zeros are trimmed unless `fixed`. */
  precision?: number;
  fixed?: boolean;
  /** Value units per pixel of drag at ×1 (default = step). */
  scrubSpeed?: number;
  /** Unit suffix ("°", "px", "s", "%"). */
  unit?: string;
  /** Angle unit for `45deg` / `1rad` expression suffixes. */
  angleUnit?: "deg" | "rad";
  /** Integer mode (rounding, no decimals). */
  integer?: boolean;
  /** Show the integer as hex (IntField only). */
  hex?: boolean;
  /** Show ▲▼ stepper arrows. */
  stepper?: boolean;
  /** Mouse wheel changes the value while this modifier is held (default "ctrl"; "none" disables). */
  wheel?: "ctrl" | "shift" | "alt" | "none";
  /** A plain click opens the text editor (slider-reveals-field mode). */
  clickToEdit?: boolean;
  /** Hide the label inside the field (when an outer ControlField shows it). */
  hideInlineLabel?: boolean;
}

const WHEEL_COMMIT_MS = 350;

/**
 * Blender-style number field: drag-scrub (field or label; Shift fine, Ctrl/Cmd coarse, Alt snap; Pointer Lock when available),
 * double-click / Enter to type (expressions, Persian digits), arrows, modifier+wheel, soft/hard ranges, mixed/invalid states.
 */
export function NumberField(props: NumberFieldProps) {
  const {
    value,
    onChange,
    onCommit,
    onCancel,
    step = props.integer ? 1 : 0.01,
    label,
    unit,
    disabled,
    readOnly,
    mixed,
    invalid,
    message,
    density = "regular",
    defaultValue,
    className,
    integer,
    hex,
    stepper,
    fixed,
    tooltip,
    wheel = "ctrl",
    angleUnit,
    hideInlineLabel,
  } = props;
  const precision = integer ? 0 : (props.precision ?? defaultPrecision(step));
  const perPx = props.scrubSpeed ?? step;
  const range: NumRange = { min: props.min, max: props.max, softMin: props.softMin, softMax: props.softMax };

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [scrubbing, setScrubbing] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const L = useRef({ ...props, step, precision, perPx, range, integer });
  L.current = { ...props, step, precision, perPx, range, integer };
  const cur = useRef(value); // latest emitted/known value
  cur.current = value;
  const inputRef = useRef<HTMLInputElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const cancelled = useRef(false);
  const wheelTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gestureStart = useRef<number | null>(null);
  const finished = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);
  useEffect(
    () => () => {
      if (wheelTimer.current) clearTimeout(wheelTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const fmt = (v: number) => (hex && integer ? formatHex(v) : formatFixed(v, precision, !fixed));
  const locked = disabled || readOnly;

  /** Emit a live value (deduped). Returns the emitted value. */
  const emit = (v: number): number => {
    const l = L.current;
    const q = l.integer ? Math.round(v) : roundTo(v, l.precision);
    if (q !== cur.current || l.mixed) {
      cur.current = q;
      l.onChange?.(q);
    }
    return q;
  };

  const flashInvalid = (msg: string) => {
    setFlash(msg);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  };

  const startEdit = () => {
    if (locked) return;
    cancelled.current = false;
    finished.current = false;
    setDraft(mixed ? "" : fmt(value));
    setEditing(true);
  };

  const parseTyped = (text: string): number | null => {
    const t = text.trim();
    if (hex && integer) {
      const h = parseHexInt(t);
      if (h !== null) return h;
    }
    const r = parseExpression(t, { unit, angleUnit });
    if (!r.ok) {
      flashInvalid(r.error);
      return null;
    }
    return r.value;
  };

  const commitTyped = () => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (cancelled.current) return;
    if (draft.trim() === "") return;
    const n = parseTyped(draft);
    if (n === null) return;
    const before = cur.current;
    const q = emit(clampRange(n, range, "hard"));
    if (q !== before || mixed) L.current.onCommit?.(q);
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (locked || editing || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[data-stepper]")) return;
    const startVal = cur.current;
    let raw = startVal;
    let changed = false;
    gestureStart.current = startVal;
    beginDrag(
      {
        clientX: e.clientX,
        clientY: e.clientY,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        isTrusted: e.nativeEvent.isTrusted,
        target: e.currentTarget,
      },
      {
        threshold: 3,
        lockElement: displayRef.current,
        bodyClass: "kk-scrubbing",
        onStart: () => setScrubbing(true),
        onMove: (p) => {
          const l = L.current;
          const r = scrubStep(
            raw,
            p.dx,
            { ...l.range, perPx: l.perPx, step: l.step, precision: l.precision, integer: l.integer },
            { shift: p.event.shiftKey, ctrl: p.event.ctrlKey, meta: p.event.metaKey, alt: p.event.altKey },
          );
          raw = r.raw;
          const before = cur.current;
          emit(r.value);
          if (cur.current !== before) changed = true;
        },
        onEnd: ({ active, cancelled: wasCancelled }) => {
          setScrubbing(false);
          if (!active) {
            if (!wasCancelled) {
              if (L.current.clickToEdit) startEdit();
              else displayRef.current?.focus();
            }
            return;
          }
          if (wasCancelled) {
            cur.current = startVal;
            L.current.onChange?.(startVal);
            L.current.onCancel?.();
            return;
          }
          if (changed) L.current.onCommit?.(cur.current);
        },
      },
    );
  };

  const stepBy = (dir: 1 | -1, mods: { shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean }) => {
    const base = mixed ? (Number.isFinite(value) ? value : 0) : cur.current;
    const next = stepValue(base, dir, step, mods, range, integer);
    const q = emit(next);
    return q;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || locked) return;
    const mods = { shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey };
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      startEdit();
    } else if (e.key === "ArrowUp" || e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      const q = stepBy(e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : -1, mods);
      onCommit?.(q);
    } else if (e.key === "Escape" && gestureStart.current !== null) {
      gestureStart.current = null;
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (locked || editing || wheel === "none") return;
    const ok = wheel === "ctrl" ? e.ctrlKey || e.metaKey : wheel === "shift" ? e.shiftKey : e.altKey;
    if (!ok || document.activeElement !== displayRef.current) return;
    e.preventDefault();
    stepBy(e.deltaY < 0 ? 1 : -1, { shift: wheel !== "shift" && e.shiftKey });
    if (wheelTimer.current) clearTimeout(wheelTimer.current);
    wheelTimer.current = setTimeout(() => L.current.onCommit?.(cur.current), WHEEL_COMMIT_MS);
  };

  const reset = () => {
    if (defaultValue === undefined) return;
    cur.current = defaultValue;
    onChange?.(defaultValue);
    onCommit?.(defaultValue);
  };
  const modified = defaultValue !== undefined && (mixed || defaultValue !== value);
  const { ref: rootRef, props: ctxProps } = useBridge({
    kind: integer ? "int" : "number",
    copyText: () => fmt(value),
    copyJson: () => JSON.stringify(value),
    paste: (t) => {
      const r = parseExpression(t, { unit, angleUnit });
      if (!r.ok || locked) return false;
      const q = emit(clampRange(r.value, range, "hard"));
      onCommit?.(q);
      return true;
    },
    reset: defaultValue !== undefined ? reset : undefined,
    canReset: () => modified,
    disabled,
    readOnly,
  });

  const { lo, hi } = limitsOf(range, "soft");
  const hasRange = Number.isFinite(lo) && Number.isFinite(hi) && hi > lo;
  const pct = hasRange ? clamp(((value - lo) / (hi - lo)) * 100, 0, 100) : 0;
  const shown = mixed ? "\u2014" : fmt(value);
  const bad = invalid || flash !== null;
  const note = flash ?? message;
  const showInlineLabel = label && !hideInlineLabel;

  return (
    <div
      ref={rootRef}
      {...ctxProps}
      data-kk="number-field"
      data-no-pan=""
      data-density={density}
      className={cx(
        "kk-numfield",
        `kk-numfield--${density}`,
        scrubbing && "is-scrubbing",
        editing && "is-editing",
        locked && "is-disabled",
        readOnly && "is-readonly",
        mixed && "is-mixed",
        bad && "is-invalid",
        modified && "is-modified",
        className,
      )}
      title={bad ? note : tooltip}
      onWheel={onWheel}
    >
      {editing ? (
        <input
          ref={inputRef}
          className="kk-numfield__input"
          value={draft}
          inputMode="decimal"
          dir="ltr"
          spellCheck={false}
          autoComplete="off"
          aria-label={props["aria-label"] ?? (typeof label === "string" ? label : undefined)}
          aria-invalid={bad || undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitTyped}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitTyped();
              displayRef.current?.focus();
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancelled.current = true;
              finished.current = true;
              setEditing(false);
              onCancel?.();
            } else if (e.key === "Tab") {
              commitTyped();
            }
          }}
        />
      ) : (
        <div
          ref={displayRef}
          className="kk-numfield__display"
          role="spinbutton"
          tabIndex={locked ? -1 : 0}
          aria-valuenow={mixed ? undefined : value}
          aria-valuetext={mixed ? "mixed" : unit ? `${shown} ${unit}` : shown}
          aria-valuemin={Number.isFinite(props.min ?? NaN) ? props.min : hasRange ? lo : undefined}
          aria-valuemax={Number.isFinite(props.max ?? NaN) ? props.max : hasRange ? hi : undefined}
          aria-label={props["aria-label"] ?? (typeof label === "string" ? label : undefined)}
          aria-disabled={disabled || undefined}
          aria-readonly={readOnly || undefined}
          aria-invalid={bad || undefined}
          onPointerDown={onPointerDown}
          onDoubleClick={startEdit}
          onKeyDown={onKeyDown}
          onCopy={(e) => {
            e.preventDefault();
            void copyText(fmt(value));
          }}
        >
          {hasRange && !mixed && <span className="kk-numfield__fill" style={{ width: `${pct}%` }} />}
          {showInlineLabel && <span className="kk-numfield__label">{label}</span>}
          <span className="kk-numfield__value">
            {shown}
            {unit && !mixed && <span className="kk-numfield__unit">{unit}</span>}
          </span>
        </div>
      )}
      {stepper && !editing && (
        <span className="kk-numfield__steppers" data-stepper="">
          <button
            type="button"
            tabIndex={-1}
            aria-label="Increase"
            disabled={locked}
            onClick={(e) =>
              onCommit?.(stepBy(1, { shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey }))
            }
          >
            <ChevronUp size={10} />
          </button>
          <button
            type="button"
            tabIndex={-1}
            aria-label="Decrease"
            disabled={locked}
            onClick={(e) =>
              onCommit?.(stepBy(-1, { shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey }))
            }
          >
            <ChevronDown size={10} />
          </button>
        </span>
      )}
    </div>
  );
}

/** Integer field: same behaviours with integer rounding and optional hex display. */
export function IntField(props: Omit<NumberFieldProps, "integer">) {
  return <NumberField {...props} integer step={props.step ?? 1} />;
}

/** Legacy 1a export: formats with trimmed zeros; non-finite → "0". */
export function formatNumber(v: number, precision: number): string {
  return Number.isFinite(v) ? formatFixed(v, precision) : "0";
}
