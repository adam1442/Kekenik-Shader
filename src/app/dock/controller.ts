import type { DockviewApi, DockviewGroupPanel } from "dockview";
import { create } from "zustand";
import { storage } from "../lib/storage";
import { addPanelWithPlacement, applyLayout, defaultLayoutSpec, listPresets } from "./layouts";
import { getPanelDef, panelIds } from "./panelRegistry";
import { restoreLayout, serializeLayout, validateLayout, type SavedLayout } from "./serialization";

/**
 * Dock controller: the only module that talks to the dockview API from the rest of the app.
 * Menus, commands, tabs and context menus call these functions; UI reads `useDockState`.
 */
export interface CustomLayout {
  id: string;
  name: string;
  layout: SavedLayout;
}

interface DockState {
  ready: boolean;
  openIds: string[];
  floatingIds: string[];
  customLayouts: Array<{ id: string; name: string }>;
}

export const useDockState = create<DockState>(() => ({
  ready: false,
  openIds: [],
  floatingIds: [],
  customLayouts: [],
}));

const KEY_CURRENT = "layout.current";
const KEY_CUSTOM = "layout.custom";
const PERSIST_DEBOUNCE_MS = 350;

let api: DockviewApi | null = null;
let disposers: Array<() => void> = [];
let persistTimer: number | undefined;

export function getDockApi(): DockviewApi | null {
  return api;
}

function loadCustom(): CustomLayout[] {
  const raw = storage.getJSON<CustomLayout[]>(KEY_CUSTOM);
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (c) => c && typeof c.id === "string" && typeof c.name === "string" && validateLayout(c.layout, panelIds()),
  );
}

function refresh(): void {
  if (!api) return;
  const openIds = api.panels.map((p) => p.id);
  const floatingIds = api.panels.filter((p) => p.group.api.location.type === "floating").map((p) => p.id);
  const customLayouts = loadCustom().map((c) => ({ id: c.id, name: c.name }));
  useDockState.setState({ ready: true, openIds, floatingIds, customLayouts });
}

function persistLayoutNow(): void {
  if (!api) return;
  window.clearTimeout(persistTimer);
  try {
    storage.setJSON(KEY_CURRENT, serializeLayout(api));
  } catch {
    /* storage failures never break the app */
  }
}

function schedulePersist(): void {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(persistLayoutNow, PERSIST_DEBOUNCE_MS);
}

/** Connect a dockview instance: restore the persisted layout (or default) and start persisting changes. */
export function attachDock(next: DockviewApi): void {
  detachDock();
  api = next;
  const fallback = () => applyLayout(next, defaultLayoutSpec());
  restoreLayout(next, storage.getJSON(KEY_CURRENT), panelIds(), fallback);
  const onChange = () => {
    refresh();
    schedulePersist();
  };
  disposers = [
    next.onDidLayoutChange(onChange).dispose,
    next.onDidAddPanel(refresh).dispose,
    next.onDidRemovePanel(refresh).dispose,
  ];
  refresh();
}

export function detachDock(): void {
  window.clearTimeout(persistTimer);
  disposers.forEach((d) => d());
  disposers = [];
  api = null;
  useDockState.setState({ ready: false, openIds: [], floatingIds: [] });
}

/* ── Panels ──────────────────────────────────────────────────────────── */
export function isPanelOpen(id: string): boolean {
  return !!api?.getPanel(id);
}

export function isPanelFloating(id: string): boolean {
  return api?.getPanel(id)?.group.api.location.type === "floating";
}

export function openPanel(id: string): void {
  if (!api) return;
  const def = getPanelDef(id);
  if (!def) return;
  if (!api.getPanel(id)) addPanelWithPlacement(api, id, def.defaultPlacement);
  api.getPanel(id)?.api.setActive();
  refresh();
}

export function closePanel(id: string): boolean {
  if (!api || getPanelDef(id)?.closable === false) return false;
  const p = api.getPanel(id);
  if (!p) return false;
  p.api.close();
  return true;
}

