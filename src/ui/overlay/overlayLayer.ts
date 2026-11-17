/**
 * Shared overlay layer stack .
 *
 * ONE set of window listeners serves every open overlay (installed when the first layer opens, removed when the last one closes),
 * so opening / closing an overlay hundreds of times can never leak a listener (`overlayListenerCount()` is asserted by a test).
 *
 * Responsibilities
 *  - Esc closes ONLY the top-most layer (the key is consumed so nothing underneath reacts).
 *  - pointer-down / context-menu outside the top-most layer closes it; optionally the press is consumed (`consumeOutside`) so it cannot
 *    start a box-select / create a node on the canvas underneath.
 *  - window blur closes the top-most layer; `closeOnWheelOutside` closes it when the user zooms / pans the canvas behind it.
 *  - Layers mark their root with `data-overlay` — the canvas wheel handler ignores such targets (see `isOverlayTarget`), so the wheel
 *    scrolls the overlay instead of zooming the graph.
 */

export interface OverlayLayerOptions {
  /** Called when the layer must close (Esc / outside press / blur / outside wheel). The owner removes the DOM. */
  onClose: () => void;
  /** Return true to swallow an outside pointer-down (it closes the layer but does nothing else). Default: let it through. */
  consumeOutside?: (target: Element) => boolean;
  /** Close when a wheel event happens outside every overlay (e.g. the canvas is zoomed behind a popup). Default false. */
  closeOnWheelOutside?: boolean;
}

interface Layer extends OverlayLayerOptions {
  el: HTMLElement;
}

const stack: Layer[] = [];
let installed = 0;

const OVERLAY_SELECTOR = "[data-overlay],[data-no-zoom]";

/** True when the event target sits inside an overlay (popup, menu, dialog, tooltip…) or an explicitly no-zoom region. */
export const isOverlayTarget = (t: EventTarget | null): boolean =>
  t instanceof Element && !!t.closest(OVERLAY_SELECTOR);

const top = (): Layer | undefined => stack[stack.length - 1];
const targetOf = (e: Event): Element | null => (e.target instanceof Element ? e.target : null);

const onKey = (e: KeyboardEvent): void => {
  if (e.key !== "Escape" || e.isComposing) return;
  const l = top();
  if (!l) return;
  e.preventDefault();
  e.stopPropagation();
  l.onClose();
};

const onDown = (e: Event): void => {
  const l = top();
  const t = targetOf(e);
  if (!l || !t || l.el.contains(t)) return;
  const consume = e.type === "pointerdown" && l.consumeOutside?.(t);
  if (consume) {
    e.stopPropagation();
    e.preventDefault();
  }
  l.onClose();
};

const onBlur = (): void => top()?.onClose();

const onWheel = (e: Event): void => {
  const l = top();
  if (!l?.closeOnWheelOutside || isOverlayTarget(e.target)) return;
  const t = targetOf(e);
  if (t && !l.el.contains(t)) l.onClose();
};

function install(): void {
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("contextmenu", onDown, true);
  window.addEventListener("blur", onBlur);
  window.addEventListener("wheel", onWheel, { capture: true, passive: true });
  installed++;
}

function uninstall(): void {
  window.removeEventListener("keydown", onKey, true);
  window.removeEventListener("pointerdown", onDown, true);
  window.removeEventListener("contextmenu", onDown, true);
  window.removeEventListener("blur", onBlur);
  window.removeEventListener("wheel", onWheel, true);
  installed--;
}

/** Register a layer; returns the unregister function. Idempotent per call. */
export function pushOverlayLayer(el: HTMLElement, opts: OverlayLayerOptions): () => void {
  const layer: Layer = { ...opts, el };
  if (stack.length === 0) install();
  stack.push(layer);
  el.setAttribute("data-overlay", "");
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const i = stack.indexOf(layer);
    if (i >= 0) stack.splice(i, 1);
    if (stack.length === 0 && installed > 0) uninstall();
  };
}

/** Number of open layers (test hook). */
export const overlayDepth = (): number => stack.length;
/** Number of global listener sets currently installed by the layer stack: 0 when idle, 1 when any layer is open (test hook). */
export const overlayListenerCount = (): number => installed;
/** Number of window listeners this module has installed (5 per set) — test hook. */
export const OVERLAY_LISTENERS_PER_SET = 5;
