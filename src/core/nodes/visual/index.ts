import type { NodeDef } from "../../registry/nodeDef";
import { COLOR_ADJUST_DEFS } from "./colorAdjust";
import { COLOR_BASIC_DEFS } from "./colorNodes";
import { COLOR_MASK_DEFS } from "./colorMasks";
import { GRADIENT_DEFS } from "./gradientStops";
import { NORMAL_DEFS } from "./normalNodes";
import { TEXTURE_BASIC_DEFS } from "./textureNodes";
import { UV_BASIC_DEFS } from "./uvBasic";
import { UV_PARALLAX_DEFS } from "./uvParallax";
import { UV_SHEET_DEFS } from "./uvSheet";
import { UV_TRIPLANAR_DEFS } from "./uvTriplanar";

/** node library (UV / Texture / Color), in stable registration order. */
const UV_NODE_DEFS: NodeDef[] = [...UV_BASIC_DEFS, ...UV_SHEET_DEFS, ...UV_PARALLAX_DEFS, ...UV_TRIPLANAR_DEFS];
const TEXTURE_NODE_DEFS: NodeDef[] = [...TEXTURE_BASIC_DEFS, ...NORMAL_DEFS, ...GRADIENT_DEFS];
const COLOR_NODE_DEFS: NodeDef[] = [...COLOR_BASIC_DEFS, ...COLOR_ADJUST_DEFS, ...COLOR_MASK_DEFS];
export const VISUAL_NODE_DEFS: NodeDef[] = [...UV_NODE_DEFS, ...TEXTURE_NODE_DEFS, ...COLOR_NODE_DEFS];
