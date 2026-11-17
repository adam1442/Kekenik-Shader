import {
  type ShaderType,
  type StorageType,
  componentCount,
  isColor,
  isOpaque,
  isMatrix,
  storageOf,
  floatVecOfSize,
} from "./shaderType";

/**
 * Generic type constraints for node ports.
 *  - `type`    concrete type
 *  - `generic` resolved by inference from the connected sources; ports of one node sharing `group` resolve together
 *  - `sameAs`  (outputs only) same resolved type as another port of the same node
 */
export type GenericSet = "numeric" | "floatVec";
export type TypeSpec =
  { k: "type"; type: ShaderType } | { k: "generic"; set: GenericSet; group: string } | { k: "sameAs"; port: string };

export const T = (type: ShaderType): TypeSpec => ({ k: "type", type });
/** `Numeric` = float | int | vec2 | vec3 | vec4 (colors/bools are mapped onto these). */
export const numeric = (group = "T"): TypeSpec => ({ k: "generic", set: "numeric", group });
/** `FloatVec` = float | vec2 | vec3 | vec4 (ints are promoted to float). */
export const floatVec = (group = "T"): TypeSpec => ({ k: "generic", set: "floatVec", group });
export const sameAs = (port: string): TypeSpec => ({ k: "sameAs", port });

const NUMERIC: readonly ShaderType[] = ["float", "int", "vec2", "vec3", "vec4"];
const FLOAT_VEC: readonly ShaderType[] = ["float", "vec2", "vec3", "vec4"];

function setMembers(set: GenericSet): readonly ShaderType[] {
  return set === "numeric" ? NUMERIC : FLOAT_VEC;
}

export function setContains(set: GenericSet, t: ShaderType): boolean {
  return setMembers(set).includes(t);
}

/** Can this type take part in generic math at all (after color/bool mapping)? */
export function isMathCandidate(t: ShaderType): boolean {
  return !isOpaque(t) && !isMatrix(t);
}

/** Map a source type onto the math domain: bool → float, color → vec3, color4 → vec4. */
function mathType(t: ShaderType): ShaderType {
  if (t === "bool") return "float";
  return isColor(t) ? storageOf(t) : t;
}

/**
 * Join the types flowing into one generic group.
 * Rules: vectors win over scalars (scalars splat); between different vector sizes the SMALLEST wins
 * (same as Unity Shader Graph's "Dynamic Vector"; the larger input is truncated and warned about);
 * int stays int only if every contributor is int (and the set is `numeric`); otherwise float.
 * Opaque/matrix types do not contribute (the later conversion check reports them as forbidden).
 * With no contributors the group defaults to `float`.
 */
export function joinTypes(set: GenericSet, sources: readonly ShaderType[]): StorageType {
  const mapped = sources.filter(isMathCandidate).map(mathType);
  if (mapped.length === 0) return "float";
  const vecDims = mapped.map(componentCount).filter((n) => n > 1);
  if (vecDims.length > 0) return floatVecOfSize(Math.min(...vecDims));
  const allInt = mapped.every((t) => t === "int");
  return set === "numeric" && allInt ? "int" : "float";
}
