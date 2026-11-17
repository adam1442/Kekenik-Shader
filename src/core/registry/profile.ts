import type { ParamValue, PortValue } from "../graph/types";
import type { Stage } from "../ir/types";
import type { TypeTag } from "../types/semantics";
import type { ShaderType } from "../types/shaderType";
import type { ParamSchema } from "./nodeDef";

type ProfileFamily = "debug" | "unlit" | "lit" | "sprite" | "vfx" | "fullscreen";

/** One slot of the master stack (e.g. Base Color / Alpha / Vertex Position). */
export interface MasterBlock {
  /** Slot name; also the id of the matching master-node input port. */
  id: string;
  label: string;
  type: ShaderType;
  stage: Stage;
  required: boolean;
  /** Value used when unconnected. */
  default?: PortValue;
  tag?: TypeTag;
  /** Block is evaluated only while `graph.settings[setting]` (or `default` when unset) equals `equals`; the port and its wire stay. */
  shownWhen?: { setting: string; equals: ParamValue; default: ParamValue };
}

export interface ProfileDef {
  id: string;
  name: string;
  family: ProfileFamily;
  stages: Stage[];
  masterBlocks: MasterBlock[];
  /** Graph-level settings the UI shows for this profile (surface type, blend mode, …). */
  settings: ParamSchema[];
}
