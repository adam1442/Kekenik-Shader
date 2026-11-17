import { type RefObject, useEffect, useRef } from "react";
import { type OverlayLayerOptions, pushOverlayLayer } from "./overlayLayer";

/**
 * Register `ref.current` as an overlay layer while mounted (and `active`): Esc / outside press / blur close it, the wheel over it never
 * zooms the graph (it gets `data-overlay`). The callbacks are read through a ref, so they may change every render without re-registering.
 */
export function useOverlayLayer(ref: RefObject<HTMLElement | null>, opts: OverlayLayerOptions, active = true): void {
  const o = useRef(opts);
  o.current = opts;
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    return pushOverlayLayer(el, {
      onClose: () => o.current.onClose(),
      consumeOutside: (t) => o.current.consumeOutside?.(t) ?? false,
      closeOnWheelOutside: o.current.closeOnWheelOutside,
    });
  }, [ref, active]);
}
