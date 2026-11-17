import type { SamplePreviewConfig } from "@/core";

/** Unity URP profile of every VFX sample (Godot target = `godot.spatial.vfx`). */
export const VFX_PROFILE = "unity.urp.vfx-unlit";
export const GODOT_VFX = "godot.spatial.vfx";

/** Emitter overrides shared by the particle samples (merged over the preview's default emitter). White colour, alpha envelope only. */
export const envelope = (a: number, fadeIn = 0.1): Array<{ t: number; rgba: [number, number, number, number] }> => [
  { t: 0, rgba: [1, 1, 1, 0] }, { t: fadeIn, rgba: [1, 1, 1, a] }, { t: 0.75, rgba: [1, 1, 1, a * 0.8] }, { t: 1, rgba: [1, 1, 1, 0] },
];

export type Emitter = NonNullable<SamplePreviewConfig["emitter"]>;
