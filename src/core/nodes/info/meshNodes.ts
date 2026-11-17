import type { NodeDef } from "../../registry/nodeDef";
import type { Space } from "../../types/semantics";
import { enumParam } from "../kit";
import { directionNode } from "../input/geometry";
import { M } from "../procedural/irm";
import { safeNormalize } from "../visual/common";
import { CAT, NOTE_FRAGMENT, NOTE_VERTEX, out, sceneNode } from "./common";

const meshTangentNode: NodeDef = {
  ...directionNode(
    "meshTangent",
    "Mesh Tangent",
    "tangent",
    "world",
    "Mesh tangent (the +U direction of the UV map) in the chosen space, normalized per pixel. Needs a mesh with tangents (the preview primitives have them; imported models need them exported / generated). Tangent space returns the constant (1, 0, 0).",
    ["tangent vector", "mesh tangent", "uv tangent"],
  ),
  category: CAT.mesh,
  targets: { backends: ["glsl", "hlsl", "wgsl", "godot", "unity"] },
  targetNotes: {
    all: "Built-in input `tangent`. Unity: input.tangentOS; Godot: TANGENT (see builtinMap input:tangent).",
  },
};
const meshBitangentNode: NodeDef = {
  ...directionNode(
    "meshBitangent",
    "Mesh Bitangent",
    "bitangent",
    "world",
    "Mesh bitangent = cross(Normal, Tangent) · handedness (the 4th tangent component), so mirrored UVs / negative-scale meshes get the correct SIGN. Chosen space; normalized per pixel. Tangent space returns the constant (0, 1, 0).",
    ["bitangent vector", "binormal", "mesh bitangent"],
  ),
  category: CAT.mesh,
  targets: { backends: ["glsl", "hlsl", "wgsl", "godot", "unity"] },
  targetNotes: {
    all: "Built-in input `bitangent` (sign-correct). Unity: cross(normalOS, tangentOS.xyz) · tangentOS.w · unity_WorldTransformParams.w; Godot: BINORMAL.",
  },
};

const vertexIdNode: NodeDef = sceneNode({
  id: "vertexId",
  category: CAT.mesh,
  name: "Vertex ID",
  synonyms: ["vertex index", "sv_vertexid", "gl_vertexid", "vertex number"],
  description:
    "Index of the vertex in the draw call (0, 1, 2 … for non-indexed draws; the index-buffer value for indexed draws). Int output plus a float copy. VERTEX-ONLY.",
  inputs: [],
  outputs: [out("id", "ID", "int"), out("float", "Float", "float")],
  stage: "vertex",
  uses: ["input:vertexId"],
  note: NOTE_VERTEX,
  build: (c) => {
    const v = c.b.input("vertexId");
    return { id: v, float: c.b.cast(v, "float") };
  },
});

const instanceIdNode: NodeDef = sceneNode({
  id: "instanceId",
  category: CAT.mesh,
  name: "Instance ID",
  synonyms: ["instance index", "sv_instanceid", "gl_instanceid", "instance number"],
  description:
    "Index of the instance within an instanced draw (always 0 for a plain draw call). Int output plus a float copy. VERTEX-ONLY (pass it on through a vertex-output slot if the fragment needs it).",
  inputs: [],
  outputs: [out("id", "ID", "int"), out("float", "Float", "float")],
  stage: "vertex",
  uses: ["input:instanceId"],
  note: NOTE_VERTEX,
  build: (c) => {
    const v = c.b.input("instanceId");
    return { id: v, float: c.b.cast(v, "float") };
  },
});

const isFrontFaceNode: NodeDef = sceneNode({
  id: "isFrontFace",
  category: CAT.mesh,
  name: "Is Front Face",
  synonyms: ["front facing", "back face", "face sign", "backface test", "gl_frontfacing"],
  description:
    "1 when the fragment belongs to a FRONT face (counter-clockwise winding as seen from the camera), 0 for a back face; Sign = +1 / −1. Only meaningful on double-sided materials (Cull Off); with back-face culling every fragment is front. FRAGMENT-ONLY.",
  inputs: [],
  outputs: [out("front", "Is Front", "float"), out("sign", "Sign", "float")],
  stage: "fragment",
  uses: ["input:faceSign"],
  note: NOTE_FRAGMENT,
  build: (c) => {
    const m = new M(c.b);
    const s = m.w(c.b.input("faceSign"));
    return { front: m.sel(s.gt(0), 1, 0).id, sign: s.id };
  },
});

