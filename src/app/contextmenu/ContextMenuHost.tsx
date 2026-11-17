import { useEffect, useMemo } from "react";
import { create } from "zustand";
import { MenuPanel, useDismiss, type MenuItem } from "@/ui";
import { resolveContextMenu } from "./registry";

interface CtxState {
  open: { items: MenuItem[]; x: number; y: number; scopes: string[]; token: number } | null;
  show: (items: MenuItem[], x: number, y: number, scopes: string[]) => void;
  close: () => void;
}

let token = 0;
let restoreTo: HTMLElement | null = null;

const useContextMenuState = create<CtxState>((set) => ({
  open: null,
  show: (items, x, y, scopes) => set({ open: { items, x, y, scopes, token: ++token } }),
  close: () => set({ open: null }),
}));

/** Programmatically open a context menu at a point (used by keyboard "Menu" key and tests). */
export function openContextMenuAt(items: MenuItem[], x: number, y: number, scopes: string[] = ["manual"]): void {
  restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  useContextMenuState.getState().show(items, x, y, scopes);
}

function closeContextMenu(): void {
  const wasOpen = useContextMenuState.getState().open !== null;
  useContextMenuState.getState().close();
  if (wasOpen && restoreTo) {
    const el = restoreTo;
    restoreTo = null;
    queueMicrotask(() => {
      const a = document.activeElement;
      if ((!a || a === document.body) && el.isConnected) el.focus({ preventScroll: true });
    });
  }
}

/**
 * Global right-click handler + renderer. Mount once at the app root.
 * Native menu is suppressed ONLY when a registered scope handles the click.
 * Shift+right-click always lets the native menu through (developer escape hatch).
 */
export function ContextMenuHost() {
  const open = useContextMenuState((s) => s.open);

  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      if (e.shiftKey && !e.ctrlKey) return;
      const target = e.target instanceof Element ? e.target : null;
      if (!target) return;
      if (target.closest("[data-menu-panel]")) {
        e.preventDefault();
        return;
      }
      let resolved;
      try {
        resolved = resolveContextMenu(target, e);
      } catch (err) {
        console.error("[Kekenik Shader] context menu provider failed", err);
        e.preventDefault();
        return;
      }
      if (!resolved) {
        closeContextMenu();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (resolved.items.length === 0) {
        closeContextMenu();
        return;
      }
      openContextMenuAt(resolved.items, e.clientX, e.clientY, resolved.scopes);
    };
    document.addEventListener("contextmenu", onContext, true);
    return () => document.removeEventListener("contextmenu", onContext, true);
  }, []);

  useDismiss(open !== null, closeContextMenu);

  const placement = useMemo(() => (open ? ({ kind: "point", x: open.x, y: open.y } as const) : null), [open]);
  if (!open || !placement) return null;
  return (
    <div data-ctx-host="" data-ctx-scopes={open.scopes.join(",")} style={{ display: "contents" }}>
      <MenuPanel
        key={open.token}
        items={open.items}
        placement={placement}
        onClose={closeContextMenu}
        ariaLabel="Context menu"
      />
    </div>
  );
}
