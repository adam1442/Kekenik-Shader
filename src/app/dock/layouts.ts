import type { DockviewApi } from "dockview";
import { getPanelDef, listPanelDefs, type PanelDef, type PanelPlacement } from "./panelRegistry";

/** A declarative layout: panels are added in order; panels not listed stay closed. */
export interface LayoutSpec {
  id: string;
  name: string;
  panels: Array<{ id: string } & PanelPlacement>;
}

/** Add one panel to the dock using a placement. Falls back to floating if its reference is missing. */
export function addPanelWithPlacement(api: DockviewApi, id: string, placement: PanelPlacement): boolean {
  const def = getPanelDef(id);
  if (!def || api.getPanel(id)) return false;
  const base = {
    id,
    component: id,
    title: def.title,
    inactive: placement.inactive,
    initialWidth: placement.width,
    initialHeight: placement.height,
  };
  const refOk = placement.ref && api.getPanel(placement.ref);
  if (placement.floating) {
    api.addPanel({ ...base, floating: placement.floating });
  } else if (refOk) {
    api.addPanel({ ...base, position: { referencePanel: placement.ref!, direction: placement.direction ?? "within" } });
  } else if (api.panels.length === 0) {
    api.addPanel(base);
  } else {
    // reference not available → open as a floating window near the top-left of the work area
    const w = placement.width ?? 360;
    const h = placement.height ?? 280;
    api.addPanel({ ...base, floating: { x: 80, y: 60, width: w, height: h } });
  }
  return true;
}

/** Replace the current layout with `spec`. */
export function applyLayout(api: DockviewApi, spec: LayoutSpec): void {
  api.clear();
  for (const p of spec.panels) {
    const { id, ...placement } = p;
    addPanelWithPlacement(api, id, placement);
  }
  api.getPanel("graph")?.api.setActive();
}

/** The registered panels the Default layout opens (registration order): every panel except on-demand ones (`defaultOpen: false`). */
const defaultPanelDefs = (): PanelDef[] => listPanelDefs().filter((d) => d.defaultOpen !== false);

/** Default layout derived from the default-open panels' defaultPlacement (registration order). */
export function defaultLayoutSpec(): LayoutSpec {
  return {
    id: "default",
    name: "Default",
    panels: defaultPanelDefs().map((d) => ({ id: d.id, ...d.defaultPlacement })),
  };
}

const PRESET_LAYOUTS: Array<() => LayoutSpec> = [
  defaultLayoutSpec,
  () => ({
    id: "graph-focus",
    name: "Graph Focus",
    panels: [
      { id: "graph" },
      { id: "library", ref: "graph", direction: "left", width: 220 },
      { id: "inspector", ref: "graph", direction: "right", width: 280 },
      { id: "blackboard", ref: "inspector", direction: "within", inactive: true },
      { id: "material", ref: "inspector", direction: "within", inactive: true },
      { id: "preview", floating: { x: 520, y: 380, width: 380, height: 280 } },
    ],
  }),
  () => ({
    id: "preview-focus",
    name: "Preview Focus",
    panels: [
      { id: "preview" },
      { id: "inspector", ref: "preview", direction: "right", width: 300 },
      { id: "blackboard", ref: "inspector", direction: "within", inactive: true },
      { id: "material", ref: "inspector", direction: "within" },
      { id: "graph", ref: "preview", direction: "below", height: 300 },
      { id: "library", ref: "graph", direction: "left", width: 220 },
    ],
  }),
  () => ({
    id: "code-focus",
    name: "Code Focus",
    panels: [
      { id: "graph" },
      { id: "code", ref: "graph", direction: "right", width: 560 },
      { id: "problems", ref: "code", direction: "below", height: 200 },
      { id: "inspector", ref: "graph", direction: "left", width: 260 },
    ],
  }),
];

export function listPresets(): LayoutSpec[] {
  return PRESET_LAYOUTS.map((f) => f());
}
