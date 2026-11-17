import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from "react";
import { cx } from "../util/cx";
import { beginDrag } from "./useDrag";

export interface DragSurfaceProps {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  disabled?: boolean;
  /** Called with normalised coordinates (0..1, clamped) on press and on every move. */
  onPoint: (u: number, v: number, mods: { shift: boolean; alt: boolean; ctrl: boolean }) => void;
  /** Called once when the gesture ends (cancelled = Esc). */
  onEnd?: (cancelled: boolean) => void;
  /** Called once when the gesture begins (to capture the pre-gesture value). */
  onBegin?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
  role?: string;
  tabIndex?: number;
  "aria-label"?: string;
  "aria-valuenow"?: number;
  "aria-valuemin"?: number;
  "aria-valuemax"?: number;
  "aria-valuetext"?: string;
}

/** A rectangle that turns pointer drags into normalised (u,v) points. Used by colour surfaces, sliders, pads. */
export function DragSurface({
  className,
  style,
  children,
  disabled,
  onPoint,
  onEnd,
  onBegin,
  onKeyDown,
  ...aria
}: DragSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus();
    const el = ref.current!;
    const pt = (x: number, y: number, m: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean }) => {
      const r = el.getBoundingClientRect();
      const u = Math.min(1, Math.max(0, (x - r.left) / (r.width || 1)));
      const v = Math.min(1, Math.max(0, (y - r.top) / (r.height || 1)));
      onPoint(u, v, { shift: m.shiftKey, alt: m.altKey, ctrl: m.ctrlKey });
    };
    onBegin?.();
    pt(e.clientX, e.clientY, e);
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
        onMove: (p) => pt(p.clientX, p.clientY, p.event),
        onEnd: ({ cancelled }) => {
          setDragging(false);
          onEnd?.(cancelled);
        },
      },
    );
  };
  return (
    <div
      ref={ref}
      className={cx("kk-surface", dragging && "is-dragging", disabled && "is-disabled", className)}
      style={style}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={down}
      onKeyDown={onKeyDown}
      {...aria}
    >
      {children}
    </div>
  );
}
