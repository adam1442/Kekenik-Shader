import {
  ArrowLeftRight,
  ClipboardPaste,
  Copy,
  FlipHorizontal2,
  Palette,
  StretchHorizontal,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import {
  bakeLUT,
  addAlphaStop,
  addColorStop,
  distributeEvenly,
  flipAlpha,
  flipColors,
  moveAlphaStop,
  moveColorStop,
  parseGradient,
  removeAlphaStop,
  removeColorStop,
  reverseGradient,
  serializeGradient,
  setAlphaStopValue,
  setColorStopColor,
  DEFAULT_MAX_STOPS,
  type Gradient,
  type GradientMode,
} from "@/core/values/gradient";
import { GRADIENT_PRESETS } from "@/core/values/gradientPresets";
import { linearToSrgb, toCssColor } from "@/core/values/color";
import { clamp } from "@/core/values/numeric";
import { cx } from "../util/cx";
import { copyText, pasteText } from "./clipboard";
import { useBridge } from "./bridge";
import { ColorField } from "./ColorField";
import { NumberField } from "./NumberField";
import { Popover } from "./Popover";
import { SegmentedControl } from "./Segmented";
import { beginDrag } from "./useDrag";
import type { ControlProps } from "./types";

/** Draws a gradient exactly (hard edges included) from its baked LUT. HiDPI aware; redraws imperatively. */
function GradientCanvas({ value, className }: { value: Gradient; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      const w = Math.max(2, Math.round(c.clientWidth * (window.devicePixelRatio || 1)));
      if (c.width !== w) c.width = w;
      c.height = 1;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const lut = bakeLUT(value, w);
      const img = ctx.createImageData(w, 1);
      for (let i = 0; i < w; i++) {
        const r = linearToSrgb(clamp(lut[i * 4]!, 0, 1));
        const g = linearToSrgb(clamp(lut[i * 4 + 1]!, 0, 1));
        const b = linearToSrgb(clamp(lut[i * 4 + 2]!, 0, 1));
        img.data.set([r * 255, g * 255, b * 255, lut[i * 4 + 3]! * 255], i * 4);
      }
      ctx.putImageData(img, 0, 0);
    };
    draw();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(draw) : null;
    ro?.observe(c);
    return () => ro?.disconnect();
  }, [value]);
  return <canvas ref={ref} className={cx("kk-gradcanvas", className)} aria-hidden="true" />;
}

type Sel = { kind: "color" | "alpha"; index: number };
interface GradientEditorProps extends Omit<ControlProps<Gradient>, "label"> {
  maxStops?: number;
}

const MODES: Array<{ value: GradientMode; label: string; title: string }> = [
  { value: "linear", label: "Linear", title: "Linear interpolation" },
  { value: "smooth", label: "Smooth", title: "Eased (smoothstep) interpolation" },
  { value: "constant", label: "Step", title: "Constant / stepped" },
];
const REMOVE_DISTANCE = 36;

