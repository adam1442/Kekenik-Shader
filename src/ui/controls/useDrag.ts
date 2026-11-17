/**
 * Unified drag gesture used by every pointer-driven control (scrub, sliders, pads, curve/gradient editors).
 *  - listens on `window` (works with real pointer capture AND synthetic test events),
 *  - optional 3 px threshold, optional Pointer Lock for infinite scrubbing (falls back to clientX deltas),
 *  - Esc cancels the gesture,
 *  - calls `onEnd` exactly once.
 */
interface DragPoint {
  clientX: number;
  clientY: number;
  /** Incremental movement since the previous event (pointer-lock aware). */
  dx: number;
  dy: number;
  /** Total movement from the gesture start (uses client coordinates; not reliable while locked). */
  totalDx: number;
  totalDy: number;
  locked: boolean;
  event: PointerEvent;
}

export interface DragOptions {
  /** Pixels before the gesture "activates" (default 0). */
  threshold?: number;
  /** Request pointer lock on this element once active (mouse only). */
  lockElement?: Element | null;
  /** Body class while active (e.g. "kk-scrubbing"). */
  bodyClass?: string;
  /** Called once when the gesture activates (threshold crossed). Return false to abort. */
  onStart?: () => void | false;
  onMove: (p: DragPoint) => void;
  /** `active` is false when the pointer was released before the threshold (a plain click). */
  onEnd?: (info: { active: boolean; cancelled: boolean; event: Event | null }) => void;
}

export interface DragStart {
  clientX: number;
  clientY: number;
  pointerId?: number;
  pointerType?: string;
  /** Only trusted (real) events may request pointer lock — synthetic test events never do. */
  isTrusted?: boolean;
  target?: EventTarget | null;
}

export function beginDrag(start: DragStart, o: DragOptions): () => void {
  let active = false;
  let done = false;
  let lastX = start.clientX;
  let lastY = start.clientY;
  const threshold = o.threshold ?? 0;
  const t = start.target as
    | (Element & { setPointerCapture?: (id: number) => void; releasePointerCapture?: (id: number) => void })
    | null
    | undefined;
  try {
    if (t && start.pointerId !== undefined && t.setPointerCapture) t.setPointerCapture(start.pointerId);
  } catch {
    /* synthetic events have no active pointer */
  }

  const isLocked = () => !!o.lockElement && document.pointerLockElement === o.lockElement;

  const activate = (): boolean => {
    active = true;
    if (o.onStart?.() === false) {
      finish(true, null);
      return false;
    }
    if (o.bodyClass) document.body.classList.add(o.bodyClass);
    if (o.lockElement && start.pointerType === "mouse" && start.isTrusted === true) {
      try {
        const r = (o.lockElement as Element & { requestPointerLock?: () => unknown }).requestPointerLock?.();
        if (r && typeof (r as Promise<void>).catch === "function") (r as Promise<void>).catch(() => undefined);
      } catch {
        /* lock unavailable → clientX fallback */
      }
    }
    return true;
  };

  const move = (ev: PointerEvent) => {
    if (done) return;
    const totalDx = ev.clientX - start.clientX;
    const totalDy = ev.clientY - start.clientY;
    if (!active) {
      if (Math.hypot(totalDx, totalDy) < threshold) return;
      lastX = start.clientX; // include the movement that crossed the threshold
      lastY = start.clientY;
      if (!activate()) return;
    }
    const locked = isLocked();
    const dx = locked ? ev.movementX || 0 : ev.clientX - lastX;
    const dy = locked ? ev.movementY || 0 : ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    o.onMove({ clientX: ev.clientX, clientY: ev.clientY, dx, dy, totalDx, totalDy, locked, event: ev });
  };
  const up = (ev: Event) => finish(false, ev);
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && active) {
      ev.preventDefault();
      ev.stopPropagation();
      finish(true, ev);
    }
  };

  function finish(cancelled: boolean, event: Event | null) {
    if (done) return;
    done = true;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    window.removeEventListener("keydown", key, true);
    try {
      if (t && start.pointerId !== undefined && t.releasePointerCapture) t.releasePointerCapture(start.pointerId);
    } catch {
      /* already released */
    }
    if (o.bodyClass) document.body.classList.remove(o.bodyClass);
    if (isLocked()) {
      try {
        document.exitPointerLock();
      } catch {
        /* ignore */
      }
    }
    o.onEnd?.({ active, cancelled, event });
  }

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
  window.addEventListener("keydown", key, true);
  if (threshold <= 0) {
    active = false;
    // activate immediately so that onStart runs for slider-style controls
    if (!activate()) return () => undefined;
  }
  return () => finish(true, null);
}
