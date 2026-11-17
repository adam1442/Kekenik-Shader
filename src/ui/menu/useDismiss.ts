import { useEffect, useRef } from "react";

/**
 * Close a menu tree on: pointerdown outside, window blur, resize, or scroll outside a menu.
 * Elements inside `[data-menu-panel]` or `[data-menu-trigger]` never dismiss.
 */
export function useDismiss(active: boolean, onDismiss: () => void): void {
  const cb = useRef(onDismiss);
  cb.current = onDismiss;
  useEffect(() => {
    if (!active) return;
    const inside = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest("[data-menu-panel],[data-menu-trigger]");
    const onDown = (e: Event) => {
      if (!inside(e.target)) cb.current();
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) cb.current();
    };
    const onClose = () => cb.current();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("wheel", onScroll, { capture: true, passive: true });
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("wheel", onScroll, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [active]);
}
