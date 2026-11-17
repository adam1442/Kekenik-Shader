/** A procedural RGBA8 image (row 0 = TOP row, like PNG). */
export interface Tex { w: number; h: number; data: Uint8Array; /** What it is (documentation + manifest). */ note: string }
