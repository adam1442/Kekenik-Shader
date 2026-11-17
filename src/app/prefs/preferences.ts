import { create } from "zustand";
import { type HoistMode, type OptLevel, setDefaultHoistMode, setDefaultOptLevel } from "@/core";
import { storage } from "@/app/lib/storage";
import { setShortcutOverrides } from "@/app/commands/registry";
import { setWireMode, type WireMode } from "@/ui/graph/wireGeometry";
import { useCanvasPrefs } from "@/ui/graph/prefs";
import { getActiveController } from "@/ui/graph/controller/registry";

type Theme = "dark" | "light";
type PreviewQuality = "low" | "medium" | "high";

/** Default single-key quick nodes (key → node definition id). Editable in Preferences. */
export const DEFAULT_QUICK_NODES: Record<string, string> = {
  "1": "float",
  "2": "vector2",
  "3": "vector3",
  "4": "vector4",
  c: "color",
  m: "multiply",
  a: "add",
  u: "uv",
  t: "time",
  l: "lerp",
  s: "sampleTexture2D",
  p: "property",
};

export interface PreferenceValues {
  theme: Theme;
  /** Whole-UI zoom factor (0.8 … 1.4). */
  uiScale: number;
  gridStyle: "dots" | "lines" | "cross";
  wireStyle: WireMode;
  /** Seconds between autosaves; 0 = off. */
  autosaveSec: number;
  previewQuality: PreviewQuality;
  /** IR optimisation level used by the preview and every export (0 off, 1 safe, 2 fast-math). */
  optLevel: OptLevel;
  /** Vertex hoisting : affine per-pixel expressions are evaluated per vertex and interpolated. */
  hoist: HoistMode;
  /** Embed the textures bound to the graph's texture properties in saved `.kshader` files (bigger files, self-contained). */
  embedAssets: boolean;
  quickNodes: Record<string, string>;
  /** command id → shortcut ("" = unbound). */
  keybindings: Record<string, string>;
}

const DEFAULT_PREFERENCES: PreferenceValues = {
  theme: "dark",
  uiScale: 1,
  gridStyle: "dots",
  wireStyle: "bezier",
  autosaveSec: 30,
  previewQuality: "high",
  optLevel: 1,
  hoist: "off",
  embedAssets: false,
  quickNodes: { ...DEFAULT_QUICK_NODES },
  keybindings: {},
};

const KEY = "preferences";
const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);

/** Defensive normaliser: anything stored by an older / broken version falls back to defaults field by field. */
function sanitizePreferences(raw: unknown): PreferenceValues {
  const o = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof PreferenceValues, unknown>>;
  const d = DEFAULT_PREFERENCES;
  const rec = (v: unknown, fallback: Record<string, string>): Record<string, string> =>
    v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string") as Array<
            [string, string]
          >,
        )
      : { ...fallback };
  return {
    theme: oneOf(o.theme, ["dark", "light"], d.theme),
    uiScale: typeof o.uiScale === "number" && Number.isFinite(o.uiScale) ? clamp(o.uiScale, 0.8, 1.4) : d.uiScale,
    gridStyle: oneOf(o.gridStyle, ["dots", "lines", "cross"], d.gridStyle),
    wireStyle: oneOf(o.wireStyle, ["bezier", "orthogonal", "straight"], d.wireStyle),
    autosaveSec:
      typeof o.autosaveSec === "number" && o.autosaveSec >= 0
        ? Math.min(600, Math.round(o.autosaveSec))
        : d.autosaveSec,
    previewQuality: oneOf(o.previewQuality, ["low", "medium", "high"], d.previewQuality),
    optLevel: o.optLevel === 0 || o.optLevel === 1 || o.optLevel === 2 ? o.optLevel : d.optLevel,
    hoist: oneOf(o.hoist, ["off", "conservative", "aggressive"], d.hoist),
    embedAssets: o.embedAssets === true,
    quickNodes: rec(o.quickNodes, DEFAULT_QUICK_NODES),
    keybindings: rec(o.keybindings, {}),
  };
}

interface PrefsState extends PreferenceValues {
  set: (p: Partial<PreferenceValues>) => void;
  reset: () => void;
}

const values = (s: PrefsState): PreferenceValues => ({
  theme: s.theme,
  uiScale: s.uiScale,
  gridStyle: s.gridStyle,
  wireStyle: s.wireStyle,
  autosaveSec: s.autosaveSec,
  previewQuality: s.previewQuality,
  optLevel: s.optLevel,
  hoist: s.hoist,
  embedAssets: s.embedAssets,
  quickNodes: s.quickNodes,
  keybindings: s.keybindings,
});

export const usePrefs = create<PrefsState>((set, get) => ({
  ...sanitizePreferences(storage.getJSON(KEY)),
  set: (p) => {
    set(sanitizePreferences({ ...values(get()), ...p }));
    storage.setJSON(KEY, values(get()));
  },
  reset: () => {
    set({ ...DEFAULT_PREFERENCES, quickNodes: { ...DEFAULT_QUICK_NODES }, keybindings: {} });
    storage.setJSON(KEY, values(get()));
  },
}));

const getPreferences = (): PreferenceValues => values(usePrefs.getState());

/** Push preference values into the running app (DOM attributes, core defaults, wire geometry, keybindings). Safe in Node (no-ops without a DOM). */
function applyPreferences(p: PreferenceValues = getPreferences()): void {
  setDefaultOptLevel(p.optLevel);
  setDefaultHoistMode(p.hoist);
  setWireMode(p.wireStyle);
  setShortcutOverrides(p.keybindings);
  if (useCanvasPrefs.getState().gridStyle !== p.gridStyle) useCanvasPrefs.getState().set({ gridStyle: p.gridStyle });
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = p.theme;
  root.dataset.previewQuality = p.previewQuality;
  (root.style as CSSStyleDeclaration & { zoom: string }).zoom = p.uiScale === 1 ? "" : String(p.uiScale);
  document.querySelectorAll<HTMLElement>(".kk-canvas").forEach((el) => (el.dataset.gridStyle = p.gridStyle));
  const c = getActiveController() as unknown as {
    view?: { x: number; y: number; zoom: number };
    setView?: (v: { x: number; y: number; zoom: number }) => void;
  } | null;
  if (c?.view && c.setView) c.setView({ ...c.view }); // repaint wires with the new geometry
}

let installed = false;
/** Apply now and whenever a preference changes. Idempotent. */
export function installPreferences(): void {
  if (installed) return;
  installed = true;
  applyPreferences();
  usePrefs.subscribe(() => applyPreferences());
}
