import type { GlslEmulationHit } from "@/core/codegen/glsl/emulation";
import { LIGHT_STAGE_ENTRIES } from "@/core/engine/lightStageEntries";
import type { SceneTarget } from "@/core/engine/targets";

/**
 * Engine-intrinsic EMULATION TABLE of the preview : intrinsic id → GLSL implementation + the resources the preview
 * must render for it. Every `engine` builtin of `core/engine/builtinMap` that the portable GLSL host contract does not already
 * resolve (`core/codegen/dialect/engine.ts`) MUST appear here, either `emulated` or `notEmulated(reason)` — test `10b.emu.table-complete`.
 */
export type Resource = "depth" | "color" | "normals";
interface EmuContext {
  target: SceneTarget;
  reversedZ: boolean;
}
type EmuGl = (c: EmuContext, a: readonly string[]) => GlslEmulationHit;
export type EmuEntry =
  | { kind: "emulated"; resources: readonly Resource[]; note: string; gl: EmuGl }
  | { kind: "notEmulated"; reason: string };

const notEmulated = (reason: string): EmuEntry => ({ kind: "notEmulated", reason });
const emu = (resources: readonly Resource[], note: string, gl: EmuGl): EmuEntry => ({
  kind: "emulated",
  resources,
  note,
  gl,
});

export const DEPTH_TEX = "ks_SceneDepthTex";
export const COLOR_TEX = "ks_SceneColorTex";
export const NORMALS_TEX = "ks_SceneNormalsTex";
const NO_ADDITIONAL =
  "The preview scene has no per-object additional lights: the emulation is a scene with ZERO additional lights (count 0, black colour, full attenuation).";

export const EMULATION_TABLE: Readonly<Record<string, EmuEntry>> = {
  "ks.screen.sceneDepthRaw": emu(
    ["depth"],
    "Depth pre-pass of the scene props (+ the shaded mesh when opaque). Raw value follows the simulated depth convention (reversed-Z: 1 − d).",
    (c, a) => ({
      expr: c.reversedZ ? `(1.0 - texture(${DEPTH_TEX}, ${a[0]}).r)` : `texture(${DEPTH_TEX}, ${a[0]}).r`,
      decls: [`uniform highp sampler2D ${DEPTH_TEX}; // preview depth pre-pass (window-space depth, 0 = near)`],
    }),
  ),
  "ks.screen.sceneColor": emu(
    ["color"],
    "Opaque colour render of backdrop + ground + props WITHOUT the shaded mesh.",
    (_c, a) => ({
      expr: `texture(${COLOR_TEX}, ${a[0]}).rgb`,
      decls: [`uniform highp sampler2D ${COLOR_TEX}; // preview opaque colour (what is behind the object)`],
    }),
  ),
  "ks.screen.sceneNormals": emu(
    ["normals"],
    "Normals pre-pass of the scene props (+ the shaded mesh when opaque): WORLD-space unit normals (URP DepthNormals is also world-space).",
    (_c, a) => ({
      expr: `texture(${NORMALS_TEX}, ${a[0]}).xyz`,
      decls: [`uniform highp sampler2D ${NORMALS_TEX}; // preview normals pre-pass (world-space, -1..1)`],
    }),
  ),
  "ks.camera.nearFar": emu([], "Camera near / far from the host frame block.", () => ({
    expr: "ks_CameraParams.xy",
    uses: ["ks_CameraParams"],
  })),
  "ks.light.reflectionProbe": notEmulated(
    "The preview's image-based light lives in the lighting prelude, not in the portable host contract; sampling it from graph code is not wired.",
  ),
  "ks.light.additional.count": emu([], NO_ADDITIONAL, () => ({ expr: "0.0" })),
  "ks.light.additional.direction": emu([], NO_ADDITIONAL, () => ({ expr: "vec3(0.0, 1.0, 0.0)" })),
  "ks.light.additional.color": emu([], NO_ADDITIONAL, () => ({ expr: "vec3(0.0)" })),
  "ks.light.additional.attenuation": emu([], NO_ADDITIONAL, () => ({ expr: "vec2(0.0, 1.0)" })),
  // Godot light() stage data (10e-2): exists once per light inside the engine only — never resolvable in the preview (thumbnails show "no preview").
  ...Object.fromEntries(
    LIGHT_STAGE_ENTRIES.map((e) => [
      e.id,
      notEmulated(
        "Godot light()-stage data is evaluated once per light inside Godot; the preview lighting prelude has no per-light user hook.",
      ),
    ]),
  ),
};
