import type { NodeDef } from "../../registry/nodeDef";
import { ditherNode } from "./dither";
import { curlNoiseNode, domainWarpNode, fbmNode, ridgedNode, turbulenceNode } from "./fractalNodes";
import { angularGradientNode, diamondGradientNode, linearGradientNode, radialGradientNode } from "./gradientNodes";
import { determinantNode, inverseNode, matrixColumnsNode, transposeNode } from "./matrixNodes";
import { gradientNoiseNode, hashNodes, simplexNoiseNode, valueNoiseNode } from "./noiseNodes";
import { brickNode, checkerNode, hexNode, stripesNode } from "./patternNodes";
import {
  ellipseNode,
  intersectNode,
  polygonNode,
  rectNode,
  ringNode,
  roundRectNode,
  sdfMaskNode,
  segmentNode,
  smoothIntersectNode,
  smoothSubtractNode,
  smoothUnionNode,
  starNode,
  subtractNode,
  unionNode,
} from "./shapeNodes";
import {
  cartesianToPolarNode,
  flipNode,
  pingPongNode,
  polarToCartesianNode,
  previewNode,
  remapSafeNode,
  rotateAxisNode,
  sawtoothNode,
  saturateVariantNode,
  smoothLoopNode,
} from "./utilityNodes";
import { voronoiNode } from "./voronoi";
import { voronoi3DNode } from "./voronoi3d";
import { withCostNote } from "./noiseCost";

/** node library, in stable registration order. */
const NOISE_NODE_DEFS: NodeDef[] = [
  valueNoiseNode,
  gradientNoiseNode,
  simplexNoiseNode,
  voronoiNode,
  fbmNode,
  turbulenceNode,
  ridgedNode,
  domainWarpNode,
  curlNoiseNode,
  ...hashNodes,
  ditherNode,
].map(withCostNote);
const SHAPE_NODE_DEFS: NodeDef[] = [
  rectNode,
  roundRectNode,
  ellipseNode,
  polygonNode,
  starNode,
  ringNode,
  segmentNode,
  unionNode,
  subtractNode,
  intersectNode,
  smoothUnionNode,
  sdfMaskNode,
  checkerNode,
  brickNode,
  hexNode,
  stripesNode,
  linearGradientNode,
  radialGradientNode,
  angularGradientNode,
  diamondGradientNode,
];
const UTILITY_NODE_DEFS: NodeDef[] = [
  previewNode,
  remapSafeNode,
  rotateAxisNode,
  polarToCartesianNode,
  cartesianToPolarNode,
  flipNode,
  saturateVariantNode,
  transposeNode,
  determinantNode,
  inverseNode,
  matrixColumnsNode,
  pingPongNode,
  sawtoothNode,
  smoothLoopNode,
];
/** (U17) additions — registered AFTER the 8a library (kept out of PROCEDURAL_NODE_DEFS so the 8a snapshot / gallery tests stay exact). */
export const EXTRA_NODE_DEFS: NodeDef[] = [voronoi3DNode, smoothSubtractNode, smoothIntersectNode].map(withCostNote);
export const PROCEDURAL_NODE_DEFS: NodeDef[] = [...NOISE_NODE_DEFS, ...SHAPE_NODE_DEFS, ...UTILITY_NODE_DEFS];
