import type { NodeDef } from "../../registry/nodeDef";
import { floatVec, sameAs } from "../../types/generics";
import { baseNode } from "../kit";

/**
 * Custom Interpolator — like Shader Graph's Custom Interpolator: the expression connected to `In` is evaluated PER VERTEX
 * and interpolated to the fragment stage. The node itself is an identity in the IR; the compile pipeline (`core/compile/interpolators.ts`)
 * reads the graph, forces the connected node's cone to the vertex stage through the existing `interpolate` stage-split hint on every
 * backend, and warns (`W_INTERPOLATOR_NON_AFFINE`) when the expression is not affine in the interpolated inputs.
 */
export const CUSTOM_INTERPOLATOR_ID = "customInterpolator";

export const customInterpolatorNode: NodeDef = baseNode({
  id: CUSTOM_INTERPOLATOR_ID,
  category: "Vertex/Interpolation",
  name: "Custom Interpolator",
  synonyms: ["interpolator", "varying", "evaluate in vertex", "vertex to fragment", "per vertex"],
  description:
    "Evaluates the connected expression in the VERTEX stage and passes the result to the fragment stage as an interpolated value (cheaper per pixel). Exact for affine expressions (uv × constant + offset, vertex colour × uniform …); for anything else (normalize, sin, pow, varying × varying) the result differs from per-pixel evaluation and the node warns.",
  inputs: [{ id: "in", name: "In", type: floatVec("T"), default: 0 }],
  outputs: [{ id: "out", name: "Out", type: sameAs("in") }],
  targetNotes: {
    all: "Emitted as a vertex-stage computation + one interpolator (GLSL out/in, HLSL / Unity Varyings TEXCOORDn, WGSL @location(n), Godot varying). Interpolation is perspective-correct, so affine expressions match per-pixel evaluation exactly.",
  },
  build: (c) => ({ out: c.in("in") }),
});
