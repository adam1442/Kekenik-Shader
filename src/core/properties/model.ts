import { isTextureType, type ShaderType } from "../types/shaderType";
import { canonicalFromDisplayName } from "./names";

/**
 * Exposed-parameter model. A Property is a graph-level uniform that (when `exposed`) shows up in the
 * material inspector of the target engine.
 */
export type PropertyType = Extract<
  ShaderType,
  | "float"
  | "int"
  | "bool"
  | "vec2"
  | "vec3"
  | "vec4"
  | "color"
  | "color4"
  | "texture2D"
  | "texture2DArray"
  | "texture3D"
  | "textureCube"
>;
export const PROPERTY_TYPES: readonly PropertyType[] = [
  "float",
  "int",
  "bool",
  "vec2",
  "vec3",
  "vec4",
  "color",
  "color4",
  "texture2D",
  "texture2DArray",
  "texture3D",
  "textureCube",
];

/** Property types that hold a texture asset . */
export const isTextureProperty = (t: PropertyType): boolean => isTextureType(t);

export type PropertyValue = number | boolean | number[] | null;
export type TextureDefault = "white" | "black" | "grey" | "bump" | "red" | "none";
export type ColorSpace = "srgb" | "linear";
export type KeywordDefinition = "shader_feature" | "multi_compile" | "static";

export interface EnumEntry {
  name: string;
  value: number;
}

export interface Property {
  /** Stable id (never shown, never changes). */
  id: string;
  displayName: string;
  /**
   * Canonical reference name, Unity-style (`_MainTex`). Per-target spelling is derived with
   * `targetReferenceName(property.referenceName, target)` (see properties/names.ts).
   */
  referenceName: string;
  type: PropertyType;
  default: PropertyValue;
  min?: number;
  max?: number;
  step?: number;
  /** Show as a slider (needs min & max). */
  slider?: boolean;
  /** HDR color (values may exceed 1). */
  hdr?: boolean;
  /** Colour interpretation of a color / color4 property: sRGB values are converted to linear before upload. Default: linear. */
  colorSpace?: ColorSpace;
  /** Default texture when none is assigned (texture properties; array / 3D / cube use it as a flat 1-texel / 1-layer / 6-face default). */
  textureDefault?: TextureDefault;
  /** Expose Tiling / Offset next to the texture slot in the material inspector (texture2D only; applied by exporters). */
  tilingOffset?: boolean;
  /** Show a dropdown; `value` is what the shader receives (float/int properties). */
  enumValues?: EnumEntry[];
  /** Bool property that toggles a shader keyword instead of a plain uniform. */
  keyword?: { definition: KeywordDefinition };
  /** Inspector header/category. */
  category?: string;
  tooltip?: string;
  /** Appears in the material inspector. */
  exposed: boolean;
  /** Unity: `[PerRendererData]` style per-instance value (not stored in the material). */
  perInstance: boolean;
  /** Godot: exported as `global uniform` (the global must exist in Project Settings → Shader Globals). Ignored by other targets and for textures. */
  godotGlobal?: boolean;
}

export type KeywordKind = "boolean" | "enum";
export interface Keyword {
  id: string;
  displayName: string;
  referenceName: string;
  kind: KeywordKind;
  definition: KeywordDefinition;
  scope: "local" | "global";
  /** Enum entries (kind === "enum"). */
  entries?: string[];
  /** boolean: 0/1, enum: entry index. */
  default: number;
  /** Inspector header/category (same grouping as properties). */
  category?: string;
  tooltip?: string;
}

/** Sensible defaults per type. */
export function defaultValueFor(type: PropertyType): PropertyValue {
  switch (type) {
    case "float":
    case "int":
      return 0;
    case "bool":
      return false;
    case "vec2":
      return [0, 0];
    case "vec3":
      return [0, 0, 0];
    case "vec4":
      return [0, 0, 0, 0];
    case "color":
      return [1, 1, 1];
    case "color4":
      return [1, 1, 1, 1];
    case "texture2D":
    case "texture2DArray":
    case "texture3D":
    case "textureCube":
      return null;
  }
}

/** Build a Property with defaults filled in. */
export function makeProperty(
  id: string,
  displayName: string,
  type: PropertyType,
  patch: Partial<Property> = {},
): Property {
  return {
    id,
    displayName,
    referenceName: canonicalFromDisplayName(displayName),
    type,
    default: defaultValueFor(type),
    exposed: true,
    perInstance: false,
    ...patch,
  };
}
