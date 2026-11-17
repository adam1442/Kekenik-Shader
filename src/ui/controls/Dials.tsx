import { useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import { clamp, deg2rad, formatFixed, rad2deg, roundTo, snapToStep, wrapAngle } from "@/core/values/numeric";
import { parseVecText } from "@/core/values/vec";
import { cx } from "../util/cx";
import { useBridge } from "./bridge";
import { NumberField } from "./NumberField";
import { VecField } from "./VecField";
import { beginDrag } from "./useDrag";
import type { ControlProps } from "./types";

/** Shared gesture: pointer-down + drag with start/commit/cancel semantics for pad-like controls. */
function usePad<T>(
  cur: React.MutableRefObject<T>,
  apply: (x: number, y: number, e: { shift: boolean; alt: boolean }) => void,
  h: { onChange?: (v: T) => void; onCommit?: (v: T) => void; onCancel?: () => void },
  locked: boolean | undefined,
) {
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: RPointerEvent<HTMLElement>) => {
    if (locked || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus();
    const start = cur.current;
    apply(e.clientX, e.clientY, { shift: e.shiftKey, alt: e.altKey });
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
        onMove: (p) => apply(p.clientX, p.clientY, { shift: p.event.shiftKey, alt: p.event.altKey }),
        onEnd: ({ cancelled }) => {
          setDragging(false);
          if (cancelled) {
            cur.current = start;
            h.onChange?.(start);
            h.onCancel?.();
          } else h.onCommit?.(cur.current);
        },
      },
    );
  };
  return { dragging, onPointerDown };
}

/* ── AngleDial ───────────────────────────────────────────────────────── */
interface AngleDialProps extends ControlProps<number> {
  /** Value unit (default degrees). */
  unit?: "deg" | "rad";
  /** Wrap into [0, 360) (default) or clamp to min/max. */
  wrap?: boolean;
  min?: number;
  max?: number;
  /** Snap increment (deg) when Shift is held while dragging (default 15). */
  snap?: number;
}

/** Circular angle control (0° = right, counter-clockwise like math) + fused numeric field. */
export function AngleDial(props: AngleDialProps) {
  const {
    value,
    onChange,
    onCommit,
    disabled,
    readOnly,
    unit = "deg",
    wrap: doWrap = true,
    density = "regular",
    className,
    label,
    tooltip,
    defaultValue,
    mixed,
    snap = 15,
  } = props;
  const isDeg = unit === "deg";
  const period = isDeg ? 360 : Math.PI * 2;
  const ref = useRef<HTMLDivElement>(null);
  const cur = useRef(value);
  cur.current = value;
  const locked = disabled || readOnly;
  const norm = (v: number) => (doWrap ? wrapAngle(v, period) : clamp(v, props.min ?? -Infinity, props.max ?? Infinity));
  const emit = (v: number) => {
    const q = roundTo(norm(v), isDeg ? 2 : 4);
    if (q !== cur.current) {
      cur.current = q;
      onChange?.(q);
    }
  };
  const { dragging, onPointerDown } = usePad(
    cur,
    (x, y, m) => {
      const r = ref.current!.getBoundingClientRect();
      let a = Math.atan2(-(y - (r.top + r.height / 2)), x - (r.left + r.width / 2));
      let d = rad2deg(a);
      if (m.shift) d = snapToStep(d, snap);
      a = deg2rad(d);
      emit(isDeg ? d : a);
    },
    { onChange, onCommit, onCancel: props.onCancel },
    locked,
  );
  const deg = isDeg ? value : rad2deg(value);
  const onKey = (e: KeyboardEvent) => {
    if (locked) return;
    const s = (isDeg ? 1 : deg2rad(1)) * (e.shiftKey ? 15 : e.ctrlKey ? 45 : 1);
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    emit(cur.current + dir * s);
    onCommit?.(cur.current);
  };
  const modified = defaultValue !== undefined && defaultValue !== value;
  const { ref: rootRef, props: ctxProps } = useBridge({
    kind: "angle",
    copyText: () => formatFixed(value, 3),
    copyJson: () => JSON.stringify(value),
    paste: (t) => {
      const n = Number(t);
      if (!Number.isFinite(n) || locked) return false;
      emit(n);
      onCommit?.(cur.current);
      return true;
    },
    reset:
      defaultValue !== undefined
        ? () => {
            onChange?.(defaultValue);
            onCommit?.(defaultValue);
          }
        : undefined,
    canReset: () => modified,
    disabled,
    readOnly,
  });
  const rad = deg2rad(deg);
  return (
    <div
      ref={rootRef}
      {...ctxProps}
      data-kk="angle-dial"
      data-no-pan=""
      className={cx(
        "kk-angle",
        `kk-angle--${density}`,
        locked && "is-disabled",
        dragging && "is-dragging",
        mixed && "is-mixed",
        className,
      )}
      title={tooltip}
    >
      <div
        ref={ref}
        className="kk-angle__dial"
        role="slider"
        tabIndex={locked ? -1 : 0}
        aria-label={props["aria-label"] ?? (typeof label === "string" ? label : "Angle")}
        aria-valuenow={value}
        aria-valuemin={props.min ?? 0}
        aria-valuemax={props.max ?? period}
        onPointerDown={onPointerDown}
        onKeyDown={onKey}
      >
        <svg viewBox="-20 -20 40 40" width="100%" height="100%" aria-hidden="true">
          <circle r="17" className="kk-angle__ring" />
          {Array.from({ length: 12 }, (_, i) => (
            <line
              key={i}
              x1={14.5 * Math.cos((i * Math.PI) / 6)}
              y1={-14.5 * Math.sin((i * Math.PI) / 6)}
              x2={17 * Math.cos((i * Math.PI) / 6)}
              y2={-17 * Math.sin((i * Math.PI) / 6)}
              className="kk-angle__tick"
            />
          ))}
          {!mixed && (
            <>
              <line x1="0" y1="0" x2={15 * Math.cos(rad)} y2={-15 * Math.sin(rad)} className="kk-angle__hand" />
              <circle cx={15 * Math.cos(rad)} cy={-15 * Math.sin(rad)} r="3" className="kk-angle__knob" />
            </>
          )}
          <circle r="1.6" className="kk-angle__hub" />
        </svg>
      </div>
      <NumberField
        value={value}
        unit={isDeg ? "°" : " rad"}
        angleUnit={unit}
        step={isDeg ? 1 : 0.01}
        precision={isDeg ? 2 : 4}
        density="compact"
        mixed={mixed}
        disabled={disabled}
        readOnly={readOnly}
        aria-label="Angle value"
        onChange={(v) => emit(v)}
        onCommit={(v) => onCommit?.(norm(v))}
        hideInlineLabel
      />
    </div>
  );
}

