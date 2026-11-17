import clsx, { type ClassValue } from "clsx";

/** Class-name joiner used by every design-system component. */
export function cx(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/** Clamp — single implementation lives in `core/values/numeric` (re-exported for the UI). */
export { clamp } from "@/core/values/numeric";
