import type { NodeDef } from "../../registry/nodeDef";
import { T } from "../../types/generics";
import { enumParam } from "../kit";
import { M } from "../procedural/irm";
import { safeNormalize } from "../visual/common";
import {
  CAT,
  DEPTH_CONV_PARAM,
  NOTE_FRAGMENT,
  divW,
  eng,
  mulPoint,
  mulV4,
  out,
  resolveConvention,
  sceneNode,
  vec3Port,
  worldPosPort,
} from "./common";
import { eyeDepthOfWorld, ndcZFromRaw, rawFromStd, stdFromNdcZ, uvOrFragment, worldToClipIr } from "./depthIr";
import { floatPort, vec2Port } from "../procedural/ports";

const MATRICES: Array<[string, string, string]> = [
  ["model", "Model (object → world)", "ks.matrix.objectToWorld"],
  ["modelInverse", "Model inverse (world → object)", "ks.matrix.worldToObject"],
  ["view", "View (world → view)", "ks.matrix.worldToView"],
  ["viewInverse", "View inverse (view → world)", "ks.matrix.viewToWorld"],
  ["projection", "Projection (view → clip)", "ks.matrix.viewToClip"],
  ["projectionInverse", "Projection inverse (clip → view)", "ks.matrix.clipToView"],
  ["viewProjection", "View-Projection (world → clip)", "ks.matrix.worldToClip"],
  ["viewProjectionInverse", "View-Projection inverse (clip → world)", "ks.matrix.clipToWorld"],
  ["mvp", "MVP (object → clip)", "ks.matrix.objectToClip"],
  ["mvpInverse", "MVP inverse (clip → object)", "ks.matrix.clipToObject"],
];

const objectNode: NodeDef = sceneNode({
  id: "sceneObject",
  category: CAT.object,
  name: "Object",
  synonyms: ["object info", "transform info", "object scale", "object pivot", "object rotation"],
  description:
    "Information about the object being drawn, read from its model matrix. Position = WORLD position of the object's pivot (model · (0,0,0,1)). Scale = the lengths of the three model-matrix axes (always ≥ 0: a mirrored object reports its absolute scale). Rotation = the model matrix with the scale removed (3×3, columns = the object's X / Y / Z axes in world space; a zero-length axis falls back to the world axis). Exact for rigid + scale transforms; with shear the axes are not orthogonal. Any stage.",
  inputs: [],
  outputs: [
    out("position", "Position", "vec3"),
    out("scale", "Scale", "vec3"),
    out("rotation", "Rotation", "mat3"),
    out("right", "Right", "vec3"),
    out("up", "Up", "vec3"),
    out("forward", "Forward", "vec3"),
  ],
  uses: ["ks.matrix.objectToWorld"],
  note: "Instanced / batched draws report the per-instance matrix on engines that provide it (Unity URP: unity_ObjectToWorld).",
  build: (c) => {
    const m = new M(c.b);
    const model = eng(c, "ks.matrix.objectToWorld");
    const col = (x: number, y: number, z: number) => mulPoint(m, model, m.k("vec3", x, y, z), 0);
    const cols = [col(1, 0, 0), col(0, 1, 0), col(0, 0, 1)];
    const axes = cols.map((v, i) =>
      safeNormalize(m, v, m.k("vec3", i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0)),
    );
    return {
      position: mulPoint(m, model, m.k("vec3", 0, 0, 0), 1).id,
      scale: m.v3(cols[0]!.length(), cols[1]!.length(), cols[2]!.length()).id,
      rotation: c.b.construct(
        "mat3",
        axes.map((a) => a.id),
      ),
      right: axes[0]!.id,
      up: axes[1]!.id,
      forward: axes[2]!.neg().id,
    };
  },
});

