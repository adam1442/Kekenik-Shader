import { AppWindow, Maximize2, Minimize2, PanelTop, X } from "lucide-react";
import type { IDockviewHeaderActionsProps, IDockviewPanelHeaderProps, IDockviewPanelProps } from "dockview";
import { useEffect, useState } from "react";
import { EmptyState, ErrorBoundary, IconButton } from "@/ui";
import { dockGroupPanels, floatPanel, toggleMaximize } from "./controller";
import { getPanelDef, type PanelDef } from "./panelRegistry";

/** Wrap a registered panel so it gets an error boundary and its own context-menu scope. */
export function createPanelComponent(def: Pick<PanelDef, "id" | "title" | "component">) {
  const Body = def.component;
  return function PanelFrame(_props: IDockviewPanelProps) {
    return (
      <ErrorBoundary name={def.title}>
        <div className="kk-panel-body" data-ctx-scope={`panel.${def.id}`} data-ctx-id={def.id} data-panel-id={def.id}>
          <Body panelId={def.id} />
        </div>
      </ErrorBoundary>
    );
  };
}

/** Custom tab: icon + title + close, double-click to maximize, middle-click to close, own ctx scope. */
export function KkTab({ api }: IDockviewPanelHeaderProps) {
  const [title, setTitle] = useState(api.title ?? api.id);
  useEffect(() => {
    const d = api.onDidTitleChange((e) => setTitle(e.title));
    return () => d.dispose();
  }, [api]);
  const def = getPanelDef(api.id);
  const Icon = def?.icon;
  const closable = def?.closable !== false;
  return (
    <div
      className="kk-tab-inner"
      data-ctx-scope="dock.tab"
      data-ctx-id={api.id}
      onDoubleClick={() => toggleMaximize(api.id)}
      onAuxClick={(e) => {
        if (e.button === 1 && closable) {
          e.preventDefault();
          api.close();
        }
      }}
    >
      {Icon && <Icon size={13} className="kk-tab-inner__icon" />}
      <span className="kk-tab-inner__title">{title}</span>
      {closable && (
        <button
          type="button"
          className="kk-tab-inner__close"
          aria-label={`Close ${title}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            api.close();
          }}
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

/** Right-hand group actions: float/dock + maximize. */
export function GroupActions({ group, containerApi, activePanel }: IDockviewHeaderActionsProps) {
  const [floating, setFloating] = useState(group.api.location.type === "floating");
  const [maximized, setMaximized] = useState(group.api.isMaximized());
  useEffect(() => {
    const a = group.api.onDidLocationChange(() => setFloating(group.api.location.type === "floating"));
    const b = containerApi.onDidMaximizedGroupChange(() => setMaximized(group.api.isMaximized()));
    return () => {
      a.dispose();
      b.dispose();
    };
  }, [group, containerApi]);
  if (!activePanel) return null;
  return (
    <div className="kk-group-actions">
      <IconButton
        size="sm"
        icon={floating ? PanelTop : AppWindow}
        label={floating ? "Dock window" : "Float panel"}
        onClick={() => (floating ? dockGroupPanels(group) : floatPanel(activePanel.id))}
      />
      <IconButton
        size="sm"
        icon={maximized ? Minimize2 : Maximize2}
        label={maximized ? "Restore" : "Maximize"}
        onClick={() => toggleMaximize(activePanel.id)}
      />
    </div>
  );
}

/** Shown when every panel has been closed. */
export function DockWatermark() {
  return (
    <div className="kk-panel-body" data-ctx-scope="dock.root">
      <EmptyState
        icon={AppWindow}
        title="No panels open"
        description="Open panels from the Window menu, or choose View → Layout → Reset layout."
      />
    </div>
  );
}
