import { Check, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../util/cx";
import { useBridge } from "./bridge";
import type { Density } from "./types";

interface BoolProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  onCommit?: (checked: boolean) => void;
  label?: ReactNode;
  tooltip?: string;
  disabled?: boolean;
  readOnly?: boolean;
  mixed?: boolean;
  invalid?: boolean;
  defaultValue?: boolean;
  density?: Density;
  className?: string;
  "aria-label"?: string;
}

function useBoolBridge(p: BoolProps, kind: string) {
  const locked = p.disabled || p.readOnly;
  return useBridge<HTMLButtonElement>({
    kind,
    copyText: () => String(p.checked),
    copyJson: () => JSON.stringify(p.checked),
    paste: (t) => {
      const s = t.trim().toLowerCase();
      if (locked || !["true", "false", "1", "0", "on", "off"].includes(s)) return false;
      const v = s === "true" || s === "1" || s === "on";
      p.onChange(v);
      p.onCommit?.(v);
      return true;
    },
    reset:
      p.defaultValue !== undefined
        ? () => {
            p.onChange(p.defaultValue!);
            p.onCommit?.(p.defaultValue!);
          }
        : undefined,
    canReset: () => p.defaultValue !== undefined && p.defaultValue !== p.checked,
    disabled: p.disabled,
    readOnly: p.readOnly,
  });
}

/** Switch-style toggle (role="switch"). */
export function Toggle(p: BoolProps) {
  const {
    checked,
    onChange,
    onCommit,
    label,
    disabled,
    readOnly,
    mixed,
    invalid,
    density = "regular",
    className,
    tooltip,
  } = p;
  const { ref, props } = useBoolBridge(p, "toggle");
  const locked = disabled || readOnly;
  return (
    <button
      ref={ref}
      {...props}
      type="button"
      role="switch"
      data-kk="toggle"
      data-no-pan=""
      aria-checked={mixed ? "mixed" : checked}
      aria-label={p["aria-label"]}
      aria-readonly={readOnly || undefined}
      aria-invalid={invalid || undefined}
      title={tooltip}
      disabled={disabled}
      className={cx(
        "kk-toggle",
        `kk-toggle--${density}`,
        checked && !mixed && "is-on",
        mixed && "is-mixed",
        invalid && "is-invalid",
        readOnly && "is-readonly",
        className,
      )}
      onClick={() => {
        if (locked) return;
        onChange(!checked);
        onCommit?.(!checked);
      }}
    >
      <span className="kk-toggle__track">
        <span className="kk-toggle__thumb" />
      </span>
      {label !== undefined && <span className="kk-toggle__label">{label}</span>}
    </button>
  );
}
export const Switch = Toggle;

export interface CheckboxProps extends BoolProps {
  /** Tri-state "some" display (also used when `mixed`). */
  indeterminate?: boolean;
}

/** Checkbox with optional indeterminate (tri-state) display. Clicking an indeterminate box checks it. */
export function Checkbox(p: CheckboxProps) {
  const {
    checked,
    onChange,
    onCommit,
    indeterminate,
    label,
    disabled,
    readOnly,
    mixed,
    invalid,
    density = "regular",
    className,
    tooltip,
  } = p;
  const { ref, props } = useBoolBridge(p, "checkbox");
  const locked = disabled || readOnly;
  const tri = indeterminate || mixed;
  return (
    <button
      ref={ref}
      {...props}
      type="button"
      role="checkbox"
      data-kk="checkbox"
      data-no-pan=""
      aria-checked={tri ? "mixed" : checked}
      aria-label={p["aria-label"]}
      aria-invalid={invalid || undefined}
      title={tooltip}
      disabled={disabled}
      className={cx(
        "kk-check",
        `kk-check--${density}`,
        (checked || tri) && "is-on",
        invalid && "is-invalid",
        readOnly && "is-readonly",
        className,
      )}
      onClick={() => {
        if (locked) return;
        const next = tri ? true : !checked;
        onChange(next);
        onCommit?.(next);
      }}
    >
      <span className="kk-check__box">
        {tri ? <Minus size={11} strokeWidth={3} /> : checked ? <Check size={11} strokeWidth={3} /> : null}
      </span>
      {label !== undefined && <span className="kk-check__label">{label}</span>}
    </button>
  );
}

interface ChipOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}
interface ChipSelectProps {
  value: string[];
  options: ChipOption[];
  onChange: (v: string[]) => void;
  onCommit?: (v: string[]) => void;
  disabled?: boolean;
  readOnly?: boolean;
  invalid?: boolean;
  density?: Density;
  className?: string;
  "aria-label"?: string;
}

/** Multi-select tag chips (toggle buttons). Order of `value` follows `options`. */
export function ChipSelect({
  value,
  options,
  onChange,
  onCommit,
  disabled,
  readOnly,
  invalid,
  density = "regular",
  className,
  ...rest
}: ChipSelectProps) {
  const locked = disabled || readOnly;
  const toggle = (v: string) => {
    if (locked) return;
    const set = new Set(value);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    const next = options.map((o) => o.value).filter((x) => set.has(x));
    onChange(next);
    onCommit?.(next);
  };
  const { ref, props } = useBridge({
    kind: "chips",
    copyText: () => value.join(", "),
    copyJson: () => JSON.stringify(value),
    disabled,
    readOnly,
  });
  return (
    <div
      ref={ref}
      {...props}
      data-kk="chip-select"
      data-no-pan=""
      role="group"
      aria-label={rest["aria-label"]}
      className={cx("kk-chips", `kk-chips--${density}`, locked && "is-disabled", invalid && "is-invalid", className)}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value.includes(o.value)}
          disabled={disabled || o.disabled}
          className={cx("kk-chip", value.includes(o.value) && "is-on")}
          onClick={() => toggle(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
