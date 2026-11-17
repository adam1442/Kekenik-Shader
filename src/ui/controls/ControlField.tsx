import type { ReactNode } from "react";
import { cx } from "../util/cx";
import type { Density } from "./types";

interface ControlFieldProps {
  label?: ReactNode;
  tooltip?: string;
  density?: Density;
  /** Shows the modified-dot when true. */
  modified?: boolean;
  /** Double-clicking the label resets. */
  onReset?: () => void;
  invalid?: boolean;
  message?: string;
  disabled?: boolean;
  /** Layout: label left of the control (default) or stacked above it. */
  stacked?: boolean;
  className?: string;
  children: ReactNode;
}

/** Label + control + helper message wrapper with modified-dot and double-click-label-to-reset. */
export function ControlField({
  label,
  tooltip,
  density = "regular",
  modified,
  onReset,
  invalid,
  message,
  disabled,
  stacked,
  className,
  children,
}: ControlFieldProps) {
  return (
    <div
      data-kk="control-field"
      data-density={density}
      className={cx(
        "kk-cf",
        `kk-cf--${density}`,
        stacked && "kk-cf--stacked",
        invalid && "is-invalid",
        disabled && "is-disabled",
        className,
      )}
      title={tooltip}
    >
      {label !== undefined && label !== null && (
        <div
          className="kk-cf__label"
          onDoubleClick={() => !disabled && modified && onReset?.()}
          title={modified && onReset ? "Double-click to reset" : undefined}
        >
          <span className={cx("kk-modot", modified && "is-on")} aria-hidden="true" />
          <span className="kk-cf__text">{label}</span>
        </div>
      )}
      <div className="kk-cf__control">{children}</div>
      {invalid && message && (
        <div className="kk-cf__msg" role="alert">
          {message}
        </div>
      )}
    </div>
  );
}

/** Round "modified" indicator reused by rows. */
export function ModifiedDot({ on }: { on: boolean }) {
  return <span className={cx("kk-modot", on && "is-on")} aria-hidden="true" />;
}
