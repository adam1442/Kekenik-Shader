import { NodeRegistry } from "../registry/registry";
import { colorNode, floatNode, vector2Node, vector3Node, vector4Node } from "./constants";
import { masterOutputNode, subgraphInputsNode, subgraphNode, subgraphOutputsNode } from "./graphNodes";
import { uvNode, timeNode, positionNode } from "./inputs";
import { addNode, combineNode, ddxNode, multiplyNode, splitNode } from "./math";
import * as basic from "./math/basic";
import * as interp from "./math/interp";
import * as trig from "./math/trig";
import * as vmath from "./math/vectorMath";
import * as logic from "./math/logic";
import { appendNode, swizzleNode } from "./vector/swizzleAppend";
import { constructMatrixNode, matrixMultiplyNode } from "./vector/matrix";
import { transformNode } from "./vector/transform";
import { boolNode, intNode } from "./input/basic";
import { normalNode, screenPositionNode, vertexColorNode, viewDirectionNode } from "./input/geometry";
import { ALL_TARGETS } from "./kit";
import { propertyNode, sampleTexture2DNode } from "./propertyTexture";
import { keywordBoolNode, keywordEnumNode } from "./keyword";
import { EXTRA_NODE_DEFS, PROCEDURAL_NODE_DEFS } from "./procedural";
import { VISUAL_NODE_DEFS } from "./visual";
import { TEXTURE_KIND_DEFS } from "./visual/textureKinds";
import { SHADING_NODE_DEFS } from "./shading";
import { customInterpolatorNode } from "./shading/customInterpolator";
import { INFO_NODE_DEFS } from "./info";
import { LIGHT_STAGE_DEFS } from "./info/lightStageNodes";
import { customFunctionNode } from "../custom/node";
import { portalInNode, portalOutNode, rerouteNode } from "./structural";

/** All node definitions shipped by the core. New agents append to this list. */
const CORE_NODE_DEFS = [
  rerouteNode,
  portalInNode,
  portalOutNode,
  masterOutputNode,
  subgraphNode,
  subgraphInputsNode,
  subgraphOutputsNode,
  floatNode,
  vector2Node,
  vector3Node,
  vector4Node,
  colorNode,
  addNode,
  multiplyNode,
  splitNode,
  combineNode,
  ddxNode,
  uvNode,
  timeNode,
  positionNode,
  propertyNode,
  sampleTexture2DNode,
  // base library
  intNode,
  boolNode,
  normalNode,
  viewDirectionNode,
  vertexColorNode,
  screenPositionNode,
  ...Object.values(basic),
  ...Object.values(interp),
  ...Object.values(trig),
  ...Object.values(vmath),
  ...Object.values(logic),
  swizzleNode,
  appendNode,
  constructMatrixNode,
  matrixMultiplyNode,
  transformNode,
  // keyword static switches
  keywordBoolNode,
  keywordEnumNode,
  // procedural foundation (noise, shapes / SDF, patterns, gradients, utilities)
  ...PROCEDURAL_NODE_DEFS,
  // UV, texture & colour processing
  ...VISUAL_NODE_DEFS,
  // shading, vertex, screen / depth, particle & sprite effects
  ...SHADING_NODE_DEFS,
  // object / mesh / camera / screen / lighting / sprite information + platform nodes
  ...INFO_NODE_DEFS,
  ...LIGHT_STAGE_DEFS,
  // Custom Function (per-target code bodies)
  customFunctionNode,
  // (U17) — Voronoi 3D, SDF Smooth Subtract / Intersect (Simplex 1D and Triplanar Space extend existing nodes)
  ...EXTRA_NODE_DEFS,
  // (O6) — Custom Interpolator
  customInterpolatorNode,
  // 2 (E9) — Texture 2D Array / Texture 3D / Cubemap samplers + 3-D LUT lookup
  ...TEXTURE_KIND_DEFS,
];

/** Graph plumbing nodes are not "shader nodes": they carry no code-target restriction. */
const PLUMBING = new Set([
  "masterOutput",
  "subgraph",
  "subgraphInputs",
  "subgraphOutputs",
  "property",
  "keywordBool",
  "keywordEnum",
]);

function createNodeRegistry(): NodeRegistry {
  const r = new NodeRegistry();
  // Nodes shipped before had no availability data: everything the GLSL/HLSL/WGSL/Godot/Unity emitters will support.
  for (const d of CORE_NODE_DEFS)
    r.register(d.targets || d.structural || PLUMBING.has(d.id) ? d : { ...d, targets: ALL_TARGETS });
  return r;
}

export const defaultNodeRegistry: NodeRegistry = createNodeRegistry();
