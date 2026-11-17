import { DockviewReact, type DockviewApi, type DockviewReadyEvent } from "dockview";
import "dockview/dist/styles/dockview.css";
import { useMemo } from "react";
import { createPanelComponent, DockWatermark, GroupActions, KkTab } from "./DockParts";
import { listPanelDefs, type PanelDef } from "./panelRegistry";

export interface DockHostProps {
  onReady: (api: DockviewApi) => void;
  /** Panels to host; defaults to everything in the panel registry. */
  panels?: Array<Pick<PanelDef, "id" | "title" | "component">>;
  className?: string;
}

/** The dockview instance with Kekenik theme, custom tabs, group actions and viewport-clamped floating windows. */
export function DockHost({ onReady, panels, className }: DockHostProps) {
  const components = useMemo(() => {
    const out: Record<string, ReturnType<typeof createPanelComponent>> = {};
    for (const d of panels ?? listPanelDefs()) out[d.id] = createPanelComponent(d);
    return out;
    // panels list is fixed at mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <DockviewReact
      className={`dockview-theme-kk ${className ?? ""}`}
      components={components}
      defaultTabComponent={KkTab}
      rightHeaderActionsComponent={GroupActions}
      watermarkComponent={DockWatermark}
      floatingGroupBounds="boundedWithinViewport"
      onReady={(e: DockviewReadyEvent) => onReady(e.api)}
    />
  );
}
