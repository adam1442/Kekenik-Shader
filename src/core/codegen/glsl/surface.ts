import type { BlockId } from "../../profiles/types";
import type { ExprId, IRModule } from "../../ir/types";

/**
 * PREVIEW SURFACE CONTRACT . With the GLSL emit option `surface: "preview"` the SAME backend (no second generator)
 * additionally writes every master block of the active profile into the global `KsSurface ks_surf` at the end of `main()`.
 * The preview lighting prelude (`src/preview/gl/lighting`) reads it. Exported GLSL (Code panel) never contains this code.
 *
 * `PREVIEW_SURFACE_MAP` is a total `Record<BlockId, …>`: adding a block id to the profile framework does not compile until the
 * preview either maps it to a `KsSurface` field or declares `notPreviewable(reason)`. Documented in `docs/PREVIEW_SURFACE.md`.
 */
const SURFACE_FIELDS = [
  "metallic",
  "smoothness",
  "occlusion",
  "emission",
  "normalTS",
  "specular",
  "rim",
  "rimTint",
  "translucency",
  "thickness",
] as const;
export type SurfaceField = (typeof SURFACE_FIELDS)[number];

/** GLSL type of each field written from a block. */
export const SURFACE_FIELD_TYPE: Readonly<Record<SurfaceField, "float" | "vec3">> = {
  metallic: "float",
  smoothness: "float",
  occlusion: "float",
  emission: "vec3",
  normalTS: "vec3",
  specular: "float",
  rim: "float",
  rimTint: "float",
  translucency: "vec3",
  thickness: "float",
};

type SurfaceMapping =
  | {
      kind: "field";
      /** KsSurface field(s) the block feeds ("baseColor" / "alpha" come from the colour output). */ field: string;
      conversion: string;
      fidelity: "exact" | "approximate";
      note: string;
    }
  | { kind: "vertex"; conversion: string; fidelity: "exact" | "approximate"; note: string }
  | { kind: "notPreviewable"; reason: string };

const notPreviewable = (reason: string): SurfaceMapping => ({ kind: "notPreviewable", reason });

