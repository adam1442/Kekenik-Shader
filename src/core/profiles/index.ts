import type { ProfileDef } from "../registry/profile";
import { ProfileRegistry } from "../registry/registry";
import { UNITY_PROFILES } from "./unity";
import { GODOT_PROFILES } from "./godot";
import { targetProfiles, toProfileDef } from "./registry";

/**
 * "Master Output (debug)" — the only profile in . It exists to exercise vertex/fragment blocks,
 * required vs optional slots and defaults. Real profiles (Unlit, Lit, Sprite, VFX …) come in .
 */
const debugProfile: ProfileDef = {
  id: "debug",
  name: "Master Output (debug)",
  family: "debug",
  stages: ["vertex", "fragment"],
  masterBlocks: [
    {
      id: "Position",
      label: "Vertex Position",
      type: "vec3",
      stage: "vertex",
      required: false,
      tag: { semantic: "position", space: "object" },
    },
    {
      id: "BaseColor",
      label: "Base Color",
      type: "color",
      stage: "fragment",
      required: true,
      tag: { semantic: "color" },
    },
    { id: "Alpha", label: "Alpha", type: "float", stage: "fragment", required: false, default: 1 },
  ],
  settings: [
    {
      id: "surface",
      label: "Surface",
      control: "enum",
      default: "opaque",
      options: [
        { value: "opaque", label: "Opaque" },
        { value: "transparent", label: "Transparent" },
      ],
    },
  ],
};

/**
 * "Generic Fragment" : the profile of the GLSL backend — RGBA color, optional alpha clip, optional vertex offset.
 * Real engine profiles (Unlit/Lit/Sprite/VFX…) arrive with .
 */
const genericProfile: ProfileDef = {
  id: "generic",
  name: "Generic Fragment",
  family: "unlit",
  stages: ["vertex", "fragment"],
  masterBlocks: [
    {
      id: "VertexOffset",
      label: "Vertex Offset",
      type: "vec3",
      stage: "vertex",
      required: false,
      tag: { semantic: "direction", space: "object" },
    },
    {
      id: "Color",
      label: "Color",
      type: "color4",
      stage: "fragment",
      required: true,
      default: [1, 1, 1, 1],
      tag: { semantic: "color" },
    },
    { id: "AlphaClipThreshold", label: "Alpha Clip Threshold", type: "float", stage: "fragment", required: false },
  ],
  settings: [
    {
      id: "blend",
      label: "Blend Mode",
      control: "enum",
      default: "opaque",
      options: [
        { value: "opaque", label: "Opaque" },
        { value: "alpha", label: "Alpha" },
        { value: "additive", label: "Additive" },
        { value: "premultiplied", label: "Premultiplied" },
      ],
      tooltip: "How the fragment color is combined with what is behind it (the Preview honours this).",
    },
    { id: "twoSided", label: "Two Sided", control: "bool", default: false, tooltip: "Render back faces too." },
    {
      id: "softParticles",
      label: "Soft Particles",
      control: "bool",
      default: false,
      tooltip: "Fade the fragment where it gets close to opaque geometry (the VFX preview adds a floor to show it).",
    },
    {
      id: "softDistance",
      label: "Soft Distance",
      control: "number",
      default: 0.5,
      min: 0.01,
      max: 5,
      step: 0.01,
      tooltip: "World-space length of the soft-particle fade.",
    },
  ],
};

function createProfileRegistry(): ProfileRegistry {
  const r = new ProfileRegistry();
  r.register(debugProfile);
  r.register(genericProfile);
  for (const p of UNITY_PROFILES) r.register(toProfileDef(p));
  for (const p of GODOT_PROFILES) r.register(toProfileDef(p));
  return r;
}

export const defaultProfileRegistry: ProfileRegistry = createProfileRegistry();

// Target profiles (engine-level data). registers Godot the same way.
for (const p of [...UNITY_PROFILES, ...GODOT_PROFILES]) if (!targetProfiles.get(p.id)) targetProfiles.register(p);
export { GODOT_VERSIONS } from "./godot";
export { targetProfiles, activeBlocks } from "./registry";
export * from "./masterStack";
export { lockedReason } from "./lockedProperties";
export { switchProfile, planProfileSwitch, profileOf } from "./switch";
export { optionValue, predicateHolds } from "./canonical";
export * from "./types";
