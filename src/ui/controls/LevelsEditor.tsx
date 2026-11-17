import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import {
  autoLevels,
  channelKey,
  computeHistogram,
  histogramHeights,
  identityLevels,
  isIdentityLevels,
  type ChannelLevels,
  type Histogram,
  type HistogramSource,
  type Levels,
  type LevelsChannel,
} from "@/core/values/levels";
import { clamp, roundTo } from "@/core/values/numeric";
import { cx } from "../util/cx";
import { useBridge } from "./bridge";
import { NumberField } from "./NumberField";
import { SegmentedControl } from "./Segmented";
import { Toggle } from "./Switches";
import { beginDrag } from "./useDrag";
import type { ControlProps } from "./types";

/** What the editor can read a histogram from. */
type LevelsSource = Histogram | HistogramSource | (() => ReturnType<HistogramSource["read"]>) | null | undefined;

/** Histogram source over a canvas (reads its pixels on demand). */
export function canvasSource(canvas: HTMLCanvasElement): HistogramSource {
  return {
    read: () => {
      const ctx = canvas.getContext("2d");
      if (!ctx || !canvas.width || !canvas.height) return null;
      return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, kind: "u8" };
    },
  };
}
export function imageDataSource(img: ImageData): HistogramSource {
  return { read: () => ({ data: img.data, kind: "u8" }) };
}
export function float32Source(data: Float32Array): HistogramSource {
  return { read: () => ({ data, kind: "float" }) };
}

function resolveHistogram(src: LevelsSource): Histogram | null {
  if (!src) return null;
  if ("bins" in src) return src;
  const r = typeof src === "function" ? src() : src.read();
  if (!r) return null;
  const stride = Math.max(1, Math.floor(r.data.length / 4 / 262144));
  return computeHistogram(r.data, r.kind ?? "u8", 256, stride);
}

const CH_TABS: Array<{ value: LevelsChannel; label: string }> = [
  { value: "rgb", label: "RGB" },
  { value: "r", label: "R" },
  { value: "g", label: "G" },
  { value: "b", label: "B" },
  { value: "a", label: "A" },
  { value: "luma", label: "Luma" },
];
const CH_COLOR: Record<LevelsChannel, string> = {
  rgb: "#c8ccd8",
  r: "#ff6b6b",
  g: "#6bdc7a",
  b: "#6b9cff",
  a: "#9aa0ae",
  luma: "#e8d27a",
};

interface LevelsEditorProps extends Omit<ControlProps<Levels>, "label" | "mixed"> {
  /** Histogram input: a Histogram, a HistogramSource, or a callback (e.g. reading back the Preview render). */
  source?: LevelsSource;
  height?: number;
}

interface HandleProps {
  pos: number;
  label: string;
  kind: "black" | "gamma" | "white";
  disabled?: boolean;
  onMove: (t: number) => void;
  onEnd: (cancelled: boolean) => void;
  onBegin: () => void;
  onNudge: (dir: 1 | -1, fine: boolean) => void;
  trackRef: React.RefObject<HTMLDivElement | null>;
}

function Handle({ pos, label, kind, disabled, onMove, onEnd, onBegin, onNudge, trackRef }: HandleProps) {
  const down = (e: RPointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0 || !trackRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.focus();
    onBegin();
    const at = (x: number) => {
      const r = trackRef.current!.getBoundingClientRect();
      return clamp((x - r.left) / (r.width || 1), 0, 1);
    };
    beginDrag(
      {
        clientX: e.clientX,
        clientY: e.clientY,
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        target: e.currentTarget,
      },
      { onMove: (p) => onMove(at(p.clientX)), onEnd: ({ cancelled }) => onEnd(cancelled) },
    );
  };
  const key = (e: KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onNudge(1, e.shiftKey);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onNudge(-1, e.shiftKey);
    }
  };
  return (
    <button
      type="button"
      role="slider"
      aria-label={label}
      aria-valuenow={Number(pos.toFixed(3))}
      aria-valuemin={0}
      aria-valuemax={1}
      className={cx("kk-lvl__h", `kk-lvl__h--${kind}`)}
      style={{ left: `${pos * 100}%` }}
      disabled={disabled}
      onPointerDown={down}
      onKeyDown={key}
    />
  );
}

