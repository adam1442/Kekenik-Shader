import { type KeyboardEvent, type ReactNode } from "react";
import { cx } from "../util/cx";
import type { IconType } from "../Button";
import type { Density } from "./types";

interface SegmentOption<T extends string> {
  value: T;
  label?: ReactNode;
  icon?: IconType;
  title?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (v: T) => void;
  onCommit?: (v: T) => void;
  disabled?: boolean;
  readOnly?: boolean;
  mixed?: boolean;
  invalid?: boolean;
  density?: Density;
  /** Stretch segments to fill the width. */
  block?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** Radio-group segmented control / button group. Arrow keys move the selection (roving tabindex). */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  onCommit,
  disabled,
  readOnly,
  mixed,
  invalid,
  density = "regular",
  block,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  const locked = disabled || readOnly;
  const pick = (v: T) => {
    if (locked) return;
    onChange(v);
    onCommit?.(v);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (locked) return;
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir || enabled.length === 0) return;
    e.preventDefault();
    const next = enabled[(i + dir + enabled.length) % enabled.length]!;
    pick(next.value);
    const group = e.currentTarget; // React nulls currentTarget after the handler returns
    requestAnimationFrame(() =>
      (group.querySelector(`[data-value="${CSS.escape(next.value)}"]`) as HTMLElement | null)?.focus(),
    );
  };
  return (
    <div
      data-kk="segmented"
      data-no-pan=""
      role="radiogroup"
      aria-label={rest["aria-label"]}
      aria-disabled={disabled || undefined}
      aria-invalid={invalid || undefined}
      className={cx(
        "kk-seg",
        `kk-seg--${density}`,
        block && "is-block",
        locked && "is-disabled",
        invalid && "is-invalid",
        mixed && "is-mixed",
        className,
      )}
      onKeyDown={onKey}
    >
      {options.map((o) => {
        const on = !mixed && o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            data-value={o.value}
            aria-checked={on}
            tabIndex={on || (mixed && o === options[0]) ? 0 : -1}
            title={o.title}
            disabled={disabled || o.disabled}
            className={cx("kk-seg__btn", on && "is-on")}
            onClick={() => pick(o.value)}
          >
            {Icon && <Icon size={13} />}
            {o.label !== undefined && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
