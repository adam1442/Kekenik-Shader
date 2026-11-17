/** Gradient presets (≥ 12). Colors are authored as sRGB hex and converted to linear. */
import { fromHex } from "./color";
import { makeGradient, type Gradient, type GradientMode } from "./gradient";

type HexStops = Array<[number, string]>;

function fromHexStops(
  stops: HexStops,
  alphas: Array<[number, number]> = [
    [0, 1],
    [1, 1],
  ],
  mode: GradientMode = "linear",
): Gradient {
  return makeGradient(
    stops.map(([p, h]) => {
      const c = fromHex(h)!;
      return [p, [c.r, c.g, c.b]] as [number, [number, number, number]];
    }),
    alphas,
    mode,
  );
}

export interface GradientPreset {
  id: string;
  name: string;
  gradient: Gradient;
}

export const GRADIENT_PRESETS: readonly GradientPreset[] = [
  {
    id: "grayscale",
    name: "Grayscale",
    gradient: fromHexStops([
      [0, "#000000"],
      [1, "#ffffff"],
    ]),
  },
  {
    id: "fire",
    name: "Fire",
    gradient: fromHexStops([
      [0, "#120000"],
      [0.3, "#a3120b"],
      [0.6, "#ff7a1a"],
      [0.85, "#ffd447"],
      [1, "#fffbe0"],
    ]),
  },
  {
    id: "ice",
    name: "Ice",
    gradient: fromHexStops([
      [0, "#05122b"],
      [0.45, "#2a7de1"],
      [0.8, "#9fe4ff"],
      [1, "#ffffff"],
    ]),
  },
  {
    id: "sunset",
    name: "Sunset",
    gradient: fromHexStops([
      [0, "#1b1464"],
      [0.35, "#b0306c"],
      [0.7, "#ff7e4f"],
      [1, "#ffd98a"],
    ]),
  },
  {
    id: "rainbow",
    name: "Rainbow",
    gradient: fromHexStops([
      [0, "#ff2a2a"],
      [0.2, "#ffd42a"],
      [0.4, "#3bd64a"],
      [0.6, "#27c9ff"],
      [0.8, "#4a4aff"],
      [1, "#c13cff"],
    ]),
  },
  {
    id: "viridis",
    name: "Viridis",
    gradient: fromHexStops([
      [0, "#440154"],
      [0.25, "#3b528b"],
      [0.5, "#21908d"],
      [0.75, "#5dc863"],
      [1, "#fde725"],
    ]),
  },
  {
    id: "magma",
    name: "Magma",
    gradient: fromHexStops([
      [0, "#000004"],
      [0.25, "#51127c"],
      [0.5, "#b73779"],
      [0.75, "#fc8961"],
      [1, "#fcfdbf"],
    ]),
  },
  {
    id: "plasma",
    name: "Plasma",
    gradient: fromHexStops([
      [0, "#0d0887"],
      [0.3, "#7e03a8"],
      [0.55, "#cc4778"],
      [0.8, "#f89540"],
      [1, "#f0f921"],
    ]),
  },
  {
    id: "ocean",
    name: "Ocean",
    gradient: fromHexStops([
      [0, "#021b3a"],
      [0.5, "#0a6e8f"],
      [1, "#7ff0e0"],
    ]),
  },
  {
    id: "forest",
    name: "Forest",
    gradient: fromHexStops([
      [0, "#0b1f10"],
      [0.5, "#2e7d32"],
      [1, "#d4e86b"],
    ]),
  },
  {
    id: "neon",
    name: "Neon",
    gradient: fromHexStops([
      [0, "#ff00c8"],
      [0.5, "#7a3cff"],
      [1, "#00e5ff"],
    ]),
  },
  {
    id: "toxic",
    name: "Toxic",
    gradient: fromHexStops([
      [0, "#0a1400"],
      [0.5, "#4cff00"],
      [1, "#e9ff9a"],
    ]),
  },
  {
    id: "candy",
    name: "Candy",
    gradient: fromHexStops([
      [0, "#ff9ad5"],
      [0.5, "#ffe29a"],
      [1, "#9ae8ff"],
    ]),
  },
  {
    id: "fade-out",
    name: "Fade out (alpha)",
    gradient: fromHexStops(
      [
        [0, "#ffffff"],
        [1, "#ffffff"],
      ],
      [
        [0, 1],
        [1, 0],
      ],
    ),
  },
  {
    id: "fade-in-out",
    name: "Fade in / out (alpha)",
    gradient: fromHexStops(
      [
        [0, "#ffffff"],
        [1, "#ffffff"],
      ],
      [
        [0, 0],
        [0.5, 1],
        [1, 0],
      ],
    ),
  },
  {
    id: "posterized",
    name: "Posterized (constant)",
    gradient: fromHexStops(
      [
        [0, "#264653"],
        [0.25, "#2a9d8f"],
        [0.5, "#e9c46a"],
        [0.75, "#f4a261"],
        [1, "#e76f51"],
      ],
      [
        [0, 1],
        [1, 1],
      ],
      "constant",
    ),
  },
];