export function togglePanel(id: string): void {
  if (isPanelOpen(id)) closePanel(id);
  else openPanel(id);
}

export function toggleMaximize(id: string): void {
  const p = api?.getPanel(id);
  if (!p) return;
  if (p.api.isMaximized()) p.api.exitMaximized();
  else p.api.maximize();
}

/** Move a docked panel into a floating window. */
export function floatPanel(id: string, target: DockviewApi | null = api): void {
  const api = target;
  if (!api) return;
  const p = api.getPanel(id);
  if (!p || p.group.api.location.type === "floating") return;
  const def = getPanelDef(id);
  const n = api.groups.filter((g) => g.api.location.type === "floating").length;
  const w = def?.defaultPlacement.floating?.width ?? 380;
  const h = def?.defaultPlacement.floating?.height ?? 300;
  const x = Math.max(8, Math.min((api.width - w) / 2 + n * 28, api.width - w - 8));
  const y = Math.max(8, Math.min((api.height - h) / 3 + n * 28, api.height - h - 8));
  api.addFloatingGroup(p, { x, y, width: w, height: h });
}

function dockTargetGroup(api: DockviewApi, id: string): DockviewGroupPanel | undefined {
  const isDocked = (pid?: string) => {
    const g = pid ? api.getPanel(pid)?.group : undefined;
    return g && g.api.location.type === "grid" ? g : undefined;
  };
  return (
    isDocked(getPanelDef(id)?.defaultPlacement.ref) ??
    isDocked("graph") ??
    api.groups.find((g) => g.api.location.type === "grid")
  );
}

/** Move a floating panel back into the docked grid (next to its default reference). */
export function dockPanel(id: string, targetApi: DockviewApi | null = api): void {
  const api = targetApi;
  if (!api) return;
  const p = api.getPanel(id);
  if (!p || p.group.api.location.type !== "floating") return;
  const target = dockTargetGroup(api, id);
  if (target) p.api.moveTo({ group: target, position: "center" });
}

export function dockGroupPanels(group: DockviewGroupPanel): void {
  [...group.panels].forEach((p) => dockPanel(p.id));
}

/** Programmatically set a floating group's bounds (px, relative to the dock container). */
export function setFloatingBounds(
  group: DockviewGroupPanel,
  b: { left: number; top: number; width: number; height: number },
  targetApi: DockviewApi | null = api,
): boolean {
  const comp = (
    targetApi as unknown as {
      component?: { floatingGroups?: Array<{ group: DockviewGroupPanel; position: (b: unknown) => void }> };
    } | null
  )?.component;
  const fg = comp?.floatingGroups?.find((f) => f.group === group);
  if (!fg) return false;
  fg.position(b);
  return true;
}

/* ── Layouts ─────────────────────────────────────────────────────────── */
export function applyPreset(id: string): boolean {
  if (!api) return false;
  const spec = listPresets().find((p) => p.id === id);
  if (!spec) return false;
  applyLayout(api, spec);
  persistLayoutNow();
  refresh();
  return true;
}

export function resetLayout(): void {
  applyPreset("default");
}

export function saveCustomLayout(name: string): CustomLayout | null {
  if (!api) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  const list = loadCustom();
  const entry: CustomLayout = { id: `custom-${Date.now().toString(36)}`, name: trimmed, layout: serializeLayout(api) };
  storage.setJSON(KEY_CUSTOM, [...list, entry]);
  refresh();
  return entry;
}

export function applyCustomLayout(id: string): boolean {
  if (!api) return false;
  const entry = loadCustom().find((c) => c.id === id);
  if (!entry) return false;
  const a = api;
  const res = restoreLayout(a, entry.layout, panelIds(), () => applyLayout(a, defaultLayoutSpec()));
  persistLayoutNow();
  refresh();
  return res.ok;
}

export function deleteCustomLayout(id: string): void {
  storage.setJSON(
    KEY_CUSTOM,
    loadCustom().filter((c) => c.id !== id),
  );
  refresh();
}
