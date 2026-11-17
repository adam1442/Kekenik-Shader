import type { NodeDef } from "../../registry/nodeDef";
import { CAMERA_NODE_DEFS } from "./cameraNodes";
import { LIGHT_INFO_DEFS } from "./lightNodes";
import { MESH_NODE_DEFS } from "./meshNodes";
import { OBJECT_NODE_DEFS } from "./objectNodes";
import { PLATFORM_NODE_DEFS } from "./platformNodes";
import { SCREEN_INFO_DEFS } from "./screenNodes";
import { SPRITE_INFO_DEFS } from "./spriteNodes";

/** object / mesh / camera / screen / lighting / sprite information + platform nodes. */
export const INFO_NODE_DEFS: NodeDef[] = [
  ...OBJECT_NODE_DEFS,
  ...MESH_NODE_DEFS,
  ...CAMERA_NODE_DEFS,
  ...SCREEN_INFO_DEFS,
  ...LIGHT_INFO_DEFS,
  ...SPRITE_INFO_DEFS,
  ...PLATFORM_NODE_DEFS,
];
