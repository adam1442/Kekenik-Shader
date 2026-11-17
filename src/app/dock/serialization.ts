import type { DockviewApi, SerializedDockview } from "dockview";

/**
 * Versioned layout (de)serialization.
 * Bump LAYOUT_VERSION whenever the panel set or semantics change in an incompatible way:
 * older saved layouts are then ignored and the default layout is used instead.
 */
const LAYOUT_VERSION = 1;
const LAYOUT_APP = "kekenik-shader";

export interface SavedLayout {
  version: number;
  app: typeof LAYOUT_APP;
  dock: SerializedDockview;
}

export function serializeLayout(api: DockviewApi): SavedLayout {
  return { version: LAYOUT_VERSION, app: LAYOUT_APP, dock: api.toJSON() };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Structural validation. Returns null (never throws) for anything unusable. */
export function validateLayout(raw: unknown, knownPanelIds: ReadonlySet<string>): SavedLayout | null {
  try {
    if (!isObj(raw) || raw.version !== LAYOUT_VERSION || raw.app !== LAYOUT_APP) return null;
    const dock = raw.dock;
    if (!isObj(dock)) return null;
    const grid = dock.grid;
    if (!isObj(grid) || !isObj(grid.root) || typeof grid.width !== "number" || typeof grid.height !== "number")
      return null;
    if (grid.orientation !== "HORIZONTAL" && grid.orientation !== "VERTICAL") return null;
    const panels = dock.panels;
    if (!isObj(panels)) return null;
    const ids = Object.keys(panels);
    if (ids.length === 0 || !ids.includes("graph")) return null;
    for (const id of ids) {
      const p = panels[id];
      if (!isObj(p) || typeof p.contentComponent !== "string" || !knownPanelIds.has(p.contentComponent)) return null;
    }
    if (dock.floatingGroups !== undefined && !Array.isArray(dock.floatingGroups)) return null;
    if (dock.popoutGroups !== undefined && !Array.isArray(dock.popoutGroups)) return null;
    return raw as unknown as SavedLayout;
  } catch {
    return null;
  }
}

export interface RestoreResult {
  ok: boolean;
  reason?: string;
}

/**
 * Restore a saved layout. On any failure (invalid shape, old version, dockview throwing)
 * the dock is cleared and `fallback` builds the default layout. Never throws.
 */
export function restoreLayout(
  api: DockviewApi,
  raw: unknown,
  knownPanelIds: ReadonlySet<string>,
  fallback: () => void,
): RestoreResult {
  const valid = validateLayout(raw, knownPanelIds);
  if (!valid) {
    fallback();
    return { ok: false, reason: "invalid or outdated layout" };
  }
  try {
    api.fromJSON(valid.dock);
    return { ok: true };
  } catch (err) {
    try {
      api.clear();
    } catch {
      /* ignore */
    }
    fallback();
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