/* ── XYPad ───────────────────────────────────────────────────────────── */
interface XYPadProps extends ControlProps<[number, number]> {
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  /** Grid divisions per axis (draws the grid; Alt snaps to it). */
  grid?: number;
  /** Show numeric X/Y fields below. */
  fields?: boolean;
  labels?: [string, string];
  size?: number;
}

/** 2-D pad for UV offsets, directions, 2-D parameters. Y grows upward. Shift = fine (10×), Alt = snap to grid. */
export function XYPad(props: XYPadProps) {
  const {
    value,
    onChange,
    onCommit,
    xMin = 0,
    xMax = 1,
    yMin = 0,
    yMax = 1,
    grid = 4,
    fields = true,
    labels = ["X", "Y"],
    disabled,
    readOnly,
    density = "regular",
    className,
    label,
    tooltip,
    defaultValue,
    mixed,
    size = 120,
  } = props;
  const ref = useRef<HTMLDivElement>(null);
  const cur = useRef(value);
  cur.current = value;
  const locked = disabled || readOnly;
  const set = (x: number, y: number) => {
    const next: [number, number] = [roundTo(clamp(x, xMin, xMax), 4), roundTo(clamp(y, yMin, yMax), 4)];
    if (next[0] !== cur.current[0] || next[1] !== cur.current[1]) {
      cur.current = next;
      onChange?.(next);
    }
  };
  const { dragging, onPointerDown } = usePad(
    cur,
    (cx_, cy_, m) => {
      const r = ref.current!.getBoundingClientRect();
      let u = clamp((cx_ - r.left) / (r.width || 1), 0, 1);
      let v = clamp(1 - (cy_ - r.top) / (r.height || 1), 0, 1);
      let x = xMin + u * (xMax - xMin);
      let y = yMin + v * (yMax - yMin);
      if (m.alt && grid > 0) {
        x = snapToStep(x, (xMax - xMin) / grid, xMin);
        y = snapToStep(y, (yMax - yMin) / grid, yMin);
      }
      if (m.shift) {
        x = cur.current[0] + (x - cur.current[0]) * 0.1;
        y = cur.current[1] + (y - cur.current[1]) * 0.1;
      }
      set(x, y);
    },
    { onChange, onCommit, onCancel: props.onCancel },
    locked,
  );
  const onKey = (e: KeyboardEvent) => {
    if (locked) return;
    const sx = ((xMax - xMin) / 100) * (e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1);
    const sy = ((yMax - yMin) / 100) * (e.shiftKey ? 0.1 : e.ctrlKey ? 10 : 1);
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-sx, 0],
      ArrowRight: [sx, 0],
      ArrowUp: [0, sy],
      ArrowDown: [0, -sy],
    };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    set(cur.current[0] + m[0], cur.current[1] + m[1]);
    onCommit?.(cur.current);
  };
  const modified = defaultValue !== undefined && (defaultValue[0] !== value[0] || defaultValue[1] !== value[1]);
  const { ref: rootRef, props: ctxProps } = useBridge({
    kind: "xypad",
    copyText: () => `${value[0]}, ${value[1]}`,
    copyJson: () => JSON.stringify({ x: value[0], y: value[1] }),
    paste: (t) => {
      const v = parseVecText(t, 2);
      if (!v || locked) return false;
      set(v[0]!, v[1]!);
      onCommit?.(cur.current);
      return true;
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
  });
  const px = ((value[0] - xMin) / (xMax - xMin || 1)) * 100;
  const py = (1 - (value[1] - yMin) / (yMax - yMin || 1)) * 100;
  return (
    <div
      ref={rootRef}
      {...ctxProps}
      data-kk="xy-pad"
      data-no-pan=""
      className={cx(
        "kk-xy",
        `kk-xy--${density}`,
        locked && "is-disabled",
        dragging && "is-dragging",
        mixed && "is-mixed",
        className,
      )}
      title={tooltip}
    >
      <div
        ref={ref}
        className="kk-xy__pad"
        role="application"
        tabIndex={locked ? -1 : 0}
        aria-label={props["aria-label"] ?? (typeof label === "string" ? label : "XY pad")}
        aria-valuetext={`${labels[0]} ${value[0]}, ${labels[1]} ${value[1]}`}
        style={{ width: size, height: size, ["--kk-grid" as string]: grid }}
        onPointerDown={onPointerDown}
        onKeyDown={onKey}
      >
        <div className="kk-xy__grid" style={{ backgroundSize: `${100 / grid}% ${100 / grid}%` }} />
        {!mixed && (
          <>
            <div className="kk-xy__hline" style={{ top: `${py}%` }} />
            <div className="kk-xy__vline" style={{ left: `${px}%` }} />
            <div className="kk-xy__puck" style={{ left: `${px}%`, top: `${py}%` }} />
          </>
        )}
      </div>
      {fields && (
        <div className="kk-xy__fields">
          <NumberField
            value={value[0]}
            label={labels[0]}
            min={xMin}
            max={xMax}
            step={(xMax - xMin) / 100}
            precision={3}
            density="compact"
            mixed={mixed}
            disabled={disabled}
            readOnly={readOnly}
            onChange={(v) => set(v, cur.current[1])}
            onCommit={() => onCommit?.(cur.current)}
          />
          <NumberField
            value={value[1]}
            label={labels[1]}
            min={yMin}
            max={yMax}
            step={(yMax - yMin) / 100}
            precision={3}
            density="compact"
            mixed={mixed}
            disabled={disabled}
            readOnly={readOnly}
            onChange={(v) => set(cur.current[0], v)}
            onCommit={() => onCommit?.(cur.current)}
          />
        </div>
      )}
    </div>
  );
}

