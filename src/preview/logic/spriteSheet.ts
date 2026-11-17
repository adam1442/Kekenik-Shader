/**
 * Sprite-sheet math (pure). A sheet is `cols × rows` equally sized cells; frame 0 is the TOP-LEFT cell and frames run
 * left→right, top→bottom (the order every sprite tool exports). UV space has v = 0 at the BOTTOM of the image.
 */
export type SheetLoop = "loop" | "once" | "pingpong";

export interface SheetConfig {
  cols: number;
  rows: number;
  /** Frames actually used (≤ cols·rows); 0 / undefined → all cells. */
  frameCount?: number;
  fps: number;
  loop: SheetLoop;
}

export const DEFAULT_SHEET: SheetConfig = { cols: 1, rows: 1, fps: 12, loop: "loop" };

export interface UvRect {
  /** Left edge (u). */
  u: number;
  /** Bottom edge (v, 0 = bottom of the image). */
  v: number;
  w: number;
  h: number;
}

const clampInt = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.floor(Number.isFinite(n) ? n : lo)));

/** Number of frames the animation plays. */
export function frameTotal(c: SheetConfig): number {
  const cells = clampInt(c.cols, 1, 256) * clampInt(c.rows, 1, 256);
  return c.frameCount && c.frameCount > 0 ? Math.min(cells, Math.floor(c.frameCount)) : cells;
}

/** Frame index shown at time `t` seconds. */
export function frameAt(c: SheetConfig, t: number): number {
  const n = frameTotal(c);
  if (n <= 1) return 0;
  const step = Math.floor(Math.max(0, t) * Math.max(0, c.fps));
  if (c.loop === "once") return Math.min(n - 1, step);
  if (c.loop === "pingpong") {
    const period = 2 * (n - 1);
    const k = step % period;
    return k < n ? k : period - k;
  }
  return step % n;
}

/** UV rectangle of a frame (frame 0 = top-left cell). */
export function frameRect(c: SheetConfig, frame: number): UvRect {
  const cols = clampInt(c.cols, 1, 256);
  const rows = clampInt(c.rows, 1, 256);
  const f = clampInt(frame, 0, cols * rows - 1);
  const col = f % cols;
  const rowFromTop = Math.floor(f / cols);
  return { u: col / cols, v: (rows - 1 - rowFromTop) / rows, w: 1 / cols, h: 1 / rows };
}

/** Quad size (width, height) for one frame of an image so that the height is `height` and the aspect is preserved. */
export function spriteQuadSize(
  imageW: number,
  imageH: number,
  c: Pick<SheetConfig, "cols" | "rows">,
  height = 1,
): [number, number] {
  const fw = imageW / clampInt(c.cols, 1, 256);
  const fh = imageH / clampInt(c.rows, 1, 256);
  if (!(fw > 0) || !(fh > 0)) return [height, height];
  return [(height * fw) / fh, height];
}
