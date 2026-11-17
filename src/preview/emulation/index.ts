import type { GlslEmulation } from "@/core/codegen/glsl/emulation";
import { TARGET_CONVENTIONS, type SceneTarget } from "@/core/engine/targets";
import { COLOR_TEX, DEPTH_TEX, EMULATION_TABLE, NORMALS_TEX, type Resource } from "./table";

/** Switches of the Simulation panel that make an engine resource unavailable (e.g. "URP Depth Texture off"). */
export interface ResourceSwitches {
  depthTexture: boolean;
  opaqueTexture: boolean;
  normalsTexture?: boolean;
}
const ALL_RESOURCES: ResourceSwitches = { depthTexture: true, opaqueTexture: true, normalsTexture: true };

/**
 * The emulation of one preview compile: resolves engine intrinsics against the simulated `target` conventions. A resource whose
 * Simulation switch is off behaves like the engine without it: the intrinsic is reported (warning) and a neutral value is used.
 */
export function createEmulation(target: SceneTarget, sw: ResourceSwitches = ALL_RESOURCES): GlslEmulation {
  const ctx = { target, reversedZ: TARGET_CONVENTIONS[target].reversedZ };
  return {
    resolve(name, args) {
      const e = EMULATION_TABLE[name];
      if (!e || e.kind !== "emulated") return undefined;
      if (e.resources.includes("depth") && !sw.depthTexture) return undefined;
      if (e.resources.includes("color") && !sw.opaqueTexture) return undefined;
      if (e.resources.includes("normals") && sw.normalsTexture === false) return undefined;
      return e.gl(ctx, args);
    },
  };
}

/** Resources a compiled preview fragment shader reads (decided from its text: the samplers are declared only when used). */
export function resourcesUsedBy(fragSource: string): Set<Resource> {
  const out = new Set<Resource>();
  if (new RegExp(`\\b${DEPTH_TEX}\\b`).test(fragSource)) out.add("depth");
  if (new RegExp(`\\b${COLOR_TEX}\\b`).test(fragSource)) out.add("color");
  if (new RegExp(`\\b${NORMALS_TEX}\\b`).test(fragSource)) out.add("normals");
  return out;
}
