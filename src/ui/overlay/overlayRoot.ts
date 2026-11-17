import { createContext, useContext } from "react";

/**
 * Central overlay host .
 *
 * EVERY floating surface (Modal, Popover → Select / Combobox / colour / gradient / curve / levels editors, menus, tooltips, toasts) portals
 * into the element returned by `useOverlayRoot()` instead of `document.body`. Stacking is decided ONLY by the z-index tokens
 * (`--kk-z-modal < --kk-z-dropdown < --kk-z-menu < --kk-z-toast < --kk-z-tooltip`, see docs/DESIGN_TOKENS.md); the root itself is
 * `display: contents` and creates no stacking context, so those tokens compare globally.
 *
 * The app does not use native `<dialog>.showModal()` / the Popover API (no top layer), so one global root is always correct.
 * `OverlayHostContext` lets a future top-layer host (or a pop-out document) redirect its descendants' overlays to itself.
 */
const OVERLAY_ROOT_ID = "kk-overlay-root";

/** Host override for descendants (e.g. a top-layer element). `null` ⇒ the global root. */
const OverlayHostContext = createContext<HTMLElement | null>(null);

/** The global overlay root (created on demand, re-created if something removed it). */
function getOverlayRoot(): HTMLElement {
  let el = document.getElementById(OVERLAY_ROOT_ID);
  if (!el || !el.isConnected) {
    el = document.createElement("div");
    el.id = OVERLAY_ROOT_ID;
    el.className = "kk-overlay-root";
    document.body.appendChild(el);
  }
  return el;
}

/** The innermost active overlay host: the context override if any, else the global root. */
export function useOverlayRoot(): HTMLElement {
  return useContext(OverlayHostContext) ?? getOverlayRoot();
}