/* ── DirectionPicker ─────────────────────────────────────────────────── */
interface DirectionPickerProps extends ControlProps<[number, number, number]> {
  size?: number;
}

const norm3 = (v: number[]): [number, number, number] => {
  const l = Math.hypot(v[0]!, v[1]!, v[2]!);
  return l > 1e-9 ? [v[0]! / l, v[1]! / l, v[2]! / l] : [0, 0, 1];
};

/** Unit-vector picker on a shaded sphere (light / normal directions). Drag the puck; Alt-click or the ⟲ button flips front/back. */
export function DirectionPicker(props: DirectionPickerProps) {
  const {
    value,
    onChange,
    onCommit,
    disabled,
    readOnly,
    density = "regular",
    className,
    label,
    tooltip,
    defaultValue,
    mixed,
    size = 96,
  } = props;
  const ref = useRef<HTMLDivElement>(null);
  const cur = useRef(value);
  cur.current = value;
  const locked = disabled || readOnly;
  const set = (v: [number, number, number]) => {
    const n = norm3(v).map((x) => roundTo(x, 4)) as [number, number, number];
    if (n.some((x, i) => x !== cur.current[i])) {
      cur.current = n;
      onChange?.(n);
    }
  };
  const { dragging, onPointerDown } = usePad(
    cur,
    (cx_, cy_, m) => {
      const r = ref.current!.getBoundingClientRect();
      let x = ((cx_ - r.left) / (r.width || 1)) * 2 - 1;
      let y = -(((cy_ - r.top) / (r.height || 1)) * 2 - 1);
      const len = Math.hypot(x, y);
      if (len > 1) {
        x /= len;
        y /= len;
      }
      const back = m.alt ? cur.current[2] >= 0 : cur.current[2] < 0;
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y)) * (back ? -1 : 1);
      set([x, y, z]);
    },
    { onChange, onCommit, onCancel: props.onCancel },
    locked,
  );
  const modified = defaultValue !== undefined && defaultValue.some((d, i) => d !== value[i]);
  const { ref: rootRef, props: ctxProps } = useBridge({
    kind: "direction",
    copyText: () => value.map((x) => roundTo(x, 4)).join(", "),
    copyJson: () => JSON.stringify({ x: value[0], y: value[1], z: value[2] }),
    paste: (t) => {
      const v = parseVecText(t, 3);
      if (!v || locked) return false;
      set(v as [number, number, number]);
      onCommit?.(cur.current);
      return true;
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
    extra: () => [
      {
        label: "Flip direction",
        run: () => {
          set([-value[0], -value[1], -value[2]]);
          onCommit?.(cur.current);
        },
      },
    ],
  });
  const back = value[2] < 0;
  return (
    <div
      ref={rootRef}
      {...ctxProps}
      data-kk="direction-picker"
      data-no-pan=""
      className={cx(
        "kk-dir",
        `kk-dir--${density}`,
        locked && "is-disabled",
        dragging && "is-dragging",
        mixed && "is-mixed",
        className,
      )}
      title={tooltip}
    >
      <div
        ref={ref}
        className={cx("kk-dir__sphere", back && "is-back")}
        role="application"
        tabIndex={locked ? -1 : 0}
        aria-label={props["aria-label"] ?? (typeof label === "string" ? label : "Direction")}
        aria-valuetext={value.map((x) => roundTo(x, 2)).join(", ")}
        style={{ width: size, height: size }}
        onPointerDown={onPointerDown}
        onKeyDown={(e) => {
          if (locked) return;
          const s = 0.05 * (e.shiftKey ? 0.2 : 1);
          const d: Record<string, [number, number]> = {
            ArrowLeft: [-s, 0],
            ArrowRight: [s, 0],
            ArrowUp: [0, s],
            ArrowDown: [0, -s],
          };
          const m = d[e.key];
          if (!m) return;
          e.preventDefault();
          set([value[0] + m[0], value[1] + m[1], value[2]]);
          onCommit?.(cur.current);
        }}
      >
        {!mixed && (
          <div
            className={cx("kk-dir__puck", back && "is-back")}
            style={{ left: `${(value[0] * 0.5 + 0.5) * 100}%`, top: `${(0.5 - value[1] * 0.5) * 100}%` }}
          />
        )}
      </div>
      <div className="kk-dir__side">
        <VecField
          value={value}
          dim={3}
          step={0.01}
          precision={3}
          density="compact"
          normalize
          disabled={disabled}
          readOnly={readOnly}
          mixed={mixed ? [true, true, true] : undefined}
          onChange={(v) => {
            const n = v as [number, number, number];
            cur.current = n;
            onChange?.(n);
          }}
          onCommit={(v) => {
            set(v as [number, number, number]);
            onCommit?.(cur.current);
          }}
        />
        <button
          type="button"
          className="kk-dir__flip"
          disabled={locked}
          onClick={() => {
            set([value[0], value[1], -value[2]]);
            onCommit?.(cur.current);
          }}
          title="Flip front/back hemisphere"
        >
          {back ? "Back" : "Front"}
        </button>
      </div>
    </div>
  );
}
