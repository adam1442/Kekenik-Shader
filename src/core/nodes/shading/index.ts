import type { NodeDef } from "../../registry/nodeDef";
import { ENGINE_NODE_DEFS } from "./engineNodes";
import { LIGHTING_PORTABLE_DEFS } from "./lighting";
import { PARTICLE_DEFS } from "./particleNodes";
import { SCREEN_NODE_DEFS } from "./screenNodes";
import { SPRITE_FX_DEFS } from "./spriteFx";
import { VERTEX_DEFORM_DEFS } from "./vertexDeform";
import { VERTEX_MESH_DEFS } from "./vertexMesh";

/** node library in stable registration order, grouped like the gallery categories. */
const engineLighting = ENGINE_NODE_DEFS.filter((d) => d.category === "Lighting/Engine");
const engineScreen = ENGINE_NODE_DEFS.filter((d) => d.category === "Screen/Depth");
const LIGHTING_NODE_DEFS: NodeDef[] = [...LIGHTING_PORTABLE_DEFS, ...engineLighting];
const VERTEX_NODE_DEFS: NodeDef[] = [...VERTEX_DEFORM_DEFS, ...VERTEX_MESH_DEFS];
const SCREEN_DEPTH_NODE_DEFS: NodeDef[] = [
  ...engineScreen.filter((d) => d.id === "sceneDepth"),
  ...SCREEN_NODE_DEFS.slice(0, 1),
  ...engineScreen.filter((d) => d.id === "sceneColor"),
  ...SCREEN_NODE_DEFS.slice(1),
];
const PARTICLE_SPRITE_NODE_DEFS: NodeDef[] = [...PARTICLE_DEFS, ...SPRITE_FX_DEFS];
export const SHADING_NODE_DEFS: NodeDef[] = [
  ...LIGHTING_NODE_DEFS,
  ...VERTEX_NODE_DEFS,
  ...SCREEN_DEPTH_NODE_DEFS,
  ...PARTICLE_SPRITE_NODE_DEFS,
];
