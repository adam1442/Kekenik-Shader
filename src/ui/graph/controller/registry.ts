import type { CanvasController } from "./CanvasController";

/** The controller of the mounted canvas (one canvas at a time). Used by tests and panels. */
let active: CanvasController | null = null;
export const setActiveController = (c: CanvasController | null): void => {
  active = c;
};
export const getActiveController = (): CanvasController | null => active;
