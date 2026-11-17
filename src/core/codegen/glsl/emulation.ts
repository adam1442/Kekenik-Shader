import type { BuiltinUniformName } from "./builtins";

/** One emulated engine intrinsic: its GLSL expression, the host uniforms it reads and any extra declarations it needs. */
export interface GlslEmulationHit {
  expr: string;
  uses?: readonly BuiltinUniformName[];
  /** Full declaration lines, e.g. `uniform highp sampler2D ks_SceneDepthTex;`. */
  decls?: readonly string[];
}

/**
 * Resolver for engine intrinsics (`engine` IR op, e.g. `ks.screen.sceneDepthRaw`) that the portable GLSL host contract does not
 * provide. Supplied by the PREVIEW (`src/preview/emulation`) — never by export. An unresolved name becomes
 * `W_PREVIEW_NOT_EMULATED` (+ a zero value of the right type) instead of `E_NODE_UNSUPPORTED_TARGET`.
 */
export interface GlslEmulation {
  /** `args` = GLSL texts of the intrinsic's arguments (e.g. the screen UV of `ks.screen.sceneDepthRaw`). */
  resolve(name: string, args: readonly string[]): GlslEmulationHit | undefined;
}
