import { useLayoutEffect, useRef, type RefObject } from "react";
import type { MenuItem } from "../menu/types";

/**
 * Control ↔ context-menu bridge. Each control root carries `data-ctx-scope="control.<kind>"`; the generic provider
 * (app/contextmenu/controls.ts) finds the bridge of the scope element through this WeakMap and builds
 * Copy value / Paste value / Reset to default / Copy as JSON + control-specific items.
 */
export interface ControlBridge {
  kind: string;
  /** Plain-text copy (what "Copy value" puts on the clipboard). */
  copyText(): string;
  /** JSON copy ("Copy as JSON"). */
  copyJson(): string;
  /** Apply pasted text; return false when it cannot be parsed. */
  paste?: (text: string) => boolean;
  reset?: () => void;
  canReset?: () => boolean;
  disabled?: boolean;
  readOnly?: boolean;
  /** Control-specific extra items (appended after a separator). */
  extra?: () => MenuItem[];
}

const bridges = new WeakMap<Element, ControlBridge>();

export function getBridge(el: Element): ControlBridge | undefined {
  return bridges.get(el);
}

/**
 * Attach a bridge to a control root. Spread `props` on the root element and pass `ref`.
 * The bridge reads the latest closure on every call, so it never goes stale.
 */
export function useBridge<E extends HTMLElement = HTMLDivElement>(
  bridge: ControlBridge,
  scope = `control.${bridge.kind}`,
): { ref: RefObject<E>; props: { "data-ctx-scope": string } } {
  const ref = useRef<E>(null);
  const latest = useRef(bridge);
  latest.current = bridge;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const proxy: ControlBridge = {
      get kind() {
        return latest.current.kind;
      },
      copyText: () => latest.current.copyText(),
      copyJson: () => latest.current.copyJson(),
      paste: (t) => latest.current.paste?.(t) ?? false,
      reset: () => latest.current.reset?.(),
      canReset: () => latest.current.canReset?.() ?? false,
      get disabled() {
        return latest.current.disabled;
      },
      get readOnly() {
        return latest.current.readOnly;
      },
      extra: () => latest.current.extra?.() ?? [],
    };
    // `paste`/`reset` presence matters to the menu: expose them only when the control provides them.
    Object.defineProperty(proxy, "paste", {
      value: (t: string) => latest.current.paste?.(t) ?? false,
      enumerable: true,
    });
    bridges.set(el, proxy);
    return () => {
      bridges.delete(el);
    };
  }, []);
  return { ref, props: { "data-ctx-scope": scope } };
}
