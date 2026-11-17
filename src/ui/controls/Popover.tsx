import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "../util/cx";
import { useOverlayRoot } from "../overlay/overlayRoot";
import { placePopover, type PopoverPlacement } from "./popoverPlacement";

/** Nested popover bookkeeping: id → parent id, and the open stack (top-most last). */
const parentOf = new Map<string, string | null>();
const stack: string[] = [];
const PopoverLevel = createContext<string | null>(null);

function isWithin(target: Element | null, id: string): boolean {
  let el = target?.closest("[data-popover-id]") ?? null;
  while (el) {
    const eid = el.getAttribute("data-popover-id")!;
    if (eid === id) return true;
    const p = parentOf.get(eid);
    el = p ? document.querySelector(`[data-popover-id="${CSS.escape(p)}"]`) : null;
    if (!p) break;
  }
  return false;
}

const FOCUSABLE =
  'button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

export interface PopoverProps {
  open: boolean;
  /** Element (or rect source) the popover is anchored to. */
  anchor: HTMLElement | null;
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end";
  prefer?: "bottom" | "top";
  width?: number;
  ariaLabel?: string;
  className?: string;
  /** Focus the first focusable child on open (default true). */
  autoFocus?: boolean;
  /** Keep Tab inside the popover (default true). */
  trapFocus?: boolean;
}

/**
 * Portal popover: anchored with flip/shift, focus-trapped, Esc / outside-click close, nestable
 * (a popover opened from inside another popover is a child: clicks in it never close the parent, Esc closes the top-most only).
 */
export function Popover({
  open,
  anchor,
  onClose,
  children,
  align = "start",
  prefer = "bottom",
  width,
  ariaLabel,
  className,
  autoFocus = true,
  trapFocus = true,
}: PopoverProps) {
  const id = useId();
  const root = useOverlayRoot();
  const parent = useContext(PopoverLevel);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<PopoverPlacement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useLayoutEffect(() => {
    if (!open) return;
    parentOf.set(id, parent);
    stack.push(id);
    return () => {
      parentOf.delete(id);
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open, id, parent]);

  // Measure → place (re-run on resize/scroll and when content size changes).
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const el = ref.current;
    if (!el) return;
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const s = { width: el.offsetWidth, height: el.scrollHeight || el.offsetHeight };
      setPos(placePopover(r, s, { width: window.innerWidth, height: window.innerHeight }, { align, prefer }));
    };
    place();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    ro?.observe(el);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, align, prefer]);

  // Dismiss + focus management.
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const onDown = (e: Event) => {
      const t = e.target as Element | null;
      if (isWithin(t, id)) return;
      if (anchor && t && anchor.contains(t)) return; // the trigger toggles on click
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && stack[stack.length - 1] === id) {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key === "Tab" && trapFocus && stack[stack.length - 1] === id) {
        const root = ref.current;
        if (!root) return;
        const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (x) => x.offsetParent !== null || x === document.activeElement,
        );
        if (items.length === 0) {
          e.preventDefault();
          root.focus();
          return;
        }
        const first = items[0]!;
        const last = items[items.length - 1]!;
        const act = document.activeElement;
        if (e.shiftKey && (act === first || act === root)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && act === last) {
          e.preventDefault();
          first.focus();
        } else if (!root.contains(act)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    };
  }, [open, id, anchor, trapFocus]);

  // Autofocus only once the popover is placed (it is `visibility:hidden` until then, and hidden elements cannot take focus).
  const placed = pos !== null;
  useEffect(() => {
    if (!open || !placed || !autoFocus) return;
    const root = ref.current;
    const first = root?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? root)?.focus({ preventScroll: true });
  }, [open, placed, autoFocus]);

  if (!open) return null;
  return createPortal(
    <PopoverLevel.Provider value={id}>
      <div
        ref={ref}
        data-popover-id={id}
        data-kk="popover"
        data-overlay=""
        data-no-pan=""
        data-side={pos?.side}
        role="dialog"
        aria-label={ariaLabel}
        tabIndex={-1}
        className={cx("kk-popover", className)}
        style={{
          left: pos?.left ?? 0,
          top: pos?.top ?? 0,
          width,
          maxHeight: pos?.maxHeight,
          visibility: pos ? "visible" : "hidden",
        }}
        // React bubbles synthetic events through portals to the owning control: keep popover interaction out of
        // parent handlers (graph-canvas pan/select, dockview, global shortcuts while typing).
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Escape" && e.key !== "Tab") e.stopPropagation();
        }}
      >
        {children}
      </div>
    </PopoverLevel.Provider>,
    root,
  );
}
