import type { BuildContext, NodeDef, PortDef } from "../../registry/nodeDef";
import type { BackendId } from "../../ir/types";
import type { StorageType } from "../../types/shaderType";
import { T } from "../../types/generics";
import { type TargetImpl, builtinById } from "../../engine/builtinMap";
import { baseNode } from "../kit";
import { M, type V } from "../procedural/irm";
import { eng, mulPoint } from "../info/common";

/**
 * Shared infrastructure of the library (shading, vertex, screen / depth, particle / sprite nodes).
 *
 * CONVENTIONS (every 8c node repeats the relevant ones in its description):
 *  - Spaces: object / world / view as in the Transform node. VIEW space is right-handed with the camera looking down -Z
 *    (+X right, +Y up, +Z towards the camera). Directions are unit length unless stated.
 *  - Light directions point FROM the surface TOWARDS the light (so N·L > 0 means lit).
 *  - Colour space: lighting colours are LINEAR and may exceed 1 (HDR, intensity already multiplied). Artistic colour inputs are
 *    used as given (no implicit sRGB conversion); use the Colour nodes to convert.
 *  - Screen UV: (0,0) = bottom-left of the viewport, +Y up (same as UV). Depth: see depthMath.ts.
 *  - Vertex nodes are VERTEX-ONLY (`stage: "vertex"`): they output an object-space `Offset` for the "Vertex Offset" slot.
 */
export { TAU } from "../visual/common";
export const STAGE_NOTE = {
  vertex: "VERTEX-ONLY: connect to a vertex slot (Vertex Offset). Feeding a fragment slot is an E_STAGE_VIOLATION.",
  fragment: "FRAGMENT-ONLY: connect to a fragment slot.",
};

/** One engine-provided value (the `engine` IR op), as the 8c nodes and their tests see it. Derived from `core/engine/builtinMap.ts` — the single source of truth. */
interface EngineIntrinsicSpec {
  ty: StorageType;
  /** Number and types of the arguments the node passes. */
  args: StorageType[];
  doc: string;
  /** Engine spelling (or the reason there is none) for Unity URP and for Godot (spatial). */
  unity: string;
  godot: string;
}

/** The engine-pipeline / light built-ins of the 8c library (a NAME list only: types, docs and per-engine spellings live in `builtinMap`). */
const ENGINE_NAMES: readonly string[] = [
  "ks.light.mainDirection",
  "ks.light.mainColor",
  "ks.light.ambientSH",
  "ks.light.additional.count",
  "ks.light.additional.direction",
  "ks.light.additional.color",
  "ks.light.additional.attenuation",
  "ks.screen.sceneDepthRaw",
  "ks.screen.sceneColor",
  "ks.camera.nearFar",
];

const spelled = (i: TargetImpl): string =>
  i.availability === "unsupported" ? `NOT AVAILABLE: ${i.reason ?? ""}` : i.expr;
export const ENGINE_INTRINSICS: Readonly<Record<string, EngineIntrinsicSpec>> = Object.fromEntries(
  ENGINE_NAMES.map((name) => {
    const e = builtinById(name);
    if (!e) throw new Error(`ENGINE_NAMES: "${name}" is missing from core/engine/builtinMap`);
    return [
      name,
      { ty: e.ty, args: e.args, doc: e.doc, unity: spelled(e.targets.unity), godot: spelled(e.targets.godotSpatial) },
    ];
  }),
);

/** Fetch an engine-provided value (single implementation: `eng` of the scene-information library). */
export { eng as engineIntrinsic } from "../info/common";

/** Availability for engine-lighting nodes: Unity URP only. Godot exposes no readable light data in fragment(), so it is NOT declared. */
export const UNITY_ONLY: { backends: BackendId[] } = { backends: ["unity"] };
/** Screen / depth resources exist in both engines' pipelines (portable backends have no such textures). */
export const ENGINE_PIPELINE: { backends: BackendId[] } = { backends: ["unity", "godot"] };

/** Portable-math nodes run on every target. */
const ALL_NOTE = "Portable IR maths: identical on every target (no engine intrinsics).";
export const noteAll = (extra = ""): Partial<Record<BackendId | "all", string>> => ({
  all: `${ALL_NOTE}${extra ? ` ${extra}` : ""}`,
});

/** Define a node with the standard category / metadata defaults of the 8c library. */
export const shNode = (def: Parameters<typeof baseNode>[0]): NodeDef => baseNode(def);

export const normalPort = (id = "normal", space: "world" | "view" | "object" = "world", name = "Normal"): PortDef => ({
  id,
  name,
  type: T("vec3"),
  tag: { semantic: "normal", space },
  defaultInput: { input: "normal", space },
  tooltip: `Surface normal, ${space} space (defaults to the interpolated mesh normal).`,
});
export const viewDirPort = (space: "world" | "view" | "object" = "world"): PortDef => ({
  id: "viewDir",
  name: "View Dir",
  type: T("vec3"),
  tag: { semantic: "direction", space },
  defaultInput: { input: "viewDir", space },
  tooltip: `Unit vector from the surface to the camera, ${space} space.`,
});
export const posPort = (space: "world" | "view" | "object" = "object", id = "position"): PortDef => ({
  id,
  name: "Position",
  type: T("vec3"),
  tag: { semantic: "position", space },
  defaultInput: { input: "position", space },
  tooltip: `Vertex position, ${space} space (defaults to the mesh position).`,
});
export const timePort = (): PortDef => ({
  id: "time",
  name: "Time",
  type: T("float"),
  defaultInput: { input: "time" },
  tooltip: "Seconds (defaults to the engine time).",
});

/** Unit vector with a defined fallback when the length is 0 (never NaN) — the 08b `safeNormalize`, re-exported under the short 8c name (single implementation). */
export { safeNormalize as unit } from "../visual/common";
/** Smoothstep with a defined result when e0 == e1 (hard step, >= goes to 1). */
export function edge(m: M, e0: V, e1: V, x: V): V {
  const same = e1.sub(e0).le(1e-9);
  const safeE1 = m.sel(same, e0.add(1), e1);
  return m.sel(same, m.step(e0, x), m.fn("smoothstep", e0, safeE1, x));
}
/** vec4 (x,y,z,0 or 1) multiplied by an engine matrix (built-in id) → xyz. */
export const xform = (c: BuildContext, m: M, matrix: string, v: V, w: 0 | 1): V => mulPoint(m, eng(c, matrix), v, w);
