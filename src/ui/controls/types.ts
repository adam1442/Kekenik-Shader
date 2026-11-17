import type { ReactNode } from "react";

export type Density = "regular" | "compact";

/**
 * Event contract shared by every value control (docs/CONTROLS.md):
 *  - `onChange(v)`  live; fires continuously while dragging / typing steps.
 *  - `onCommit(v)`  exactly ONCE per gesture (drag end, Enter, blur, one key press, a wheel burst) — undo transactions hook here.
 *  - `onCancel()`   Esc during a gesture: the control first restores the pre-gesture value through `onChange`, then calls this.
 */
export interface ControlProps<T> {
  value: T;
  onChange?: (v: T) => void;
  onCommit?: (v: T) => void;
  onCancel?: () => void;
  /** When set (and different from `value`) a modified-dot is shown and double-click on the label / context menu resets. */
  defaultValue?: T;
  label?: ReactNode;
  tooltip?: string;
  disabled?: boolean;
  readOnly?: boolean;
  /** Multi-selection with differing values: shows "—" and the first edit overwrites all. */
  mixed?: boolean;
  invalid?: boolean;
  /** Message shown for `invalid` (tooltip + helper text). */
  message?: string;
  density?: Density;
  className?: string;
  "aria-label"?: string;
}

/** Props every control also accepts for layout. */
export interface LayoutProps {
  className?: string;
  style?: React.CSSProperties;
}
