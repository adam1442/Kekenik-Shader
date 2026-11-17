/** A Space press shorter than this (no drag / wheel in between) is a "tap" that opens the add-node search (U1). */
const SPACE_TAP_MS = 250;

/** Pure tap-vs-hold decision: `used` = a pointer drag or wheel happened while Space was held. */
export const isSpaceTap = (used: boolean, downAt: number, now: number): boolean => !used && now - downAt < SPACE_TAP_MS;
