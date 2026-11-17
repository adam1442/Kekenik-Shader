/**
 * Godot `stencil_mode` . Spelling from the official Godot "Spatial shaders" reference (Stencil modes table) — verified
 * against the docs text, but never compiled from this sandbox → manual check `stencil-mode`. The feature is documented as EXPERIMENTAL
 * and first shipped in Godot 4.5 (version gate `stencil_mode`). Spatial shaders only (not canvas_item).
 */
export const STENCIL_FLAGS = ["read", "write", "write_if_depth_fail"] as const;
export const STENCIL_COMPARES = [
  "compare_always",
  "compare_equal",
  "compare_not_equal",
  "compare_less",
  "compare_less_or_equal",
  "compare_greater",
  "compare_greater_or_equal",
] as const;
export type StencilCompare = (typeof STENCIL_COMPARES)[number];
export const STENCIL_REF_MAX = 255;

/** Surface-option `stencilMode` → flag list. */
const STENCIL_PRESETS: Readonly<Record<string, readonly (typeof STENCIL_FLAGS)[number][]>> = {
  off: [],
  write: ["write"],
  read: ["read"],
  readWrite: ["read", "write"],
};

/** The statement body (without `stencil_mode ` / `;`), e.g. `write, compare_always, 1`. `undefined` = stencil off. */
export function stencilStatement(
  preset: string,
  compare: string,
  reference: number,
  depthFail: boolean,
): string | undefined {
  const flags = [...(STENCIL_PRESETS[preset] ?? [])] as string[];
  if (flags.length === 0) return undefined;
  if (depthFail && flags.includes("write") === false) flags.push("write");
  if (depthFail) flags.push("write_if_depth_fail");
  const cmp = (STENCIL_COMPARES as readonly string[]).includes(`compare_${compare}`)
    ? `compare_${compare}`
    : "compare_always";
  const ref = Math.max(0, Math.min(STENCIL_REF_MAX, Math.round(Number.isFinite(reference) ? reference : 1)));
  return [...flags, cmp, String(ref)].join(", ");
}
