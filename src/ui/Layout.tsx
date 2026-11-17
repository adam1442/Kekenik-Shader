import { useRef, type CSSProperties, type ReactNode } from "react";
import { clamp, cx } from "./util/cx";
import type { IconType } from "./Button";

/* ── EmptyState ──────────────────────────────────────────────────────── */
export interface EmptyStateProps {
  icon?: IconType;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, actions, badge, className }: EmptyStateProps) {
  return (
    <div data-kk="empty-state" className={cx("kk-empty", className)}>
      {Icon && (
        <div className="kk-empty__icon">
          <Icon size={26} strokeWidth={1.4} />
        </div>
      )}
      <div className="kk-empty__title">{title}</div>
      {description && <div className="kk-empty__desc">{description}</div>}
      {badge && <div className="kk-empty__badge">{badge}</div>}
      {actions && <div className="kk-empty__actions">{actions}</div>}
    </div>
  );
}

/* ── ScrollArea ──────────────────────────────────────────────────────── */
export interface ScrollAreaProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  axis?: "y" | "x" | "both";
}

/** Scroll container with slim themed scrollbars (styling in ui-data.css). */
export function ScrollArea({ children, className, style, axis = "y" }: ScrollAreaProps) {
  return (
    <div data-kk="scroll-area" className={cx("kk-scroll", `kk-scroll--${axis}`, className)} style={style}>
      {children}
    </div>
  );
}

/* ── Splitter / SplitPane ────────────────────────────────────────────── */
interface SplitterProps {
  /** "vertical" = a vertical bar that resizes horizontally (left/right panes). */
  orientation: "vertical" | "horizontal";
  onDrag: (deltaPx: number) => void;
  onDragEnd?: () => void;
  className?: string;
}

function Splitter({ orientation, onDrag, onDragEnd, className }: SplitterProps) {
  const dragging = useRef(false);
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging.current = true;
    let last = orientation === "vertical" ? e.clientX : e.clientY;
    const cls = orientation === "vertical" ? "kk-resizing-h" : "kk-resizing-v";
    document.body.classList.add(cls);
    const move = (ev: PointerEvent) => {
      const cur = orientation === "vertical" ? ev.clientX : ev.clientY;
      onDrag(cur - last);
      last = cur;
    };
    const up = () => {
      dragging.current = false;
      document.body.classList.remove(cls);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onDragEnd?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      data-kk="splitter"
      className={cx("kk-splitter", `kk-splitter--${orientation}`, className)}
      onPointerDown={onPointerDown}
    />
  );
}

interface SplitPaneProps {
  direction: "row" | "column";
  /** Initial size in px of the first pane. */
  initial?: number;
  min?: number;
  max?: number;
  first: ReactNode;
  second: ReactNode;
  className?: string;
}

/** Two panes with a draggable splitter between them (the first pane has a fixed px size). */
export function SplitPane({
  direction,
  initial = 240,
  min = 80,
  max = 2000,
  first,
  second,
  className,
}: SplitPaneProps) {
  const sizeRef = useRef(initial);
  const firstRef = useRef<HTMLDivElement>(null);
  const apply = () => {
    if (firstRef.current) {
      firstRef.current.style[direction === "row" ? "width" : "height"] = `${sizeRef.current}px`;
    }
  };
  return (
    <div data-kk="split-pane" className={cx("kk-splitpane", `kk-splitpane--${direction}`, className)}>
      <div
        ref={firstRef}
        className="kk-splitpane__first"
        style={direction === "row" ? { width: initial } : { height: initial }}
      >
        {first}
      </div>
      <Splitter
        orientation={direction === "row" ? "vertical" : "horizontal"}
        onDrag={(d) => {
          sizeRef.current = clamp(sizeRef.current + d, min, max);
          apply();
        }}
      />
      <div className="kk-splitpane__second">{second}</div>
    </div>
  );
}
