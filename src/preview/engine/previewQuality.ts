/** Pixel ratio from Preferences → Preview quality (`<html data-preview-quality>`): low ¾ × (≤ 1), medium ≤ 1, high ≤ 2. Applied on the next resize. */
export function previewDpr(): number {
  const d = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  const q = typeof document !== "undefined" ? document.documentElement.dataset.previewQuality : undefined;
  return q === "low" ? Math.max(0.5, Math.min(1, d) * 0.75) : q === "medium" ? Math.min(1, d) : Math.min(2, d);
}
