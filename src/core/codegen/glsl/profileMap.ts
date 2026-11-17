import type { ExprId, IRModule } from "../../ir/types";

/**
 * Maps the master-block outputs of a profile onto GLSL's two fixed outputs (vertex position, fragment color).
 * Supported profiles: `generic` (Generic Fragment) and the Agent-1b `debug` profile.
 */
export interface GlslSlots {
  /** Vertex position offset added to the object-space position (generic). */
  vertexOffset?: ExprId;
  /** Absolute object-space vertex position (debug profile). */
  vertexPosition?: ExprId;
  /** RGBA color (generic). */
  color?: ExprId;
  /** RGB color + optional alpha (debug). */
  rgb?: ExprId;
  alpha?: ExprId;
  /** Fragments with `color.a < threshold` are discarded. */
  alphaClip?: ExprId;
}

export function mapSlots(module: IRModule): GlslSlots {
  const by = (slot: string): ExprId | undefined => module.outputs.find((o) => o.slot === slot)?.value;
  const out: GlslSlots = {};
  const set = <K extends keyof GlslSlots>(k: K, v: ExprId | undefined) => {
    if (v !== undefined) out[k] = v;
  };
  switch (module.profileId) {
    case "generic":
      set("vertexOffset", by("VertexOffset"));
      set("color", by("Color"));
      set("alphaClip", by("AlphaClipThreshold"));
      return out;
    case "debug":
      set("vertexPosition", by("Position"));
      set("rgb", by("BaseColor"));
      set("alpha", by("Alpha"));
      return out;
    default:
      if (module.profileId.startsWith("unity.") || module.profileId.startsWith("godot.")) {
        // Engine profiles: the preview shows the canonical blocks (clip only when the threshold block is active — see MasterBlock.shownWhen).
        set("vertexPosition", by("positionOS"));
        set("rgb", by("baseColor"));
        set("alpha", by("alpha"));
        set("alphaClip", by("alphaClipThreshold"));
        return out;
      }
      throw new Error(`The GLSL backend has no mapping for profile "${module.profileId}" (supported: generic, debug)`);
  }
}
