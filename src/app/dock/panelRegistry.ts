import type { ComponentType } from "react";
import type { IconType } from "@/ui";

/**
 * Panel registry. Later agents call `registerPanel` to replace a placeholder panel body
 * (re-registering the same id replaces it) or to add new panels.
 */
export interface PanelProps {
  panelId: string;
}

export interface PanelPlacement {
  /** Panel id this one is positioned relative to. */
  ref?: string;
  direction?: "within" | "left" | "right" | "above" | "below";
  width?: number;
  height?: number;
  floating?: { x: number; y: number; width: number; height: number };
  /** Added as a background tab rather than the active one. */
  inactive?: boolean;
}

export interface PanelDef {
  id: string;
  title: string;
  icon: IconType;
  component: ComponentType<PanelProps>;
  defaultPlacement: PanelPlacement;
  /** The panel's tab has no close button and "Close" is disabled (the Graph). */
  closable?: boolean;
  /**
   * Whether the Default layout opens this panel. `false` = on-demand panel (Window menu / command / button opens it at
   * `defaultPlacement`). Default `true`. Without this, a panel whose placement is a floating window (Sample Browser) opened
   * as a 900×600 window on top of the app at every start.
   */
  defaultOpen?: boolean;
}

const panels = new Map<string, PanelDef>();

export function registerPanel(def: PanelDef): () => void {
  panels.set(def.id, def);
  return () => {
    if (panels.get(def.id) === def) panels.delete(def.id);
  };
}

export function getPanelDef(id: string): PanelDef | undefined {
  return panels.get(id);
}

/** Panels in registration order. */
export function listPanelDefs(): PanelDef[] {
  return Array.from(panels.values());
}

export function panelIds(): Set<string> {
  return new Set(panels.keys());
}
