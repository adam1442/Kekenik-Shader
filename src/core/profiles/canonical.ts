import type { ParamValue } from "../graph/types";
import type { BlockDef, BlockId, OptionPredicate, SurfaceOptionDef } from "./types";

/** The one catalogue of block ids: canonical ones are shared by ALL engines (ids never change per engine); native ones (`NATIVE_BLOCK_IDS`) belong to one engine. */
const SPEC: Record<BlockId, Omit<BlockDef, "required" | "shownWhen">> = {
  positionOS: {
    id: "positionOS",
    context: "vertex",
    label: "Position (Object)",
    type: "vec3",
    tag: { semantic: "position", space: "object" },
  },
  normalOS: {
    id: "normalOS",
    context: "vertex",
    label: "Normal (Object)",
    type: "vec3",
    tag: { semantic: "direction", space: "object" },
  },
  tangentOS: {
    id: "tangentOS",
    context: "vertex",
    label: "Tangent (Object)",
    type: "vec3",
    tag: { semantic: "direction", space: "object" },
  },
  baseColor: {
    id: "baseColor",
    context: "fragment",
    label: "Base Color",
    type: "color",
    defaultValue: [1, 1, 1],
    tag: { semantic: "color" },
  },
  alpha: { id: "alpha", context: "fragment", label: "Alpha", type: "float", defaultValue: 1 },
  alphaClipThreshold: {
    id: "alphaClipThreshold",
    context: "fragment",
    label: "Alpha Clip Threshold",
    type: "float",
    defaultValue: 0.5,
  },
  normalTS: {
    id: "normalTS",
    context: "fragment",
    label: "Normal (Tangent)",
    type: "vec3",
    defaultValue: [0, 0, 1],
    tag: { semantic: "direction", space: "tangent" },
  },
  metallic: { id: "metallic", context: "fragment", label: "Metallic", type: "float", defaultValue: 0 },
  smoothness: { id: "smoothness", context: "fragment", label: "Smoothness", type: "float", defaultValue: 0.5 },
  occlusion: { id: "occlusion", context: "fragment", label: "Occlusion", type: "float", defaultValue: 1 },
  emission: {
    id: "emission",
    context: "fragment",
    label: "Emission",
    type: "color",
    defaultValue: [0, 0, 0],
    tag: { semantic: "color" },
  },
  specular: { id: "specular", context: "fragment", label: "Specular", type: "float", defaultValue: 0.5 },
  rim: { id: "rim", context: "fragment", label: "Rim", type: "float", defaultValue: 0 },
  rimTint: { id: "rimTint", context: "fragment", label: "Rim Tint", type: "float", defaultValue: 0.5 },
  translucency: {
    id: "translucency",
    context: "fragment",
    label: "Translucency",
    type: "color",
    defaultValue: [0, 0, 0],
    tag: { semantic: "color" },
  },
  thickness: { id: "thickness", context: "fragment", label: "Thickness", type: "float", defaultValue: 0 },
  lightDiffuse: {
    id: "lightDiffuse",
    context: "light",
    label: "Diffuse Light (+=)",
    type: "vec3",
    defaultValue: [0, 0, 0],
    tag: { semantic: "color" },
  },
  lightSpecular: {
    id: "lightSpecular",
    context: "light",
    label: "Specular Light (+=)",
    type: "vec3",
    defaultValue: [0, 0, 0],
    tag: { semantic: "color" },
  },
  lightAlpha: { id: "lightAlpha", context: "light", label: "Light Alpha", type: "float", defaultValue: 1 },
  spriteMask: { id: "spriteMask", context: "fragment", label: "Sprite Mask", type: "vec4", defaultValue: [1, 1, 1, 1] },
};

export const block = (id: BlockId, required = false, shownWhen?: OptionPredicate): BlockDef => ({
  ...SPEC[id],
  required,
  ...(shownWhen ? { shownWhen } : {}),
});

/** Current value of an option: stored in `graph.settings` or the option's default. */
export function optionValue(
  defs: readonly SurfaceOptionDef[],
  settings: Readonly<Record<string, ParamValue>>,
  id: string,
): ParamValue {
  const d = defs.find((o) => o.id === id);
  const v = settings[id];
  if (v === undefined) return d?.default ?? false;
  return v;
}

export function predicateHolds(
  p: OptionPredicate | undefined,
  defs: readonly SurfaceOptionDef[],
  settings: Readonly<Record<string, ParamValue>>,
): boolean {
  return p === undefined || optionValue(defs, settings, p.option) === p.equals;
}

/** Is a stored value legal for an option definition? (Used when carrying options across profiles.) */
export function validOptionValue(d: SurfaceOptionDef, v: ParamValue | undefined): boolean {
  if (v === undefined) return false;
  switch (d.kind) {
    case "bool":
      return typeof v === "boolean";
    case "enum":
      return typeof v === "string" && (d.values ?? []).some((x) => x.id === v);
    case "int":
    case "float":
      return (
        typeof v === "number" &&
        Number.isFinite(v) &&
        (d.min === undefined || v >= d.min) &&
        (d.max === undefined || v <= d.max)
      );
  }
}
