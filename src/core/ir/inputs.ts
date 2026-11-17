import type { StorageType } from "../types/shaderType";
import type { Space, TypeTag } from "../types/semantics";

/**
 * Built-in input fetches. `stage` is where the value legally exists:
 * "any" = vertex attribute / interpolated varying, "fragment" = fragment-only, "vertex" = vertex-only.
 */
export type BuiltinInput =
  | "uv0"
  | "uv1"
  | "uv2"
  | "uv3"
  | "vertexColor"
  | "position"
  | "normal"
  | "tangent"
  | "bitangent"
  | "viewDir"
  | "time"
  | "deltaTime"
  | "smoothDeltaTime"
  | "screenPos"
  | "faceSign"
  | "vertexId"
  | "instanceId"
  | "cameraPos";

export interface InputSpec {
  ty: StorageType;
  stage: "any" | "fragment" | "vertex";
  /** Legal spaces; undefined = the input has no space. */
  spaces?: Space[];
  defaultSpace?: Space;
  tag?: TypeTag;
}

const DIR_SPACES: Space[] = ["object", "world", "view", "tangent"];

export const BUILTIN_INPUTS: Readonly<Record<BuiltinInput, InputSpec>> = {
  uv0: { ty: "vec2", stage: "any", tag: { semantic: "uv" } },
  uv1: { ty: "vec2", stage: "any", tag: { semantic: "uv" } },
  uv2: { ty: "vec2", stage: "any", tag: { semantic: "uv" } },
  uv3: { ty: "vec2", stage: "any", tag: { semantic: "uv" } },
  vertexColor: { ty: "vec4", stage: "any", tag: { semantic: "color" } },
  position: {
    ty: "vec3",
    stage: "any",
    spaces: ["object", "world", "view", "clip"],
    defaultSpace: "object",
    tag: { semantic: "position" },
  },
  normal: { ty: "vec3", stage: "any", spaces: DIR_SPACES, defaultSpace: "object", tag: { semantic: "normal" } },
  tangent: { ty: "vec3", stage: "any", spaces: DIR_SPACES, defaultSpace: "object", tag: { semantic: "direction" } },
  bitangent: { ty: "vec3", stage: "any", spaces: DIR_SPACES, defaultSpace: "object", tag: { semantic: "direction" } },
  viewDir: { ty: "vec3", stage: "any", spaces: DIR_SPACES, defaultSpace: "world", tag: { semantic: "direction" } },
  time: { ty: "float", stage: "any" },
  deltaTime: { ty: "float", stage: "any" },
  smoothDeltaTime: { ty: "float", stage: "any" },
  screenPos: { ty: "vec4", stage: "fragment", tag: { semantic: "position", space: "clip" } },
  faceSign: { ty: "float", stage: "fragment" },
  vertexId: { ty: "int", stage: "vertex" },
  /** Instance index of an instanced draw (0 for a plain draw). Vertex stage only. Added by . */
  instanceId: { ty: "int", stage: "vertex" },
  cameraPos: {
    ty: "vec3",
    stage: "any",
    spaces: ["world"],
    defaultSpace: "world",
    tag: { semantic: "position", space: "world" },
  },
};

export const BUILTIN_INPUT_NAMES = Object.keys(BUILTIN_INPUTS) as BuiltinInput[];

/** Type of an input in a given space (clip-space position is a vec4). */
export function builtinInputType(input: BuiltinInput, space?: Space): StorageType {
  if (input === "position" && space === "clip") return "vec4";
  return BUILTIN_INPUTS[input].ty;
}

/** Validate/normalise the space for an input. Throws on illegal combination. */
export function resolveInputSpace(input: BuiltinInput, space?: Space): Space | undefined {
  const spec = BUILTIN_INPUTS[input];
  if (!spec) throw new Error(`Unknown built-in input "${input}"`);
  if (!spec.spaces) {
    if (space) throw new Error(`Input "${input}" has no coordinate space (got "${space}")`);
    return undefined;
  }
  const s = space ?? spec.defaultSpace!;
  if (!spec.spaces.includes(s)) throw new Error(`Input "${input}" is not available in ${s} space`);
  return s;
}