const matrixNode: NodeDef = sceneNode({
  id: "sceneMatrix",
  category: CAT.object,
  name: "Engine Matrix",
  synonyms: ["model matrix", "view matrix", "projection matrix", "mvp matrix", "inverse view projection"],
  description:
    "One of the engine's transform matrices as a 4×4 (column-vector convention, M·v, column-major): Model, View, Projection, View-Projection, MVP and the INVERSE of each. Projection maps clip z to the target's range (OpenGL −1…1, others 0…1; reversed-Z on Unity / Godot). Feed it to Matrix Multiply / Transform nodes. Any stage.",
  inputs: [],
  outputs: [out("out", "Matrix", "mat4")],
  params: [
    enumParam(
      "matrix",
      "Matrix",
      MATRICES.map(([v, l]) => [v, l] as [string, string]),
      "model",
    ),
  ],
  uses: MATRICES.map((x) => x[2]),
  note: "Godot canvas_item has no 3D matrices.",
  build: (c) => {
    const row = MATRICES.find((x) => x[0] === c.param<string>("matrix"));
    if (!row) c.fail("Unknown matrix");
    return { out: eng(c, row![2]) };
  },
});

const worldToScreenNode: NodeDef = sceneNode({
  id: "worldToScreenUv",
  category: CAT.object,
  name: "World To Screen UV",
  synonyms: ["world to screen", "project point", "world to viewport", "screen position of point"],
  description:
    "Projects a WORLD position to the screen: UV (0…1, bottom-left origin) = (clip.xy / clip.w)·0.5 + 0.5; Depth = the raw depth-buffer value of the point in the chosen convention (Auto = the target's: reversed on Unity / Godot, standard elsewhere); Eye Depth = distance along the view axis (valid for orthographic cameras too); Front = 1 when the point is in front of the camera (clip.w > 0), else 0 (then UV is meaningless). Any stage.",
  inputs: [worldPosPort()],
  outputs: [
    out("uv", "UV", "vec2"),
    out("depth", "Depth", "float"),
    out("eye", "Eye Depth", "float"),
    out("front", "Front", "float"),
    out("clip", "Clip", "vec4"),
  ],
  params: [DEPTH_CONV_PARAM],
  uses: ["ks.matrix.worldToClip", "ks.matrix.worldToView"],
  build: (c) => {
    const m = new M(c.b);
    const p = m.w(c.in("position"));
    const clip = worldToClipIr(c, m, p);
    const w = m.sel(clip.w.abs().lt(1e-20), 1e-20, clip.w);
    const std = stdFromNdcZ(c, clip.z.div(w));
    return {
      uv: clip.sw("xy").div(w).mul(0.5).add(0.5).id,
      depth: rawFromStd(m, std, resolveConvention(c, c.param<string>("convention"))).id,
      eye: eyeDepthOfWorld(c, m, p).id,
      front: m.step(1e-20, clip.w).id,
      clip: clip.id,
    };
  },
});

const clipToNdcNode: NodeDef = sceneNode({
  id: "clipToNdc",
  category: CAT.object,
  name: "Clip To NDC",
  synonyms: ["perspective divide", "clip space to ndc", "ndc position", "divide by w"],
  description:
    "Perspective divide: NDC = clip.xyz / clip.w (w = 0 is replaced by 1e-20, never NaN). UV = NDC.xy·0.5 + 0.5 (bottom-left origin). NDC z is in the target's clip range (OpenGL −1…1, D3D / Metal / Vulkan / WebGPU / Godot / Unity 0…1, reversed on Unity / Godot). Any stage.",
  inputs: [
    { id: "clip", name: "Clip", type: T("vec4"), default: [0, 0, 0, 1], tag: { semantic: "position", space: "clip" } },
  ],
  outputs: [out("ndc", "NDC", "vec3"), out("uv", "UV", "vec2"), out("w", "W", "float")],
  build: (c) => {
    const m = new M(c.b);
    const clip = m.w(c.in("clip"));
    const w = m.sel(clip.w.abs().lt(1e-20), 1e-20, clip.w);
    return { ndc: clip.sw("xyz").div(w).id, uv: clip.sw("xy").div(w).mul(0.5).add(0.5).id, w: clip.w.id };
  },
});

