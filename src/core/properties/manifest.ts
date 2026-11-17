import type {
  Property,
  PropertyType,
  PropertyValue,
  EnumEntry,
  TextureDefault,
  KeywordDefinition,
  ColorSpace,
} from "./model";
import { type RefTarget, targetReferenceName } from "./names";

/** One row of the parameter manifest an export ships alongside the shader (feeds engine material inspectors). */
export interface ParameterManifestEntry {
  id: string;
  displayName: string;
  /** Spelling used inside the exported shader for this target. */
  referenceName: string;
  type: PropertyType;
  default: PropertyValue;
  min?: number;
  max?: number;
  step?: number;
  slider: boolean;
  hdr: boolean;
  colorSpace?: ColorSpace;
  tilingOffset?: boolean;
  textureDefault?: TextureDefault;
  enumValues?: EnumEntry[];
  keyword?: { definition: KeywordDefinition };
  category?: string;
  tooltip?: string;
  perInstance: boolean;
}

/** Manifest for all EXPOSED properties, in graph order. */
export function buildParameterManifest(properties: readonly Property[], target: RefTarget): ParameterManifestEntry[] {
  return properties
    .filter((p) => p.exposed)
    .map((p) => {
      const e: ParameterManifestEntry = {
        id: p.id,
        displayName: p.displayName,
        referenceName: targetReferenceName(p.referenceName, target),
        type: p.type,
        default: p.default,
        slider: !!p.slider && p.min !== undefined && p.max !== undefined,
        hdr: !!p.hdr,
        perInstance: p.perInstance,
      };
      if (p.min !== undefined) e.min = p.min;
      if (p.max !== undefined) e.max = p.max;
      if (p.step !== undefined) e.step = p.step;
      if (p.colorSpace !== undefined && (p.type === "color" || p.type === "color4")) e.colorSpace = p.colorSpace;
      if (p.tilingOffset && p.type === "texture2D") e.tilingOffset = true;
      if (p.textureDefault !== undefined) e.textureDefault = p.textureDefault;
      if (p.enumValues) e.enumValues = p.enumValues;
      if (p.keyword) e.keyword = p.keyword;
      if (p.category) e.category = p.category;
      if (p.tooltip) e.tooltip = p.tooltip;
      return e;
    });
}
