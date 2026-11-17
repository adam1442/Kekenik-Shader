import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { cx } from "./util/cx";
import { Kbd } from "./Fields";
import { useOverlayRoot } from "./overlay/overlayRoot";

/* ── Tooltip ─────────────────────────────────────────────────────────── */
interface TooltipProps {
  content: ReactNode;
  shortcut?: string;
  placement?: "top" | "bottom" | "left" | "right";
  delay?: number;
  children: ReactNode;
}

/** Hover/focus tooltip rendered in a portal and clamped to the viewport. Give the child `title=""` to suppress native tooltips. */
export function Tooltip({ content, shortcut, placement = "bottom", delay = 450, children }: TooltipProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const root = useOverlayRoot();

  const show = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const a = anchor.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    let left = a.left + a.width / 2 - t.width / 2;
    let top = a.bottom + 6;
    if (placement === "top") top = a.top - t.height - 6;
    if (placement === "left") {
      left = a.left - t.width - 6;
      top = a.top + a.height / 2 - t.height / 2;
    }
    if (placement === "right") {
      left = a.right + 6;
      top = a.top + a.height / 2 - t.height / 2;
    }
    left = Math.max(6, Math.min(left, window.innerWidth - t.width - 6));
    top = Math.max(6, Math.min(top, window.innerHeight - t.height - 6));
    setPos({ left, top });
  }, [open, placement, content]);

  return (
    <span
      ref={anchor}
      className="kk-tooltip-anchor"
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
      onPointerDown={hide}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={tip}
            role="tooltip"
            data-overlay=""
            className="kk-tooltip"
            style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: "hidden" }}
          >
            {content}
            {shortcut && <Kbd shortcut={shortcut} />}
          </div>,
          root,
        )}
    </span>
  );
}

/* ── Modal ───────────────────────────────────────────────────────────── */
export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

/** Modal dialog: portal, Esc/backdrop close, focus trap, focus restore. */
export function Modal({ open, onClose, title, children, footer, width = 460 }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const restore = useRef<HTMLElement | null>(null);
  const root = useOverlayRoot();
  useEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => ref.current?.focus());
    return () => restore.current?.focus?.();
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="kk-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-kk="modal"
        data-overlay=""
        tabIndex={-1}
        className="kk-modal"
        style={{ width }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          } else if (e.key === "Tab") {
            const f = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
            if (f.length === 0) return;
            const first = f[0];
            const last = f[f.length - 1];
            if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="kk-modal__header">
          <span className="kk-modal__title">{title}</span>
          <button
            type="button"
            className="kk-iconbtn kk-iconbtn--sm kk-iconbtn--ghost"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
        <div className="kk-modal__body">{children}</div>
        {footer && <div className="kk-modal__footer">{footer}</div>}
      </div>
    </div>,
    root,
  );
}

/* ── Toast ───────────────────────────────────────────────────────────── */
type ToastKind = "info" | "success" | "warning" | "danger";
interface ToastItem {
  id: number;
  title: string;
  description?: string;
  kind: ToastKind;
}

interface ToastState {
  items: ToastItem[];
  push: (t: Omit<ToastItem, "id" | "kind"> & { kind?: ToastKind; duration?: number }) => number;
  dismiss: (id: number) => void;
}

let toastId = 1;
const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: ({ duration = 3600, kind = "info", ...t }) => {
    const id = toastId++;
    set((s) => ({ items: [...s.items.slice(-4), { ...t, kind, id }] }));
    if (duration > 0) window.setTimeout(() => get().dismiss(id), duration);
    return id;
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));

/** Imperative toast API: `toast.show({ title: "Saved", kind: "success" })`. */
export const toast = {
  show: (t: Parameters<ToastState["push"]>[0]) => useToasts.getState().push(t),
  dismiss: (id: number) => useToasts.getState().dismiss(id),
};

export function ToastHost() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  const root = useOverlayRoot();
  return createPortal(
    <div className="kk-toasts" aria-live="polite" data-kk="toast-host">
      {items.map((t) => (
        <div key={t.id} role="status" className={cx("kk-toast", `kk-toast--${t.kind}`)} data-kk="toast">
          <div className="kk-toast__bar" />
          <div className="kk-toast__text">
            <div className="kk-toast__title">{t.title}</div>
            {t.description && <div className="kk-toast__desc">{t.description}</div>}
          </div>
          <button type="button" className="kk-toast__close" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>,
    root,
  );
}
