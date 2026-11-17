import type { ParamValue } from "@/core";

/** HDR colour helpers . The stored value is ALWAYS linear float RGBA; HDR only switches the picker mode and nothing clamps. */

/** True when the parameter `paramId` of a node of type `defId` is an HDR colour (Color node: `value` while `hdr` is on). */
export const isHdrColor = (defId: string, paramId: string, params: Record<string, ParamValue>): boolean =>
  defId === "color" && paramId === "value" && params.hdr === true;

/** Clamp RGB to [0, 1] (alpha is clamped too); null when `v` is not a colour array. Used when HDR is switched OFF. */
export function clampColorLdr(v: ParamValue | undefined): number[] | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  return v.map((x) => Math.min(1, Math.max(0, Number(x))));
}
