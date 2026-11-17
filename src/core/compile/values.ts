import type { PortValue } from "../graph/types";
import { type ShaderType, componentCount, isScalar } from "../types/shaderType";

/**
 * Coerce an inline value to the flat component list of `ty`.
 * Scalars splat across vector types; arrays must match the component count exactly. Returns null if invalid
 * (wrong length, non-finite, opaque target type).
 */
export function coerceValue(ty: ShaderType, v: PortValue): number[] | null {
  const n = componentCount(ty);
  if (n === 0) return null;
  const nums = typeof v === "boolean" ? [v ? 1 : 0] : typeof v === "number" ? [v] : v;
  if (!Array.isArray(nums) || nums.some((x) => typeof x !== "number" || !Number.isFinite(x))) return null;
  if (isScalar(ty)) {
    if (nums.length !== 1) return null;
    return ty === "bool" ? [nums[0] ? 1 : 0] : ty === "int" ? [Math.trunc(nums[0]!)] : [nums[0]!];
  }
  if (nums.length === n) return [...nums];
  if (nums.length === 1 && ty !== "mat2" && ty !== "mat3" && ty !== "mat4") return new Array<number>(n).fill(nums[0]!);
  return null;
}