export const PREVIEW_SURFACE_MAP: Readonly<Record<BlockId, SurfaceMapping>> = {
  positionOS: {
    kind: "vertex",
    conversion: "object-space vertex position replaces a_position",
    fidelity: "exact",
    note: "Same as the exported vertex stage.",
  },
  normalOS: notPreviewable(
    "The preview vertex stage displaces positions only; the shading normal stays the mesh normal (a displaced normal needs a recomputed tangent frame).",
  ),
  tangentOS: notPreviewable(
    "The preview uses the mesh tangent attribute (or a derivative frame); a graph-supplied tangent is not routed to the lighting prelude.",
  ),
  baseColor: {
    kind: "field",
    field: "baseColor",
    conversion: "rgb as authored (linear)",
    fidelity: "exact",
    note: "Becomes albedo (or the unlit colour).",
  },
  alpha: {
    kind: "field",
    field: "alpha",
    conversion: "none",
    fidelity: "exact",
    note: "Blend / clip as the profile's surface options say.",
  },
  alphaClipThreshold: {
    kind: "field",
    field: "(discard)",
    conversion: "discard when alpha < threshold",
    fidelity: "exact",
    note: "Already part of the exported fragment code.",
  },
  normalTS: {
    kind: "field",
    field: "normalTS",
    conversion: "tangent space → world through the mesh TBN (derivative frame when the mesh has no tangents)",
    fidelity: "exact",
    note: "hasNormal = 1 only when the block is connected / defaulted by the profile.",
  },
  metallic: {
    kind: "field",
    field: "metallic",
    conversion: "clamp 0..1; F0 = mix(0.04, albedo, metallic)",
    fidelity: "exact",
    note: "",
  },
  smoothness: {
    kind: "field",
    field: "smoothness",
    conversion:
      "perceptual roughness = 1 − smoothness (Godot `roughness` block is stored as smoothness by the profile framework)",
    fidelity: "exact",
    note: "",
  },
  occlusion: {
    kind: "field",
    field: "occlusion",
    conversion: "multiplies diffuse + specular ambient (never direct light)",
    fidelity: "exact",
    note: "",
  },
  emission: {
    kind: "field",
    field: "emission",
    conversion: "added after lighting, HDR (> 1 survives into the HDR target / bloom)",
    fidelity: "exact",
    note: "",
  },
  specular: {
    kind: "field",
    field: "specular",
    conversion: "dielectric F0 = 0.08 · specular (Godot spatial `SPECULAR`, default 0.5 → 0.04)",
    fidelity: "exact",
    note: "Unity Lit has no such block (metallic workflow): default 0.5.",
  },
  rim: {
    kind: "field",
    field: "rim",
    conversion: "Godot rim term: rim · pow(1 − N·V, 4) · lerp(white, albedo, rimTint)",
    fidelity: "approximate",
    note: "Godot adds rim per light inside light(); the preview adds it once from the key light colour.",
  },
  rimTint: { kind: "field", field: "rimTint", conversion: "see rim", fidelity: "approximate", note: "" },
  translucency: {
    kind: "field",
    field: "translucency",
    conversion: "back light = translucency · (1 − thickness) · albedo · mainLight · saturate(dot(−N, L))",
    fidelity: "approximate",
    note: "Portable wrap / back-light term, identical in the preview, the Unity Lit pass (added to emission) and Godot BACKLIGHT. URP Lit has no native translucency; Godot adds BACKLIGHT per light inside light() [verify].",
  },
  thickness: {
    kind: "field",
    field: "thickness",
    conversion: "scales translucency by (1 − thickness); 0 = thin (full back light), 1 = opaque",
    fidelity: "approximate",
    note: "See translucency.",
  },
  lightDiffuse: notPreviewable(
    "Godot light() runs once per light inside the engine; the preview lighting prelude has no per-light user hook, so the custom light() result is not shown (the preview keeps the default lighting).",
  ),
  lightSpecular: notPreviewable("See lightDiffuse: the custom light() stage is evaluated by Godot only."),
  lightAlpha: notPreviewable("See lightDiffuse: the custom light() stage is evaluated by Godot only."),
  spriteMask: notPreviewable(
    "Sprite Lit mask is a secondary-texture input of Unity's 2D light shader; the preview's 2D-light approximation does not use a mask.",
  ),
};

/** Block id → fields written by `emitSurface` (profile slots that exist in the module are routed by `mapSurfaceSlots`). */
const BLOCK_TO_FIELD: Partial<Record<BlockId, SurfaceField>> = {
  metallic: "metallic",
  smoothness: "smoothness",
  occlusion: "occlusion",
  emission: "emission",
  normalTS: "normalTS",
  specular: "specular",
  rim: "rim",
  rimTint: "rimTint",
  translucency: "translucency",
  thickness: "thickness",
};

export type SurfaceSlots = Partial<Record<SurfaceField, ExprId>>;

/** The surface expressions of an engine-profile module (empty for generic / debug). */
export function mapSurfaceSlots(module: IRModule): SurfaceSlots {
  const out: SurfaceSlots = {};
  if (!(module.profileId.startsWith("unity.") || module.profileId.startsWith("godot."))) return out;
  for (const o of module.outputs) {
    const f = BLOCK_TO_FIELD[o.slot as BlockId];
    if (f) out[f] = o.value;
  }
  return out;
}

/** GLSL declaration of the surface (inserted before `main`). `unlit` = the profile family bypasses lighting (unlit / sprite / vfx). */
export function surfaceDeclaration(unlit: boolean): string[] {
  return [
    "// Preview surface contract (Kekenik Shader preview only): filled at the end of main(), consumed by the preview lighting prelude.",
    "struct KsSurface { vec3 baseColor; float alpha; float metallic; float smoothness; float occlusion; vec3 emission; vec3 normalTS; float hasNormal; float specular; float rim; float rimTint; vec3 translucency; float thickness; float unlit; };",
    `KsSurface ks_surf = KsSurface(vec3(1.0), 1.0, 0.0, 0.5, 1.0, vec3(0.0), vec3(0.0, 0.0, 1.0), 0.0, 0.5, 0.0, 0.5, vec3(0.0), 0.0, ${unlit ? "1.0" : "0.0"});`,
  ];
}
