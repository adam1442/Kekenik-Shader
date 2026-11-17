/**
 * Interpolator packing . Scalars / vec2 / vec3 values are packed into the free components of vec4 varyings, first-fit
 * decreasing, WITHOUT splitting a vector across two slots (a split would force the backend to reassemble it). The plan is what the
 * cost model, Statistics and the budget rows report ("Interpolators (vec4, packed)").
 *
 * Scope note: this is the layout plan + slot accounting. The five backends still declare one varying per value — GLSL / D3D drivers pack
 * small varyings themselves, but the layout below is what a packed emission would use (see roadmap → Deferred).
 */
export interface PackItem {
  id: string;
  comps: number;
}
interface PackedItem extends PackItem {
  offset: number;
}
interface PackedSlot {
  index: number;
  used: number;
  items: PackedItem[];
}
export interface PackPlan {
  slots: PackedSlot[];
  slotCount: number;
  /** Total scalar components carried. */
  scalars: number;
  /** One slot per value (what an unpacked emission needs). */
  unpackedCount: number;
  /** Per-target limit of vec4 varyings (GLSL ES 3.00 ≥ 15, conservative mobile 8). */
  limit: number;
  fits: boolean;
}

const INTERPOLATOR_LIMITS = { glsl: 15, mobile: 8 } as const;

export function packInterpolators(items: readonly PackItem[], limit: number = INTERPOLATOR_LIMITS.glsl): PackPlan {
  const sorted = items
    .map((i) => ({ id: i.id, comps: Math.min(4, Math.max(1, Math.round(i.comps))) }))
    .sort((a, b) => b.comps - a.comps || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const slots: PackedSlot[] = [];
  for (const it of sorted) {
    let slot = slots.find((s) => 4 - s.used >= it.comps);
    if (!slot) {
      slot = { index: slots.length, used: 0, items: [] };
      slots.push(slot);
    }
    slot.items.push({ ...it, offset: slot.used });
    slot.used += it.comps;
  }
  return {
    slots,
    slotCount: slots.length,
    scalars: sorted.reduce((s, i) => s + i.comps, 0),
    unpackedCount: sorted.length,
    limit,
    fits: slots.length <= limit,
  };
}
