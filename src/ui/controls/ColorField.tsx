import { useRef, useState, type DragEvent } from "react";
import {
  colorsEqual,
  decomposeEv,
  formatColorJson,
  formatRgbaCss,
  parseColor,
  toCssColor,
  toHex,
  type Rgba,
} from "@/core/values/color";
import { cx } from "../util/cx";
import { copyText } from "./clipboard";
import { useBridge } from "./bridge";
import { ColorPicker } from "./ColorPicker";
import { Popover } from "./Popover";
import type { ControlProps } from "./types";

export interface ColorFieldProps extends ControlProps<Rgba> {
  /** HDR: intensity (EV) control and values above 1. */
  hdr?: boolean;
  /** Edit alpha (default true). */
  alpha?: boolean;
  /** Show the hex readout next to the swatch (default true). */
  showHex?: boolean;
}

/** Colour swatch (checkerboard split for alpha, HDR badge) that opens the ColorPicker popover. Canonical value: linear float RGBA. */
export function ColorField(props: ColorFieldProps) {
  const {
    value,
    onChange,
    onCommit,
    onCancel,
    hdr,
    alpha = true,
    showHex = true,
    disabled,
    readOnly,
    mixed,
    invalid,
    message,
    density = "regular",
    defaultValue,
    className,
    label,
    tooltip,
  } = props;
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const locked = disabled || readOnly;
  const apply = (c: Rgba) => {
    const out = alpha ? c : { ...c, a: 1 };
    onChange?.(out);
    onCommit?.(out);
  };
  const modified = defaultValue !== undefined && (mixed || !colorsEqual(defaultValue, value, 1e-6));
  const { ref, props: ctxProps } = useBridge({
    kind: "color",
    copyText: () => toHex(value, alpha && value.a < 1),
    copyJson: () => formatColorJson(value),
    paste: (t) => {
      const c = parseColor(t);
      if (!c || locked) return false;
      apply(c);
      return true;
    },
    reset: defaultValue ? () => apply(defaultValue) : undefined,
    canReset: () => modified,
    disabled,
    readOnly,
    extra: () => [
      { label: "Copy as hex", run: () => void copyText(toHex(value, alpha && value.a < 1)) },
      { label: "Copy as rgba()", run: () => void copyText(formatRgbaCss(value)) },
      { label: "Copy as float JSON (linear)", run: () => void copyText(formatColorJson(value)) },
    ],
  });
  const { ev } = decomposeEv(value);
  const isHdr = hdr && (ev > 0 || Math.max(value.r, value.g, value.b) > 1);
  const onDrop = (e: DragEvent) => {
    setOver(false);
    if (locked) return;
    const raw = e.dataTransfer.getData("application/x-kk-color");
    if (!raw) return;
    e.preventDefault();
    const c = parseColor(raw);
    if (c) apply(c);
  };
  return (
    <div
      ref={ref}
      {...ctxProps}
      data-kk="color-field"
      data-no-pan=""
      data-density={density}
      className={cx(
        "kk-colorfield",
        `kk-colorfield--${density}`,
        locked && "is-disabled",
        mixed && "is-mixed",
        invalid && "is-invalid",
        over && "is-dragover",
        modified && "is-modified",
        className,
      )}
      title={invalid ? message : tooltip}
      onDragOver={(e) => {
        if (!locked && e.dataTransfer.types.includes("application/x-kk-color")) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <button
        ref={btn}
        type="button"
        className="kk-colorfield__btn"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={props["aria-label"] ?? (typeof label === "string" ? label : "Color")}
        draggable={!locked && !mixed}
        onDragStart={(e) => e.dataTransfer.setData("application/x-kk-color", formatColorJson(value))}
        onClick={() => !readOnly && setOpen((o) => !o)}
        onKeyDown={(e) => {
          if ((e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") && !open && !readOnly) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="kk-colorfield__swatch kk-checker">
          {!mixed && <span className="kk-colorfield__opaque" style={{ background: toCssColor({ ...value, a: 1 }) }} />}
          {!mixed && <span className="kk-colorfield__alpha" style={{ background: toCssColor(value) }} />}
        </span>
        {showHex && (
          <span className="kk-colorfield__hex kk-mono">{mixed ? "\u2014" : toHex(value).slice(1).toUpperCase()}</span>
        )}
        {alpha && !mixed && value.a < 1 && (
          <span className="kk-colorfield__a kk-mono">{Math.round(value.a * 100)}%</span>
        )}
        {hdr && (
          <span className={cx("kk-badge kk-badge--hdr", isHdr && "is-active")}>
            HDR{isHdr ? ` ${ev >= 0 ? "+" : ""}${ev.toFixed(1)}` : ""}
          </span>
        )}
      </button>
      <Popover open={open} anchor={btn.current} onClose={() => setOpen(false)} ariaLabel="Color picker" width={248}>
        <ColorPicker
          value={value}
          hdr={hdr}
          alpha={alpha}
          onChange={onChange}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      </Popover>
    </div>
  );
}
