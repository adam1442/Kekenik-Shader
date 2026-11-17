/** Godot target model : version + renderer as DATA. Templates query `isSince` / gates — never `if (version …)` chains. */
export type GodotVersionId = "4.3" | "4.4" | "4.5" | "4.6" | "4.7";
export const GODOT_VERSION_IDS: readonly GodotVersionId[] = ["4.3", "4.4", "4.5", "4.6", "4.7"];
export const DEFAULT_GODOT_VERSION: GodotVersionId = "4.3";

export type GodotRenderer = "all" | "forward_plus" | "mobile" | "compatibility";
export const GODOT_RENDERERS: ReadonlyArray<{ id: GodotRenderer; label: string }> = [
  { id: "all", label: "All renderers" },
  { id: "forward_plus", label: "Forward+" },
  { id: "mobile", label: "Mobile" },
  { id: "compatibility", label: "Compatibility" },
];

export interface GodotTarget {
  version: GodotVersionId;
  renderer: GodotRenderer;
}

export type FactStatus = "verified" | "unverified-by-doc";

/** A version-gated feature. `deferred` = not implemented in this release (documented only). */
export interface VersionGate {
  id: string;
  label: string;
  since: GodotVersionId;
  status: FactStatus;
  deferred?: boolean;
  note: string;
}

const VERSION_GATES: readonly VersionGate[] = [
  {
    id: "stencil_mode",
    label: "Stencil (stencil_mode)",
    since: "4.5",
    status: "verified",
    note: "Stencil support (stencil_mode, experimental) arrives in Godot 4.5 — spelling from the official Spatial-shader reference (10e-2, E8); spatial shaders only.",
  },
  {
    id: "depth_test_inverted",
    label: "depth_test_inverted",
    since: "4.5",
    status: "unverified-by-doc",
    note: "Present in the 4.6 / stable documentation; the first version is not verified — treated as 4.5+.",
  },
];

export const gateById = (id: string): VersionGate | undefined => VERSION_GATES.find((g) => g.id === id);

const order = (v: string): number => GODOT_VERSION_IDS.indexOf(v as GodotVersionId);
/** Is `version` at least `since`? Unknown versions fall back to the baseline (4.3). */
export const isSince = (version: string, since: string): boolean => Math.max(order(version), 0) >= order(since);
/** Is the gated feature available for the target version? */
export const featureAvailable = (featureId: string, version: string): boolean => {
  const g = gateById(featureId);
  return !g || (!g.deferred && isSince(version, g.since));
};

export const normalizeVersion = (v: unknown): GodotVersionId =>
  typeof v === "string" && GODOT_VERSION_IDS.includes(v as GodotVersionId)
    ? (v as GodotVersionId)
    : DEFAULT_GODOT_VERSION;
export const normalizeRenderer = (v: unknown): GodotRenderer =>
  typeof v === "string" && GODOT_RENDERERS.some((r) => r.id === v) ? (v as GodotRenderer) : "all";
