import type { Intrinsic } from "../../ir/intrinsics";
import type { BackendTraits } from "../../ir/traits";
import type { BackendId } from "../../ir/types";

/**
 * Intrinsic mapping tables. A backend asks `intrinsicEmit(traits, fn)`:
 *  - `{kind:"native", name}`  → call the language function `name(args…)` (spelling from `BackendTraits.intrinsicNames`)
 *  - `{kind:"helper", id}`    → call the on-demand helper `id` (deterministic cross-backend semantics)
 *  - `{kind:"inline", ...}`   → expanded by the backend (e.g. saturate)
 *
 * Intrinsics that differ between backends beyond spelling live in the per-backend tables below.
 */
export type IntrinsicEmit = { kind: "native"; name: string } | { kind: "helper"; id: string } | { kind: "inline" };

/** Backends that emit these intrinsics through a helper (semantics pinned by the IR, see ir/intrinsics.ts). */
const HELPERS: Partial<Record<BackendId, Partial<Record<Intrinsic, string>>>> = {
  // round: IR leaves exact .5 unspecified; helper = floor(x + 0.5), identical to the CPU reference (`Math.round`).
  glsl: { round: "ks_round", ihash: "ks_ihash" },
  godot: { round: "ks_round", ihash: "ks_ihash" },
  // HLSL round() is round-half-even: same helper keeps all backends bit-identical to the CPU reference.
  hlsl: { round: "ks_round", ihash: "ks_ihash" },
  unity: { round: "ks_round", ihash: "ks_ihash" },
};

const INLINE: ReadonlySet<Intrinsic> = new Set<Intrinsic>(["saturate"]);

export function intrinsicEmit(traits: BackendTraits, fn: Intrinsic): IntrinsicEmit {
  const helper = HELPERS[traits.id]?.[fn];
  if (helper) return { kind: "helper", id: helper };
  if (INLINE.has(fn)) return { kind: "inline" };
  if (fn === "mod" && !traits.modIsFloorMod) return { kind: "helper", id: "ks_mod" };
  return { kind: "native", name: traits.intrinsicNames[fn] ?? fn };
}

/** Helper function name for a call: `ihash` has one non-overloaded helper per operand arity (`ks_ihash1…4`). */
export const helperName = (id: string, fn: Intrinsic, argComponents: number): string =>
  fn === "ihash" ? `${id}${argComponents}` : id;
