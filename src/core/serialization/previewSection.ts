import { stableStringify } from "./stable";

/**
 * Preview / material state stored INSIDE a `.kshader` : a versioned top-level `preview` section next to the graph
 * (ignored by older readers, like `embeddedAssets`). The core only carries it; the app decides what goes in (`app/project/previewState`).
 * v1 = { prefs, sim, bindings, material, presets }. v0 (unversioned flat object) = the prefs only.
 */
const PREVIEW_KEY = "preview";
const PREVIEW_SECTION_VERSION = 1;

export interface MaterialPreset {
  values: Record<string, unknown>;
  keywords: Record<string, unknown>;
  bindings: Record<string, string | null>;
}
export interface PreviewSection {
  version: number;
  /** Preview prefs: mesh / sprite / HDR asset refs, display + lighting + post settings. */
  prefs: Record<string, unknown>;
  /** Scene Simulation settings (target override, fog, camera, light, …). */
  sim: Record<string, unknown>;
  /** Texture property id → asset id. */
  bindings: Record<string, string | null>;
  /** Material panel overrides + keyword variant of the document. */
  material: { values: Record<string, unknown>; keywords: Record<string, unknown> };
  /** Named material presets (save / load, export `material.json`). */
  presets: Record<string, MaterialPreset>;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const obj = (v: unknown): Record<string, unknown> => (isObj(v) ? v : {});

/** Migrate any historical shape to the current one (never throws; unknown input → null). */
function migratePreviewSection(raw: unknown): PreviewSection | null {
  if (!isObj(raw)) return null;
  const v = typeof raw.version === "number" ? raw.version : 0;
  if (v > PREVIEW_SECTION_VERSION) return null; // written by a newer app: ignore rather than guess
  const src = v === 0 ? { prefs: raw } : raw;
  const mat = obj(src.material);
  return {
    version: PREVIEW_SECTION_VERSION,
    prefs: obj(src.prefs),
    sim: obj(src.sim),
    bindings: obj(src.bindings) as Record<string, string | null>,
    material: { values: obj(mat.values), keywords: obj(mat.keywords) },
    presets: obj(src.presets) as Record<string, MaterialPreset>,
  };
}

/** Add the section to serialized `.kshader` text (deterministic). */
export function embedPreview(text: string, section: Omit<PreviewSection, "version">): string {
  const doc = JSON.parse(text) as Record<string, unknown>;
  doc[PREVIEW_KEY] = { ...section, version: PREVIEW_SECTION_VERSION };
  return stableStringify(doc, 2) + "\n";
}

/** Section of a `.kshader` text, or null when absent / malformed (never throws). */
export function readPreview(text: string): PreviewSection | null {
  try {
    return migratePreviewSection((JSON.parse(text) as Record<string, unknown>)[PREVIEW_KEY]);
  } catch {
    return null;
  }
}

/** `material.json` of one preset / the current material (engine-neutral; properties by id). */
export const materialJson = (name: string, m: MaterialPreset): string =>
  stableStringify({ format: "kshader-material", version: 1, generator: "Kekenik Shader", name, ...m }, 2) + "\n";