/** Photoshop-style Levels: histogram behind input black/gamma/white handles, output range, channel tabs, Auto, Reset. */
export function LevelsEditor(props: LevelsEditorProps) {
  const {
    value,
    onChange,
    onCommit,
    onCancel,
    source,
    disabled,
    readOnly,
    className,
    defaultValue,
    tooltip,
    height = 84,
  } = props;
  const locked = disabled || readOnly;
  const [channel, setChannel] = useState<LevelsChannel>("rgb");
  const [log, setLog] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [version, setVersion] = useState(0);
  const cvs = useRef<HTMLCanvasElement>(null);
  const inTrack = useRef<HTMLDivElement>(null);
  const outTrack = useRef<HTMLDivElement>(null);
  const cur = useRef(value);
  cur.current = value;
  const startRef = useRef(value);
  const hist = useMemo(() => resolveHistogram(source), [source, version]);
  const key = channelKey(channel);
  const ch = value[key];

  const live = (patch: Partial<ChannelLevels>) => {
    const next = { ...cur.current, [key]: { ...cur.current[key], ...patch } };
    cur.current = next;
    onChange?.(next);
  };
  const commit = () => onCommit?.(cur.current);
  const apply = (l: Levels) => {
    cur.current = l;
    onChange?.(l);
    onCommit?.(l);
  };
  const begin = () => (startRef.current = cur.current);
  const end = (cancelled: boolean) => {
    if (cancelled) {
      cur.current = startRef.current;
      onChange?.(startRef.current);
      onCancel?.();
    } else commit();
  };
  const gammaPos = ch.inBlack + (ch.inWhite - ch.inBlack) * Math.pow(0.5, ch.gamma);
  const mkGamma = (n: number) => clamp(roundTo(Math.log(0.5) / Math.log(clamp(n, 0.01, 0.99)), 2), 0.1, 9.99);

  // histogram drawing (imperative)
  useEffect(() => {
    const c = cvs.current;
    if (!c) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth || 256;
      const h = c.clientHeight || height;
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo((w * i) / 4 + 0.5, 0);
        ctx.lineTo((w * i) / 4 + 0.5, h);
        ctx.stroke();
      }
      if (!hist || hist.count === 0) return;
      const series: Array<[Uint32Array, string, number]> = overlay
        ? [
            [hist.r, "#ff5a5a", 0.5],
            [hist.g, "#5adc6e", 0.5],
            [hist.b, "#5a8cff", 0.5],
          ]
        : [
            [
              channel === "r"
                ? hist.r
                : channel === "g"
                  ? hist.g
                  : channel === "b"
                    ? hist.b
                    : channel === "a"
                      ? hist.a
                      : hist.luma,
              CH_COLOR[channel],
              0.75,
            ],
          ];
      ctx.globalCompositeOperation = overlay ? "lighter" : "source-over";
      for (const [bins, color, alpha] of series) {
        const hs = histogramHeights(bins, log);
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i < hs.length; i++) ctx.lineTo((i / (hs.length - 1)) * w, h - hs[i]! * (h - 4));
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    };
    draw();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(draw) : null;
    ro?.observe(c);
    return () => ro?.disconnect();
  }, [hist, channel, log, overlay, height]);

  const equalsDefault = defaultValue !== undefined && JSON.stringify(defaultValue) === JSON.stringify(value);
  const { ref, props: ctx } = useBridge({
    kind: "levels",
    copyText: () => JSON.stringify(value),
    copyJson: () => JSON.stringify(value, null, 2),
    paste: (t) => {
      try {
        const j = JSON.parse(t) as Levels;
        if (locked || !j?.master || !j.r || !j.g || !j.b || !j.a) return false;
        apply(j);
        return true;
      } catch {
        return false;
      }
    },
    reset: () => apply(defaultValue ?? identityLevels()),
    canReset: () => (defaultValue ? !equalsDefault : !isIdentityLevels(value)),
    disabled,
    readOnly,
    extra: () => [{ label: "Auto levels", disabled: locked || !hist, run: () => hist && apply(autoLevels(hist)) }],
  });
  const f = (v: number) => roundTo(v, 3);
  return (
    <div
      ref={ref}
      {...ctx}
      data-kk="levels-editor"
      data-no-pan=""
      className={cx("kk-lvl", locked && "is-disabled", className)}
      title={tooltip}
    >
      <div className="kk-lvl__bar">
        <SegmentedControl<LevelsChannel>
          value={channel}
          onChange={setChannel}
          options={CH_TABS}
          density="compact"
          aria-label="Channel"
        />
      </div>
      <div className="kk-lvl__histwrap" style={{ height }}>
        <canvas ref={cvs} className="kk-lvl__hist" aria-label="Histogram" />
        {(!hist || hist.count === 0) && (
          <div className="kk-lvl__empty">
            No image source<span>Connect a preview or image to see its histogram</span>
          </div>
        )}
      </div>
      <div ref={inTrack} className="kk-lvl__track kk-lvl__track--in" aria-label="Input levels">
        <Handle
          kind="black"
          label="Input black"
          pos={ch.inBlack}
          disabled={locked}
          trackRef={inTrack}
          onBegin={begin}
          onEnd={end}
          onMove={(t) => live({ inBlack: roundTo(Math.min(t, ch.inWhite - 0.004), 3) })}
          onNudge={(d, fine) => {
            live({ inBlack: f(clamp(ch.inBlack + d * (fine ? 0.001 : 0.01), 0, ch.inWhite - 0.004)) });
            commit();
          }}
        />
        <Handle
          kind="gamma"
          label="Gamma"
          pos={gammaPos}
          disabled={locked}
          trackRef={inTrack}
          onBegin={begin}
          onEnd={end}
          onMove={(t) => live({ gamma: mkGamma((t - ch.inBlack) / Math.max(1e-6, ch.inWhite - ch.inBlack)) })}
          onNudge={(d, fine) => {
            live({ gamma: clamp(f(ch.gamma + d * (fine ? 0.01 : 0.1)), 0.1, 9.99) });
            commit();
          }}
        />
        <Handle
          kind="white"
          label="Input white"
          pos={ch.inWhite}
          disabled={locked}
          trackRef={inTrack}
          onBegin={begin}
          onEnd={end}
          onMove={(t) => live({ inWhite: roundTo(Math.max(t, ch.inBlack + 0.004), 3) })}
          onNudge={(d, fine) => {
            live({ inWhite: f(clamp(ch.inWhite + d * (fine ? 0.001 : 0.01), ch.inBlack + 0.004, 1)) });
            commit();
          }}
        />
      </div>
      <div className="kk-lvl__fields">
        <NumberField
          label="Black"
          aria-label="Input black"
          density="compact"
          value={ch.inBlack}
          min={0}
          max={ch.inWhite - 0.004}
          step={0.005}
          precision={3}
          disabled={locked}
          defaultValue={0}
          onChange={(v) => live({ inBlack: v })}
          onCommit={commit}
        />
        <NumberField
          label="Gamma"
          aria-label="Gamma"
          density="compact"
          value={ch.gamma}
          min={0.1}
          max={9.99}
          step={0.01}
          precision={2}
          disabled={locked}
          defaultValue={1}
          onChange={(v) => live({ gamma: v })}
          onCommit={commit}
        />
        <NumberField
          label="White"
          aria-label="Input white"
          density="compact"
          value={ch.inWhite}
          min={ch.inBlack + 0.004}
          max={1}
          step={0.005}
          precision={3}
          disabled={locked}
          defaultValue={1}
          onChange={(v) => live({ inWhite: v })}
          onCommit={commit}
        />
      </div>
      <div ref={outTrack} className="kk-lvl__track kk-lvl__track--out kk-lvl__outramp" aria-label="Output levels">
        <Handle
          kind="black"
          label="Output black"
          pos={ch.outBlack}
          disabled={locked}
          trackRef={outTrack}
          onBegin={begin}
          onEnd={end}
          onMove={(t) => live({ outBlack: roundTo(t, 3) })}
          onNudge={(d, fine) => {
            live({ outBlack: f(clamp(ch.outBlack + d * (fine ? 0.001 : 0.01), 0, 1)) });
            commit();
          }}
        />
        <Handle
          kind="white"
          label="Output white"
          pos={ch.outWhite}
          disabled={locked}
          trackRef={outTrack}
          onBegin={begin}
          onEnd={end}
          onMove={(t) => live({ outWhite: roundTo(t, 3) })}
          onNudge={(d, fine) => {
            live({ outWhite: f(clamp(ch.outWhite + d * (fine ? 0.001 : 0.01), 0, 1)) });
            commit();
          }}
        />
      </div>
      <div className="kk-lvl__fields kk-lvl__fields--out">
        <NumberField
          label="Out black"
          aria-label="Output black"
          density="compact"
          value={ch.outBlack}
          min={0}
          max={1}
          step={0.005}
          precision={3}
          disabled={locked}
          defaultValue={0}
          onChange={(v) => live({ outBlack: v })}
          onCommit={commit}
        />
        <NumberField
          label="Out white"
          aria-label="Output white"
          density="compact"
          value={ch.outWhite}
          min={0}
          max={1}
          step={0.005}
          precision={3}
          disabled={locked}
          defaultValue={1}
          onChange={(v) => live({ outWhite: v })}
          onCommit={commit}
        />
      </div>
      <div className="kk-lvl__bar kk-lvl__bar--foot">
        <Toggle checked={log} onChange={setLog} label="Log" density="compact" tooltip="Logarithmic histogram scale" />
        <Toggle
          checked={overlay}
          onChange={setOverlay}
          label="Overlay RGB"
          density="compact"
          tooltip="Show R, G and B histograms together"
        />
        <span className="kk-curve__spacer" />
        <button
          type="button"
          className="kk-minibtn"
          disabled={!source}
          onClick={() => setVersion((v) => v + 1)}
          title="Re-read the histogram source"
        >
          Refresh
        </button>
        <button
          type="button"
          className="kk-minibtn"
          disabled={locked || !hist || hist.count === 0}
          title={hist ? "Stretch the histogram to the full range" : "Needs an image source"}
          onClick={() => hist && apply(autoLevels(hist))}
        >
          Auto
        </button>
        <button
          type="button"
          className="kk-minibtn"
          disabled={locked || isIdentityLevels(value)}
          onClick={() => apply(defaultValue ?? identityLevels())}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
