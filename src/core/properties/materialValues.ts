import { linearToSrgb } from "../values/color";
import { clamp } from "../values/numeric";
import { isTextureProperty, type Keyword, type Property, type PropertyValue } from "./model";
import { clampKeywordValue } from "./keywords";
import type { Graph } from "../graph/types";

/**
 * Material instance values: what a game-engine material stores on top of the shader's defaults.
 * `values` maps property id → value; absent = "use the shader default".
 */
export type MaterialValues = Readonly<Record<string, PropertyValue>>;

/**
 * Material-value key of a texture property's Tiling / Offset: `[tilingX, tilingY, offsetX, offsetY]` (Unity `_ST` order). Stored next to the
 * property values by the Material panel; the Preview feeds it to the hidden `<texture>_ST` uniform of the generated GLSL.
 */
export const stKey = (propId: string): string => `${propId}#st`;
/** Identity Tiling / Offset. */
export const DEFAULT_ST: readonly number[] = [1, 1, 0, 0];

const ARITY: Record<string, number> = { vec2: 2, vec3: 3, vec4: 4, color: 3, color4: 4 };

/** Value the shader receives for a property: the default (or override) with the colour-space rule applied. */
function uploadValue(p: Property, value: PropertyValue = p.default): PropertyValue {
  if ((p.type === "color" || p.type === "color4") && p.colorSpace === "srgb" && Array.isArray(value)) {
    return value.map((c, i) => (i < 3 ? linearToSrgb(c) : c));
  }
  return value;
}

/**
 * Properties as the GPU should see them: overrides replace defaults, colour-space rule applied.
 * Returns the same array object when nothing changes (cheap identity checks for callers).
 */
export function effectiveProperties(props: readonly Property[], values: MaterialValues = {}): readonly Property[] {
  let changed = false;
  const out = props.map((p) => {
    const raw = p.id in values ? values[p.id]! : p.default;
    const v = uploadValue(p, raw);
    if (v === p.default) return p;
    changed = true;
    return { ...p, default: v };
  });
  return changed ? out : props;
}

/** Coerce an arbitrary (pasted / typed) value to a legal value of `p`, or `undefined` when it cannot be interpreted. */
function coerceMaterialValue(p: Property, raw: unknown): PropertyValue | undefined {
  const lo = p.min ?? -Infinity;
  const hi = p.max ?? Infinity;
  switch (p.type) {
    case "float":
    case "int": {
      const n = typeof raw === "number" ? raw : typeof raw === "boolean" ? Number(raw) : Number.NaN;
      if (!Number.isFinite(n)) return undefined;
      let v = p.type === "int" ? Math.round(n) : n;
      if (p.slider || p.min !== undefined || p.max !== undefined) v = clamp(v, lo, hi);
      return v;
    }
    case "bool":
      return typeof raw === "boolean" ? raw : typeof raw === "number" ? raw !== 0 : undefined;
    case "vec2":
    case "vec3":
    case "vec4":
    case "color":
    case "color4": {
      const n = ARITY[p.type]!;
      if (
        !Array.isArray(raw) ||
        raw.length < n ||
        raw.slice(0, n).some((x) => typeof x !== "number" || !Number.isFinite(x))
      )
        return undefined;
      const arr = (raw as number[]).slice(0, n);
      return p.type === "color" || p.type === "color4" ? (p.hdr ? arr : arr.map((x) => clamp(x, 0, 1))) : arr;
    }
    case "texture2D":
    case "texture2DArray":
    case "texture3D":
    case "textureCube":
      return undefined;
  }
}

const MATERIAL_JSON_FORMAT = "kekenik-shader-material";

export interface MaterialJson {
  format: typeof MATERIAL_JSON_FORMAT;
  version: 1;
  shader: string;
  /** Canonical reference name → value (only exposed, non-texture properties; textures are project assets and not portable). */
  values: Record<string, PropertyValue>;
  /** Keyword reference name → boolean (boolean keywords) or entry name (enum keywords). */
  keywords: Record<string, boolean | string>;
}

/** Serialise the current material values (overrides merged over defaults) as portable JSON. */
export function materialToJson(
  graph: Graph,
  values: MaterialValues,
  keywordValues: Readonly<Record<string, number>>,
): MaterialJson {
  const out: MaterialJson = { format: MATERIAL_JSON_FORMAT, version: 1, shader: graph.name, values: {}, keywords: {} };
  for (const p of graph.properties) {
    if (!p.exposed || isTextureProperty(p.type)) continue;
    out.values[p.referenceName] = p.id in values ? values[p.id]! : p.default;
  }
  for (const k of graph.keywords) {
    const v = clampKeywordValue(k, keywordValues[k.id] ?? k.default);
    out.keywords[k.referenceName] = k.kind === "boolean" ? v !== 0 : (k.entries?.[v] ?? String(v));
  }
  return out;
}

export interface MaterialPaste {
  values: Record<string, PropertyValue>;
  keywords: Record<string, number>;
  /** Human-readable notes about entries that were skipped or adjusted. */
  warnings: string[];
}

const keywordEntryIndex = (k: Keyword, raw: unknown): number | undefined => {
  if (k.kind === "boolean")
    return typeof raw === "boolean" ? Number(raw) : typeof raw === "number" ? Number(raw !== 0) : undefined;
  if (typeof raw === "string") {
    const i = (k.entries ?? []).indexOf(raw);
    return i < 0 ? undefined : i;
  }
  return typeof raw === "number" ? clampKeywordValue(k, raw) : undefined;
};

/** Parse pasted material JSON for `graph`. Matches by reference name, then display name, then id. Never throws. */
export function parseMaterialJson(graph: Graph, text: string): MaterialPaste | { error: string } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { error: "The clipboard does not contain valid JSON" };
  }
  if (!doc || typeof doc !== "object") return { error: "Unexpected JSON shape" };
  const d = doc as Partial<MaterialJson>;
  if (d.format !== MATERIAL_JSON_FORMAT)
    return { error: `Not a Kekenik Shader material (format "${String(d.format)}")` };
  const out: MaterialPaste = { values: {}, keywords: {}, warnings: [] };
  const vals = d.values && typeof d.values === "object" ? d.values : {};
  for (const [key, raw] of Object.entries(vals)) {
    const p =
      graph.properties.find((x) => x.referenceName === key) ??
      graph.properties.find((x) => x.displayName === key) ??
      graph.properties.find((x) => x.id === key);
    if (!p || isTextureProperty(p.type)) {
      out.warnings.push(`Skipped "${key}": no matching parameter`);
      continue;
    }
    const v = coerceMaterialValue(p, raw);
    if (v === undefined) out.warnings.push(`Skipped "${key}": invalid value for ${p.type}`);
    else out.values[p.id] = v;
  }
  const kws = d.keywords && typeof d.keywords === "object" ? d.keywords : {};
  for (const [key, raw] of Object.entries(kws)) {
    const k =
      graph.keywords.find((x) => x.referenceName === key) ??
      graph.keywords.find((x) => x.displayName === key) ??
      graph.keywords.find((x) => x.id === key);
    const v = k ? keywordEntryIndex(k, raw) : undefined;
    if (!k || v === undefined) out.warnings.push(`Skipped keyword "${key}"`);
    else out.keywords[k.id] = v;
  }
  return out;
}
