/**
 * The viewport backdrop colour for each background mode — ONE table shared by the CSS layer behind the transparent canvas
 * (`PreviewPanel`) and the emulation's opaque-colour pass (`EmulationPass`, what Scene Color shows behind the object).
 * Gradient / checker modes use their mean colour for Scene Color (a flat approximation; the environment mode renders the real sky sphere).
 */
export const BACKDROP_HEX = {
  dark: "#0e0f12",
  light: "#d9dce3",
  gradient: "#1d2027",
  checker: "#2f323a",
  environment: "#0e0f12",
} as const;

/** sRGB hex of the backdrop of a background mode. `solid` uses the user's colour. */
export function backdropHex(bg: string, solid: string): string {
  if (bg === "solid") return solid;
  return (BACKDROP_HEX as Record<string, string>)[bg] ?? BACKDROP_HEX.gradient;
}