const faceNormalNode: NodeDef = sceneNode({
  id: "faceNormal",
  category: CAT.mesh,
  name: "Face Normal",
  synonyms: ["geometric normal", "faceted normal", "derivative normal", "flat shading normal"],
  description:
    "Flat (per-triangle) normal from screen-space derivatives: normalize(cross(ddx(P), ddy(P))) of the position in the chosen space — constant across a triangle. Orientation Geometric = flipped by the face sign so it follows the mesh winding (the front side's outward normal, also on back faces); Viewer = always towards the camera. P in object space is NOT affected by the object's scale direction (the normal is of the surface as seen in that space). Derivative sign follows the target's Y convention. FRAGMENT-ONLY.",
  inputs: [],
  outputs: [out("out", "Normal", "vec3")],
  params: [
    enumParam(
      "space",
      "Space",
      [
        ["world", "World"],
        ["object", "Object"],
        ["view", "View"],
      ],
      "world",
    ),
    enumParam(
      "orientation",
      "Orientation",
      [
        ["geometric", "Geometric (winding)"],
        ["viewer", "Towards viewer"],
      ],
      "geometric",
    ),
  ],
  stage: "fragment",
  capabilities: ["derivatives"],
  uses: ["input:faceSign"],
  note: `${NOTE_FRAGMENT} Needs ddx / ddy.`,
  build: (c) => {
    const m = new M(c.b);
    const p = c.b.input("position", c.param<string>("space") as Space);
    const n = safeNormalize(
      m,
      m.w(c.b.intrinsic("cross", [c.b.deriv("ddx", p), c.b.deriv("ddy", p)])),
      m.k("vec3", 0, 0, 1),
    );
    return { out: (c.param<string>("orientation") === "geometric" ? n.mul(m.w(c.b.input("faceSign"))) : n).id };
  },
});

const tbnNode: NodeDef = sceneNode({
  id: "tbnMatrix",
  category: CAT.mesh,
  name: "TBN Matrix",
  synonyms: ["tangent frame", "tangent basis", "tbn", "tangent to world matrix", "tangent space matrix"],
  description:
    "The tangent-space basis in the chosen output space. Tangent / Bitangent / Normal are the mesh vectors in that space; with Orthonormalize (default) they are Gram-Schmidt corrected: T' = normalize(T − N(N·T)), B' = normalize(B − N(N·B) − T'(T'·B)) — keeps the handedness of the mesh bitangent (so mirrored UVs stay correct) and makes the frame orthonormal even after interpolation. Matrix (3×3, columns T, B, N) maps TANGENT → chosen space (M · v); Inverse = its transpose (chosen space → tangent), valid because the frame is orthonormal. Degenerate vectors fall back to the world axes (never NaN).",
  inputs: [],
  outputs: [
    out("tangent", "Tangent", "vec3"),
    out("bitangent", "Bitangent", "vec3"),
    out("normal", "Normal", "vec3"),
    out("matrix", "Matrix", "mat3"),
    out("inverse", "Inverse", "mat3"),
  ],
  params: [
    enumParam(
      "space",
      "Space",
      [
        ["world", "World"],
        ["object", "Object"],
        ["view", "View"],
      ],
      "world",
    ),
    { id: "orthonormalize", label: "Orthonormalize", control: "bool", default: true },
  ],
  uses: [],
  build: (c) => {
    const m = new M(c.b);
    const sp = c.param<string>("space") as Space;
    const n = safeNormalize(m, m.w(c.b.input("normal", sp)), m.k("vec3", 0, 0, 1));
    let t = safeNormalize(m, m.w(c.b.input("tangent", sp)), m.k("vec3", 1, 0, 0));
    let b = safeNormalize(m, m.w(c.b.input("bitangent", sp)), m.k("vec3", 0, 1, 0));
    if (c.param<boolean>("orthonormalize")) {
      t = safeNormalize(m, t.sub(n.mul(n.dot(t))), m.k("vec3", 1, 0, 0));
      b = safeNormalize(m, b.sub(n.mul(n.dot(b))).sub(t.mul(t.dot(b))), m.k("vec3", 0, 1, 0));
    }
    const mat = c.b.construct("mat3", [t.id, b.id, n.id]);
    const inv = c.b.construct("mat3", [m.v3(t.x, b.x, n.x).id, m.v3(t.y, b.y, n.y).id, m.v3(t.z, b.z, n.z).id]);
    return { tangent: t.id, bitangent: b.id, normal: n.id, matrix: mat, inverse: inv };
  },
});

export const MESH_NODE_DEFS: NodeDef[] = [
  meshTangentNode,
  meshBitangentNode,
  vertexIdNode,
  instanceIdNode,
  isFrontFaceNode,
  faceNormalNode,
  tbnNode,
];
