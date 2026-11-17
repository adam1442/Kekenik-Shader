import type { BackendId } from "../ir/types";
import type { ClipRange } from "./depth";

/** Backend ids that can be the (simulated) compile target of a graph. `ir` is the text printer and behaves like GLSL. */
export type SceneTarget = Exclude<BackendId, "ir">;
export const SCENE_TARGETS: readonly SceneTarget[] = ["glsl", "wgsl", "hlsl", "unity", "godot"];

/** Per-target rendering conventions. They are COMPILE-TIME constants (Is Reversed-Z, Is Y-Flipped, Target Switch, …). */
export interface TargetConventions {
  /** Depth buffer stores 1 at the near plane. */
  reversedZ: boolean;
  /** NDC z range of the projection matrix the target uses. */
  clipRange: ClipRange;
  /** NDC / render-target Y points DOWN relative to the OpenGL convention (Vulkan-style) — the screen UV origin may need flipping. */
  yFlipped: boolean;
  /** The target shades in linear colour space (no implicit sRGB handling on the shader's side). */
  linearColor: boolean;
  /** Free-text caveat shown in docs and the Scene Simulation panel. */
  note: string;
}

export const TARGET_CONVENTIONS: Readonly<Record<SceneTarget, TargetConventions>> = {
  glsl: {
    reversedZ: false,
    clipRange: "-11",
    yFlipped: false,
    linearColor: false,
    note: "WebGL2 / OpenGL: standard Z, NDC z −1…1, origin bottom-left. Output is written to the canvas as-is (no linear → sRGB conversion).",
  },
  wgsl: {
    reversedZ: false,
    clipRange: "01",
    yFlipped: false,
    linearColor: false,
    note: "WebGPU: clip z 0…1, standard Z by default (the host may choose reversed-Z), framebuffer origin top-left but NDC Y up.",
  },
  hlsl: {
    reversedZ: false,
    clipRange: "01",
    yFlipped: false,
    linearColor: false,
    note: "Generic D3D-style HLSL: clip z 0…1, standard Z unless the host renders reversed-Z.",
  },
  unity: {
    reversedZ: true,
    clipRange: "01",
    yFlipped: false,
    linearColor: true,
    note: "Unity URP: UNITY_REVERSED_Z on D3D11/12, Metal, Vulkan, consoles (NOT on OpenGL ES 3 / WebGL). Y-flip depends on the platform and on whether the target is a render texture (_ProjectionParams.x). Assumes a Linear colour-space project.",
  },
  godot: {
    reversedZ: true,
    clipRange: "01",
    yFlipped: true,
    linearColor: true,
    note: "Godot 4 (Forward+ / Mobile, Vulkan): reversed-Z, NDC Y points down. The Compatibility renderer (OpenGL) is NOT reversed-Z.",
  },
};

/** Target used for compile-time decisions: the IR printer behaves like GLSL. */
export const sceneTargetOf = (id: BackendId | undefined): SceneTarget => (id && id !== "ir" ? id : "glsl");

export const TARGET_LABEL: Readonly<Record<SceneTarget, string>> = {
  glsl: "GLSL (WebGL2)",
  wgsl: "WGSL (WebGPU)",
  hlsl: "HLSL",
  unity: "Unity URP",
  godot: "Godot 4",
};