/** Unity-style gradient editor: alpha stops above the bar, colour stops below; drag, add, remove, modes, presets. */
function GradientEditor(props: GradientEditorProps) {
  const {
    value,
    onChange,
    onCommit,
    onCancel,
    maxStops = DEFAULT_MAX_STOPS,
    disabled,
    readOnly,
    className,
    defaultValue,
    tooltip,
  } = props;
  const locked = disabled || readOnly;
  const [sel, setSel] = useState<Sel>({ kind: "color", index: 0 });
  const [pending, setPending] = useState<Sel | null>(null);
  const [presets, setPresets] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const presetBtn = useRef<HTMLButtonElement>(null);
  const cur = useRef(value);
  cur.current = value;

  const live = (g: Gradient) => {
    cur.current = g;
    onChange?.(g);
  };
  const done = (g: Gradient) => {
    live(g);
    onCommit?.(g);
  };
  const posAt = (x: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return clamp((x - r.left) / (r.width || 1), 0, 1);
  };

  const dragStop = (e: RPointerEvent, s: Sel) => {
    if (locked || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).focus();
    setSel(s);
    const start = cur.current;
    let g = start;
    let index = s.index;
    let changed = false;
    let away = false;
    beginDrag(
      {
        clientX: e.clientX,
        clientY: e.clientY,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        target: e.currentTarget,
      },
      {
        threshold: 2,
        onMove: (p) => {
          const r = barRef.current!.getBoundingClientRect();
          const outside = s.kind === "color" ? p.clientY - r.bottom : r.top - p.clientY;
          away =
            outside > REMOVE_DISTANCE && (s.kind === "color" ? start.colorStops.length : start.alphaStops.length) > 1;
          setPending(away ? { ...s, index } : null);
          if (away) return;
          const t = posAt(p.clientX);
          const res = s.kind === "color" ? moveColorStop(g, index, t) : moveAlphaStop(g, index, t);
          g = res.gradient;
          index = res.index;
          changed = true;
          setSel({ kind: s.kind, index });
          live(g);
        },
        onEnd: ({ active, cancelled }) => {
          setPending(null);
          if (!active) return;
          if (cancelled) {
            live(start);
            onCancel?.();
            setSel(s);
            return;
          }
          if (away) {
            const removed = s.kind === "color" ? removeColorStop(g, index) : removeAlphaStop(g, index);
            done(removed);
            setSel({ kind: s.kind, index: 0 });
          } else if (changed) onCommit?.(cur.current);
        },
      },
    );
  };

  const addAt = (e: RPointerEvent, kind: "color" | "alpha") => {
    if (locked || e.button !== 0) return;
    const t = posAt(e.clientX);
    const res =
      kind === "color" ? addColorStop(value, t, undefined, maxStops) : addAlphaStop(value, t, undefined, maxStops);
    if (!res) return;
    done(res.gradient);
    setSel({ kind, index: res.index });
    // let the user keep dragging the new stop immediately
    queueMicrotask(() => undefined);
  };

  const remove = (s: Sel) => {
    const g = s.kind === "color" ? removeColorStop(value, s.index) : removeAlphaStop(value, s.index);
    if (g !== value) done(g);
    setSel({ kind: s.kind, index: Math.max(0, s.index - 1) });
  };

  const stopKey = (s: Sel) => (e: KeyboardEvent) => {
    if (locked) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(s);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const d = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 0.001 : 0.01);
      const pos = (s.kind === "color" ? value.colorStops[s.index]!.pos : value.alphaStops[s.index]!.pos) + d;
      const res = s.kind === "color" ? moveColorStop(value, s.index, pos) : moveAlphaStop(value, s.index, pos);
      done(res.gradient);
      setSel({ kind: s.kind, index: res.index });
    }
  };

  const colorStops = value.colorStops;
  const alphaStops = value.alphaStops;
  const si =
    sel.kind === "color" ? Math.min(sel.index, colorStops.length - 1) : Math.min(sel.index, alphaStops.length - 1);
  const selColor = sel.kind === "color" ? colorStops[si] : undefined;
  const selAlpha = sel.kind === "alpha" ? alphaStops[si] : undefined;
  const equalsDefault =
    defaultValue !== undefined &&
    JSON.stringify(serializeGradient(defaultValue)) === JSON.stringify(serializeGradient(value));
  const { ref, props: ctxProps } = useBridge({
    kind: "gradient",
    copyText: () => JSON.stringify(serializeGradient(value)),
    copyJson: () => JSON.stringify(serializeGradient(value), null, 2),
    paste: (t) => {
      try {
        const g = parseGradient(JSON.parse(t));
        if (!g || locked) return false;
        done(g);
        return true;
      } catch {
        return false;
      }
    },
    reset: defaultValue ? () => done(defaultValue) : undefined,
    canReset: () => defaultValue !== undefined && !equalsDefault,
    disabled,
    readOnly,
    extra: () => [
      { label: "Reverse", run: () => done(reverseGradient(value)) },
      { label: "Distribute evenly", run: () => done(distributeEvenly(value)) },
      { label: "Flip colors", run: () => done(flipColors(value)) },
      { label: "Flip alpha", run: () => done(flipAlpha(value)) },
    ],
  });

  return (
    <div
      ref={ref}
      {...ctxProps}
      data-kk="gradient-editor"
      data-no-pan=""
      className={cx("kk-grad", locked && "is-disabled", className)}
      title={tooltip}
    >
      <div className="kk-grad__stage">
        <div
          className="kk-grad__row kk-grad__row--alpha"
          onPointerDown={(e) => addAt(e, "alpha")}
          aria-label="Alpha stops"
        >
          {alphaStops.map((s, i) => (
            <button
              key={i}
              type="button"
              className={cx(
                "kk-gstop kk-gstop--alpha",
                sel.kind === "alpha" && si === i && "is-selected",
                pending?.kind === "alpha" && pending.index === i && "is-removing",
              )}
              style={{ left: `${s.pos * 100}%` }}
              aria-label={`Alpha stop ${i + 1}: ${Math.round(s.alpha * 100)}% at ${Math.round(s.pos * 100)}%`}
              onPointerDown={(e) => dragStop(e, { kind: "alpha", index: i })}
              onKeyDown={stopKey({ kind: "alpha", index: i })}
              onFocus={() => setSel({ kind: "alpha", index: i })}
            >
              <i
                style={{
                  background: `rgb(${Math.round(s.alpha * 255)} ${Math.round(s.alpha * 255)} ${Math.round(s.alpha * 255)})`,
                }}
              />
            </button>
          ))}
        </div>
        <div ref={barRef} className="kk-grad__bar kk-checker">
          <GradientCanvas value={value} />
        </div>
        <div
          className="kk-grad__row kk-grad__row--color"
          onPointerDown={(e) => addAt(e, "color")}
          aria-label="Color stops"
        >
          {colorStops.map((s, i) => (
            <button
              key={i}
              type="button"
              className={cx(
                "kk-gstop kk-gstop--color",
                sel.kind === "color" && si === i && "is-selected",
                pending?.kind === "color" && pending.index === i && "is-removing",
              )}
              style={{ left: `${s.pos * 100}%` }}
              aria-label={`Color stop ${i + 1} at ${Math.round(s.pos * 100)}%`}
              onPointerDown={(e) => dragStop(e, { kind: "color", index: i })}
              onKeyDown={stopKey({ kind: "color", index: i })}
              onFocus={() => setSel({ kind: "color", index: i })}
            >
              <i style={{ background: toCssColor({ ...s.color, a: 1 }) }} />
            </button>
          ))}
        </div>
      </div>

      <div className="kk-grad__sel">
        <span className="kk-grad__sellabel">{sel.kind === "color" ? "Color stop" : "Alpha stop"}</span>
        {selColor && (
          <>
            <NumberField
              label="Pos"
              aria-label="Stop position"
              density="compact"
              value={selColor.pos * 100}
              min={0}
              max={100}
              step={1}
              precision={1}
              unit="%"
              disabled={locked}
              onChange={(v) => {
                const r = moveColorStop(cur.current, si, v / 100);
                live(r.gradient);
                setSel({ kind: "color", index: r.index });
              }}
              onCommit={() => onCommit?.(cur.current)}
            />
            <ColorField
              value={{ ...selColor.color, a: 1 }}
              hdr
              alpha={false}
              density="compact"
              showHex={false}
              aria-label="Stop color"
              disabled={locked}
              onChange={(c) => live(setColorStopColor(cur.current, si, c))}
              onCommit={() => onCommit?.(cur.current)}
            />
          </>
        )}
        {selAlpha && (
          <>
            <NumberField
              label="Pos"
              aria-label="Stop position"
              density="compact"
              value={selAlpha.pos * 100}
              min={0}
              max={100}
              step={1}
              precision={1}
              unit="%"
              disabled={locked}
              onChange={(v) => {
                const r = moveAlphaStop(cur.current, si, v / 100);
                live(r.gradient);
                setSel({ kind: "alpha", index: r.index });
              }}
              onCommit={() => onCommit?.(cur.current)}
            />
            <NumberField
              label="Alpha"
              aria-label="Stop alpha"
              density="compact"
              value={selAlpha.alpha * 100}
              min={0}
              max={100}
              step={1}
              precision={1}
              unit="%"
              disabled={locked}
              onChange={(v) => live(setAlphaStopValue(cur.current, si, v / 100))}
              onCommit={() => onCommit?.(cur.current)}
            />
          </>
        )}
        <button
          type="button"
          className="kk-minibtn kk-minibtn--icon"
          disabled={locked || (sel.kind === "color" ? colorStops.length : alphaStops.length) <= 1}
          onClick={() => remove({ kind: sel.kind, index: si })}
          aria-label="Delete selected stop"
          title="Delete stop (Del)"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="kk-grad__bar2">
        <SegmentedControl<GradientMode>
          value={value.mode}
          onChange={(m) => done({ ...value, mode: m })}
          options={MODES}
          density="compact"
          disabled={locked}
          aria-label="Interpolation mode"
        />
        <span className="kk-grad__tools">
          <button
            type="button"
            className="kk-minibtn kk-minibtn--icon"
            disabled={locked}
            onClick={() => done(reverseGradient(value))}
            aria-label="Reverse gradient"
            title="Reverse"
          >
            <ArrowLeftRight size={12} />
          </button>
          <button
            type="button"
            className="kk-minibtn kk-minibtn--icon"
            disabled={locked}
            onClick={() => done(distributeEvenly(value))}
            aria-label="Distribute stops evenly"
            title="Distribute evenly"
          >
            <StretchHorizontal size={12} />
          </button>
          <button
            type="button"
            className="kk-minibtn kk-minibtn--icon"
            disabled={locked}
            onClick={() => done(sel.kind === "color" ? flipColors(value) : flipAlpha(value))}
            aria-label="Flip"
            title={sel.kind === "color" ? "Flip colors (alpha unchanged)" : "Flip alpha (colors unchanged)"}
          >
            <FlipHorizontal2 size={12} />
          </button>
          <button
            ref={presetBtn}
            type="button"
            className="kk-minibtn"
            disabled={locked}
            onClick={() => setPresets((p) => !p)}
            aria-haspopup="dialog"
            aria-expanded={presets}
          >
            <Palette size={12} /> Presets
          </button>
          <button
            type="button"
            className="kk-minibtn kk-minibtn--icon"
            onClick={() => void copyText(JSON.stringify(serializeGradient(value)))}
            aria-label="Copy gradient"
            title="Copy as JSON"
          >
            <Copy size={12} />
          </button>
          <button
            type="button"
            className="kk-minibtn kk-minibtn--icon"
            disabled={locked}
            aria-label="Paste gradient"
            title="Paste gradient JSON"
            onClick={async () => {
              try {
                const g = parseGradient(JSON.parse(await pasteText()));
                if (g) done(g);
              } catch {
                /* not a gradient */
              }
            }}
          >
            <ClipboardPaste size={12} />
          </button>
        </span>
      </div>
      <div className="kk-grad__count">
        {colorStops.length}/{maxStops} color · {alphaStops.length}/{maxStops} alpha
      </div>

      <Popover
        open={presets}
        anchor={presetBtn.current}
        onClose={() => setPresets(false)}
        ariaLabel="Gradient presets"
        width={232}
        align="end"
      >
        <div className="kk-presets">
          {GRADIENT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="kk-preset"
              onClick={() => {
                done({ ...p.gradient });
                setPresets(false);
                setSel({ kind: "color", index: 0 });
              }}
            >
              <span className="kk-preset__bar kk-checker">
                <GradientCanvas value={p.gradient} />
              </span>
              <span className="kk-preset__name">{p.name}</span>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

interface GradientFieldProps extends ControlProps<Gradient> {
  maxStops?: number;
}

/** Compact inline trigger: a mini gradient bar that opens the full editor in a popover. */
export function GradientField(props: GradientFieldProps) {
  const {
    value,
    onChange,
    onCommit,
    onCancel,
    disabled,
    readOnly,
    mixed,
    invalid,
    message,
    density = "regular",
    className,
    maxStops,
    defaultValue,
    tooltip,
    label,
  } = props;
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const locked = disabled || readOnly;
  const modified =
    defaultValue !== undefined &&
    JSON.stringify(serializeGradient(defaultValue)) !== JSON.stringify(serializeGradient(value));
  const { ref, props: ctxProps } = useBridge(
    {
      kind: "gradient.field",
      copyText: () => JSON.stringify(serializeGradient(value)),
      copyJson: () => JSON.stringify(serializeGradient(value), null, 2),
      paste: (t) => {
        try {
          const g = parseGradient(JSON.parse(t));
          if (!g || locked) return false;
          onChange?.(g);
          onCommit?.(g);
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
    "control.gradient",
  );
  return (
    <div
      ref={ref}
      {...ctxProps}
      data-kk="gradient-field"
      data-no-pan=""
      data-density={density}
      className={cx(
        "kk-gradfield",
        `kk-gradfield--${density}`,
        locked && "is-disabled",
        mixed && "is-mixed",
        invalid && "is-invalid",
        modified && "is-modified",
        className,
      )}
      title={invalid ? message : tooltip}
    >
      <button
        ref={btn}
        type="button"
        className="kk-gradfield__btn kk-checker"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={props["aria-label"] ?? (typeof label === "string" ? label : "Gradient")}
        onClick={() => !readOnly && setOpen((o) => !o)}
      >
        {mixed ? <span className="kk-gradfield__mixed">{"\u2014"}</span> : <GradientCanvas value={value} />}
      </button>
      <Popover open={open} anchor={btn.current} onClose={() => setOpen(false)} ariaLabel="Gradient editor" width={304}>
        <GradientEditor
          value={value}
          onChange={onChange}
          onCommit={onCommit}
          onCancel={onCancel}
          maxStops={maxStops}
          defaultValue={defaultValue}
        />
      </Popover>
    </div>
  );
}
