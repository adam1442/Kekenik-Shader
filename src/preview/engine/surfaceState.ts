import { type Graph, type ParamValue, optionValue, targetProfiles } from "@/core";
import type { BlendSetting } from "./shaderBinding";

/** Which faces the preview draws. */
export type FaceSide = "front" | "back" | "both";

const str = (v: ParamValue | undefined): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * Faces drawn by the preview, resolved from the graph settings exactly like the exporters do (pure; tested).
 *
 * - Target profiles (Unity / Godot) store the **cull mode** in `settings.cull`: `back` = cull back faces ⇒ draw FRONT faces
 *   (the default), `front` = cull front faces ⇒ draw BACK faces, `off` = draw both. A missing value takes the profile default.
 * - Sprite / canvas profiles are always double-sided (Unity forces `Cull Off`; Godot canvas items have no culling).
 * - The generic profile keeps its legacy `twoSided` flag.
 */
export function faceSideOf(graph: Graph | null): FaceSide {
  if (!graph) return "front";
  const profile = targetProfiles.get(graph.profileId);
  if (profile) {
    if (profile.family === "sprite") return "both";
    if (profile.surfaceOptions.some((o) => o.id === "cull")) {
      const cull = str(optionValue(profile.surfaceOptions, graph.settings, "cull"));
      return cull === "off" ? "both" : cull === "front" ? "back" : "front";
    }
  }
  return graph.settings.twoSided === true ? "both" : "front";
}

/**
 * Blend mode of the preview material. Target profiles name premultiplied alpha `premultiply`, the generic profile
 * `premultiplied`; both mean the same. Unknown / unsupported values draw opaque (as before).
 */
export function previewBlendOf(raw: ParamValue | undefined): BlendSetting {
  const b = str(raw);
  if (b === "premultiply") return "premultiplied";
  return b === "alpha" || b === "additive" || b === "premultiplied" ? b : "opaque";
}
