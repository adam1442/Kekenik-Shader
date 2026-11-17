import {
  Binary,
  Blend,
  Box,
  Boxes,
  Globe,
  Hash,
  Image,
  Layers,
  Palette,
  SlidersHorizontal,
  ToggleLeft,
  Waypoints,
} from "lucide-react";
import type { Keyword, Property, PropertyType } from "@/core";
import type { IconType } from "@/ui";

export interface AddPropertyType {
  id: string;
  label: string;
  type: PropertyType;
  icon: IconType;
  patch?: Partial<Property>;
}

/** The "Add property" menu. `Color` is RGBA (Unity's Color property); `Color (RGB)` has no alpha. */
export const ADD_PROPERTY_TYPES: AddPropertyType[] = [
  { id: "float", label: "Float", type: "float", icon: SlidersHorizontal },
  { id: "int", label: "Integer", type: "int", icon: Hash },
  { id: "bool", label: "Boolean", type: "bool", icon: ToggleLeft },
  { id: "vec2", label: "Vector 2", type: "vec2", icon: Waypoints },
  { id: "vec3", label: "Vector 3", type: "vec3", icon: Waypoints },
  { id: "vec4", label: "Vector 4", type: "vec4", icon: Waypoints },
  { id: "color4", label: "Color", type: "color4", icon: Palette, patch: { default: [1, 1, 1, 1] } },
  { id: "color", label: "Color (RGB)", type: "color", icon: Blend },
  { id: "texture2D", label: "Texture 2D", type: "texture2D", icon: Image, patch: { textureDefault: "white" } },
  // 2 (E9)
  {
    id: "texture2DArray",
    label: "Texture 2D Array",
    type: "texture2DArray",
    icon: Layers,
    patch: { textureDefault: "white" },
  },
  { id: "texture3D", label: "Texture 3D", type: "texture3D", icon: Box, patch: { textureDefault: "white" } },
  { id: "textureCube", label: "Cubemap", type: "textureCube", icon: Globe, patch: { textureDefault: "white" } },
];

export const TYPE_LABEL: Record<PropertyType, string> = {
  float: "Float",
  int: "Integer",
  bool: "Boolean",
  vec2: "Vector 2",
  vec3: "Vector 3",
  vec4: "Vector 4",
  color: "Color RGB",
  color4: "Color",
  texture2D: "Texture 2D",
  texture2DArray: "Texture 2D Array",
  texture3D: "Texture 3D",
  textureCube: "Cubemap",
};

export const propertyIcon = (type: PropertyType): IconType =>
  ADD_PROPERTY_TYPES.find((t) => t.type === type)?.icon ?? Binary;
export const keywordIcon = (k: Keyword): IconType => (k.kind === "boolean" ? ToggleLeft : Boxes);

/** Drag payload mimes (Blackboard → canvas / texture slots). Payload = `property:<id>` | `keyword:<id>`. */
export const BLACKBOARD_MIME = "application/x-kk-blackboard";