const reconstructWorldNode: NodeDef = sceneNode({
  id: "reconstructWorldPosition",
  category: CAT.object,
  name: "Reconstruct World Position",
  synonyms: ["world position from depth", "depth to world", "unproject", "position from depth", "reconstruct position"],
  description:
    "Rebuilds the position of the surface seen at a screen UV from its RAW depth: NDC = (uv·2 − 1, z) with z from the depth convention (Auto = the target's: Reversed Z = 1 − raw, Standard = raw, OpenGL NDC as given; then mapped to the target's clip range), then position = (InverseViewProjection · NDC) / w. Outputs World, View (right-handed, camera looks down −Z) and Object space. UV defaults to this fragment's screen UV (fragment stage only; wire a UV to use it elsewhere). Raw depth is clamped to its legal range. Round-trips World To Screen UV exactly (to float precision). Perspective AND orthographic cameras.",
  inputs: [
    vec2Port("uv", "UV", [0.5, 0.5], "Screen UV, 0…1, bottom-left origin. Unconnected = this fragment's screen UV."),
    floatPort("depth", "Raw Depth", 0.5, "Raw depth-buffer value in the chosen convention (e.g. Scene Depth › Raw)."),
  ],
  outputs: [out("world", "World", "vec3"), out("view", "View", "vec3"), out("object", "Object", "vec3")],
  params: [DEPTH_CONV_PARAM],
  uses: ["ks.matrix.clipToWorld", "ks.matrix.clipToView", "ks.matrix.clipToObject"],
  note: `${NOTE_FRAGMENT} (when UV is unconnected).`,
  build: (c) => {
    const m = new M(c.b);
    const uv = uvOrFragment(c, m);
    const z = ndcZFromRaw(c, m, m.w(c.in("depth")), resolveConvention(c, c.param<string>("convention")));
    const ndc = m.vec("vec4", uv.mul(2).sub(1), z, 1);
    const un = (id: string) => {
      const p = mulV4(m, eng(c, id), ndc);
      return divW(p).id;
    };
    return {
      world: un("ks.matrix.clipToWorld"),
      view: un("ks.matrix.clipToView"),
      object: un("ks.matrix.clipToObject"),
    };
  },
});

const objectHeightNode: NodeDef = sceneNode({
  id: "objectBoundsNormalize",
  category: CAT.object,
  name: "Object Bounds Normalize",
  synonyms: ["normalized height", "object height 01", "bounds gradient", "height gradient", "mesh bounds"],
  description:
    "Position inside the mesh's object-space bounding box, 0…1 per axis: (P − Min) / (Max − Min); an axis with Max = Min gives 0. Height = the Y component (a vertical gradient). Min / Max are INPUTS (wire Vector 3 properties): the preview normalises models to a unit box, so the default −0.5…0.5 matches its primitives; for your own mesh enter its real bounds (Unity: Renderer.bounds / Mesh.bounds, Godot: AABB). Clamp keeps the result in 0…1. Any stage.",
  inputs: [
    {
      id: "position",
      name: "Position",
      type: T("vec3"),
      tag: { semantic: "position", space: "object" },
      defaultInput: { input: "position", space: "object" },
    },
    vec3Port("min", "Bounds Min", [-0.5, -0.5, -0.5]),
    vec3Port("max", "Bounds Max", [0.5, 0.5, 0.5]),
  ],
  outputs: [out("normalized", "Normalized", "vec3"), out("height", "Height", "float")],
  params: [{ id: "clamp", label: "Clamp 0…1", control: "bool", default: true }],
  build: (c) => {
    const m = new M(c.b);
    const lo = m.w(c.in("min"));
    const size = m.w(c.in("max")).sub(lo);
    const safe = m.v3(
      m.sel(size.x.abs().lt(1e-9), 1, size.x),
      m.sel(size.y.abs().lt(1e-9), 1, size.y),
      m.sel(size.z.abs().lt(1e-9), 1, size.z),
    );
    const raw = m.w(c.in("position")).sub(lo).div(safe);
    const masked = m.v3(
      m.sel(size.x.abs().lt(1e-9), 0, raw.x),
      m.sel(size.y.abs().lt(1e-9), 0, raw.y),
      m.sel(size.z.abs().lt(1e-9), 0, raw.z),
    );
    const n = c.param<boolean>("clamp") ? masked.clamp(0, 1) : masked;
    return { normalized: n.id, height: n.y.id };
  },
});

export const OBJECT_NODE_DEFS: NodeDef[] = [
  objectNode,
  matrixNode,
  worldToScreenNode,
  clipToNdcNode,
  reconstructWorldNode,
  objectHeightNode,
];
