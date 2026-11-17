import type { BuildContext, NodeDef, PortDef } from "../../registry/nodeDef";
import type { BackendId, ExprId } from "../../ir/types";
import { T } from "../../types/generics";
import { type MapTarget, type TargetImpl, builtinById } from "../../engine/builtinMap";
import { TARGET_CONVENTIONS } from "../../engine/targets";
import { baseNode, enumParam } from "../kit";
import { M, type V } from "../procedural/irm";

/**
 * Shared infrastructure of the scene-information library (object, mesh, camera, screen, lighting, sprite, platform nodes).
 * Engine data is requested ONLY through `eng()` — the name must exist in `core/engine/builtinMap.ts`, which also decides on which
 * targets a node is declared (`uses`) and produces the per-target notes shown in the docs / Node Gallery.
 *
 * Conventions: world space is right-handed, +Y up; VIEW space looks down −Z (eye depth = −z_view); matrices are column-major,
 * column-vector (`M·v`); screen UV (0,0) = bottom-left. Depth: see `core/engine/depth.ts`.
 */
export const CAT = {
  object: "Scene/Object",
  mesh: "Scene/Mesh",
  camera: "Scene/Camera",
  screen: "Scene/Screen",
  light: "Scene/Lighting",
  sprite: "Scene/Sprite",
  platform: "Scene/Platform",
} as const;

/** One engine built-in as an IR `engine` op (type from the mapping table). */
export function eng(c: BuildContext, id: string, args: ExprId[] = []): ExprId {
  const e = builtinById(id);
  if (!e || e.kind !== "engine") c.fail(`Unknown engine built-in "${id}"`);
  if (e!.args.length !== args.length) c.fail(`Engine built-in "${id}" takes ${e!.args.length} argument(s)`);
  return c.b.engine(id, e!.ty, args);
}

/** xyz of `matrix · (v, w)`. */
export function mulPoint(m: M, matrix: ExprId, v: V, w: 0 | 1): V {
  return m.w(m.b.matmul(matrix, m.vec("vec4", v, w).id)).sw("xyz");
}
/** `matrix · vec4` for an already-assembled vec4. */
export const mulV4 = (m: M, matrix: ExprId, v: V): V => m.w(m.b.matmul(matrix, v.id));

/** Perspective divide of a clip position. */
export const divW = (c: V): V => c.sw("xyz").div(c.w);

const BACKEND_OF: Array<[BackendId, MapTarget[]]> = [
  ["glsl", ["glslPreview"]],
  ["wgsl", ["wgsl"]],
  ["hlsl", ["hlsl"]],
  ["unity", ["unity"]],
  ["godot", ["godotSpatial", "godotCanvas"]],
];

/** Backends where EVERY built-in in `uses` is available (godot: in at least one of its shader types) and the per-target notes. */
function availabilityOf(uses: readonly string[]): { backends: BackendId[]; notes: Partial<Record<BackendId, string>> } {
  const backends: BackendId[] = [];
  const notes: Partial<Record<BackendId, string>> = {};
  for (const [b, maps] of BACKEND_OF) {
    const parts: string[] = [];
    let ok = true;
    for (const id of uses) {
      const e = builtinById(id);
      if (!e) {
        ok = false;
        parts.push(`${id}: unknown built-in`);
        continue;
      }
      const impls = maps.map((t) => [t, e.targets[t]] as [MapTarget, TargetImpl]);
      const usable = impls.filter(([, i]) => i.availability !== "unsupported");
      if (usable.length === 0) {
        ok = false;
        parts.push(`Unavailable (${id}): ${impls[0]![1].reason}`);
        continue;
      }
      for (const [t, i] of usable) {
        const tag = maps.length > 1 ? ` [${t === "godotSpatial" ? "spatial" : "canvas_item"}]` : "";
        if (i.availability === "approximate") parts.push(`Approximate${tag} (${id}): ${i.note}`);
        else if (i.note) parts.push(`${id}${tag}: ${i.note}`);
        if (i.verify) parts.push(`(${id}${tag}: engine spelling to be verified)`);
      }
    }
    if (ok) backends.push(b);
    if (parts.length) notes[b] = parts.join(" ");
  }
  return { backends, notes };
}

type NodeSpec = Omit<Parameters<typeof baseNode>[0], "targets"> & {
  /** Engine built-ins (mapping-table ids) the node uses on SOME path: availability is derived from them. */
  uses?: string[];
  /** Backends this node may NOT be declared for although its built-ins exist (e.g. needs derivatives). */
  note?: string;
};

/** A scene-information node: availability + notes come from the built-in mapping table. */
export function sceneNode(spec: NodeSpec): NodeDef {
  const { uses = [], note, ...def } = spec;
  const av = availabilityOf(uses);
  const all = [uses.length ? `Built-ins: ${uses.join(", ")}.` : "Portable IR maths: identical on every target.", note]
    .filter(Boolean)
    .join(" ");
  const targetNotes: NodeDef["targetNotes"] = { all, ...(def.targetNotes ?? {}) };
  for (const b of Object.keys(av.notes) as BackendId[])
    targetNotes[b] = [av.notes[b], def.targetNotes?.[b]].filter(Boolean).join(" ");
  return baseNode({
    ...def,
    targets: { backends: uses.length ? av.backends : ["glsl", "hlsl", "wgsl", "godot", "unity"] },
    targetNotes,
  });
}

export const vec3Port = (id: string, name: string, def: [number, number, number], tooltip?: string): PortDef => ({
  id,
  name,
  type: T("vec3"),
  default: def,
  ...(tooltip ? { tooltip } : {}),
});
export const worldPosPort = (id = "position", name = "World Position"): PortDef => ({
  id,
  name,
  type: T("vec3"),
  tag: { semantic: "position", space: "world" },
  defaultInput: { input: "position", space: "world" },
  tooltip: "World-space position (defaults to the fragment / vertex world position).",
});
export const out = (
  id: string,
  name: string,
  ty: "float" | "vec2" | "vec3" | "vec4" | "mat3" | "mat4" | "int" | "color",
): PortDef => ({ id, name, type: T(ty) });

/** Depth-buffer convention parameter: `auto` = the (simulated) compile target's own convention. */
export const DEPTH_CONV_PARAM = enumParam(
  "convention",
  "Depth convention",
  [
    ["auto", "Auto (target)"],
    ["reversed", "Reversed Z (1 = near)"],
    ["standard", "Standard (0 = near)"],
    ["ndc", "OpenGL NDC (−1…1)"],
  ],
  "auto",
);
export const resolveConvention = (c: BuildContext, v: string): "reversed" | "standard" | "ndc" =>
  v === "auto"
    ? TARGET_CONVENTIONS[c.target].reversedZ
      ? "reversed"
      : "standard"
    : (v as "reversed" | "standard" | "ndc");

export const SPACE3: Array<[string, string]> = [
  ["world", "World"],
  ["object", "Object"],
  ["view", "View"],
];
export const DIR_SPACES4: Array<[string, string]> = [
  ["world", "World"],
  ["object", "Object"],
  ["view", "View"],
  ["tangent", "Tangent"],
];
export const NOTE_FRAGMENT = "FRAGMENT-ONLY: connect to a fragment slot (a vertex slot gives E_STAGE_VIOLATION).";
export const NOTE_VERTEX = "VERTEX-ONLY: connect to a vertex slot.";
