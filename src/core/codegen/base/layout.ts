import { type RefTarget, targetReferenceName } from "../../properties/names";
import type { IRModule } from "../../ir/types";
import { isTextureType, type StorageType } from "../../types/shaderType";
import type { Property } from "../../properties/model";
import type { Namer } from "./names";

/** One declared uniform of the generated shader (an exposed or hidden Property). */
export interface UniformEntry {
  prop: string;
  ty: StorageType;
  /** Identifier used in the generated code. */
  name: string;
  property: Property;
  kind: "value" | "texture";
}

/**
 * Uniform declaration layout: properties in module order (graph order of first use), names derived from the canonical
 * reference name per target (`_MainTex` → `u_Main_Tex` for GLSL), made unique against everything already taken.
 * Textures are listed after values so the declaration block reads: scalars/vectors first, then samplers.
 */
export function layoutUniforms(module: IRModule, target: RefTarget, namer: Namer): UniformEntry[] {
  const entries = module.uniforms.map((u): UniformEntry => {
    const base = targetReferenceName(u.property.referenceName, target);
    return {
      prop: u.prop,
      ty: u.ty,
      name: namer.fresh(base, "u"),
      property: u.property,
      kind: isTextureType(u.ty) ? "texture" : "value",
    };
  });
  return [...entries.filter((e) => e.kind === "value"), ...entries.filter((e) => e.kind === "texture")];
}
