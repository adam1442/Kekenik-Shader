import { create } from "zustand";

/**
 * fp16 emulation debug mode . When on, the preview shader rounds every temporary the precision pass marked `half` to the
 * nearest binary16 value (`packHalf2x16` / `unpackHalf2x16`), so banding and precision artefacts of the exported `half` / `mediump` code are
 * visible on desktop GPUs. Preview-only: never part of an export.
 */
export const useHalfEmulation = create<{ on: boolean; set: (on: boolean) => void }>((set) => ({
  on: false,
  set: (on) => set({ on }),
}));
export const getEmulateHalf = (): boolean => useHalfEmulation.getState().on;
