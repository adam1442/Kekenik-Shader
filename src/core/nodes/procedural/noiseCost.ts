import type { NodeDef } from "../../registry/nodeDef";

/**
 * Relative cost of the noise family — fragment ALU as estimated by the static cost model
 * (`core/stats/cost.ts`, Desktop class, optimisation level 1, Hash = Integer), normalised to **2D Value noise = 1.0**.
 * The numbers are produced by the model, not by a profiler; the tests `10d.noise.cost-table` re-measures them and fails when
 * they drift by more than 25 %. Surfaced in node descriptions and in the "heavy noise" hint.
 */
export const NOISE_COST_TABLE: Readonly<Record<string, { relative: number; label: string }>> = {
  "noiseValue:1": { relative: 0.5, label: "Value 1D" },
  "noiseValue:2": { relative: 1, label: "Value 2D" },
  "noiseValue:3": { relative: 2.2, label: "Value 3D" },
  "noiseGradient:2": { relative: 1.4, label: "Gradient 2D" },
  "noiseGradient:3": { relative: 4.8, label: "Gradient 3D" },
  "noiseSimplex:2": { relative: 1.3, label: "Simplex 2D" },
  "noiseSimplex:3": { relative: 2.8, label: "Simplex 3D" },
  "noiseVoronoi:2": { relative: 4, label: "Voronoi 2D" },
  "noiseVoronoi3D:3": { relative: 17.5, label: "Voronoi 3D" },
};

/** One-line cost summary appended to the description of every noise node. */
const NOISE_COST_NOTE =
  "Relative cost (static model, Value 2D = 1×): Value 1× · Simplex 1.3× · Gradient 1.4× · Voronoi 4× (3D: Value 2.2× · Simplex 2.8× · Gradient 4.8× · Voronoi 17.5×). Fractal nodes multiply by their octave count — Quality = Adaptive skips octaves below 8-bit visibility.";

const COST_NODES = new Set([
  "noiseValue",
  "noiseGradient",
  "noiseSimplex",
  "noiseVoronoi",
  "noiseVoronoi3D",
  "noiseFbm",
  "noiseTurbulence",
  "noiseRidged",
  "noiseDomainWarp",
  "noiseCurl2D",
]);

/** Append the cost note to a noise node's description (other nodes are returned unchanged). */
export const withCostNote = (def: NodeDef): NodeDef =>
  COST_NODES.has(def.id) && !def.description.includes("Relative cost")
    ? { ...def, description: `${def.description} ${NOISE_COST_NOTE}` }
    : def;
