import type { NodeDef } from "../../registry/nodeDef";
import { enumParam } from "../kit";
import { M } from "../procedural/irm";
import { CAT, DEPTH_CONV_PARAM, eng, mulPoint, mulV4, out, resolveConvention, sceneNode, worldPosPort } from "./common";
import { cameraIr, eyeDepthOfWorld, linearizeRuntime, zBufferParamsIr } from "./depthIr";
import { floatPort } from "../procedural/ports";
import { TARGET_CONVENTIONS } from "../../engine/targets";

const cameraNode: NodeDef = sceneNode({
  id: "sceneCamera",
  category: CAT.camera,
  name: "Camera",
  synonyms: [
    "camera info",
    "camera position",
    "camera forward vector",
    "camera fov",
    "camera near far",
    "is orthographic",
  ],
  description:
    "Everything about the rendering camera. Position / Direction (unit, forward) / Up / Right in WORLD space (read from the view-inverse matrix, so they follow the camera's actual rotation). Near / Far = clip planes in world units. FOV = vertical field of view in DEGREES from the projection matrix (0 for an orthographic camera). Aspect = width / height from the projection matrix. Is Orthographic = 1 / 0 (decided at run time); Ortho Size = half the visible HEIGHT in world units (0 for perspective cameras). Any stage.",
  inputs: [],
  outputs: [
    out("position", "Position", "vec3"),
    out("direction", "Direction", "vec3"),
    out("up", "Up", "vec3"),
    out("right", "Right", "vec3"),
    out("near", "Near", "float"),
    out("far", "Far", "float"),
    out("fov", "FOV (deg)", "float"),
    out("aspect", "Aspect", "float"),
    out("ortho", "Is Orthographic", "float"),
    out("size", "Ortho Size", "float"),
  ],
  uses: ["ks.matrix.viewToWorld", "ks.matrix.viewToClip", "ks.camera.params", "input:cameraPos"],
  build: (c) => {
    const m = new M(c.b);
    const inv = eng(c, "ks.matrix.viewToWorld");
    const proj = eng(c, "ks.matrix.viewToClip");
    const cam = cameraIr(c, m);
    const p11 = mulV4(m, proj, m.k("vec4", 0, 1, 0, 0)).y.abs();
    const p00 = mulV4(m, proj, m.k("vec4", 1, 0, 0, 0)).x.abs();
    const isOrtho = cam.ortho.gt(0.5);
    const fov = m
      .fn("atan", m.f(1).div(p11.max(1e-9)))
      .mul(2)
      .mul(180 / Math.PI);
    return {
      position: c.b.input("cameraPos", "world"),
      direction: mulPoint(m, inv, m.k("vec3", 0, 0, -1), 0).id,
      up: mulPoint(m, inv, m.k("vec3", 0, 1, 0), 0).id,
      right: mulPoint(m, inv, m.k("vec3", 1, 0, 0), 0).id,
      near: cam.near.id,
      far: cam.far.id,
      fov: m.sel(isOrtho, 0, fov).id,
      aspect: p11.div(p00.max(1e-9)).id,
      ortho: m.sel(isOrtho, 1, 0).id,
      size: m.sel(isOrtho, cam.halfHeight, 0).id,
    };
  },
});

const distanceToCameraNode: NodeDef = sceneNode({
  id: "distanceToCamera",
  category: CAT.camera,
  name: "Distance To Camera",
  synonyms: ["camera distance", "distance from camera", "object distance", "distance to eye"],
  description:
    "Euclidean distance in world units between the camera and (a) THIS FRAGMENT's world position (mode Fragment — varies per pixel) or (b) the OBJECT's pivot (mode Object — one value per object, e.g. for LOD fades). Note this is the straight-line distance, NOT the eye depth: use View Space Depth for depth along the view axis. Any stage.",
  inputs: [],
  outputs: [out("distance", "Distance", "float")],
  params: [
    enumParam(
      "mode",
      "Mode",
      [
        ["fragment", "Per fragment"],
        ["object", "Per object (pivot)"],
      ],
      "fragment",
    ),
  ],
  uses: ["input:cameraPos", "ks.matrix.objectToWorld"],
  build: (c) => {
    const m = new M(c.b);
    const cam = m.w(c.b.input("cameraPos", "world"));
    const p =
      c.param<string>("mode") === "object"
        ? mulPoint(m, eng(c, "ks.matrix.objectToWorld"), m.k("vec3", 0, 0, 0), 1)
        : m.w(c.b.input("position", "world"));
    return { distance: p.sub(cam).length().id };
  },
});

const viewDepthNode: NodeDef = sceneNode({
  id: "viewSpaceDepth",
  category: CAT.camera,
  name: "View Space Depth",
  synonyms: ["eye depth", "view depth", "depth along view axis", "linear depth of position"],
  description:
    "Depth of a world position along the camera's view axis. Eye = −z of the view-space position (world units, > 0 in front of the camera; correct for perspective AND orthographic cameras). Linear01 = (Eye − Near) / (Far − Near) for orthographic cameras and Eye / Far for perspective (Unity's Linear01Depth convention), clamped to 0…1. View Z = the signed view-space z (negative in front: the camera looks down −Z). Any stage.",
  inputs: [worldPosPort()],
  outputs: [out("eye", "Eye Depth", "float"), out("linear01", "Linear01", "float"), out("z", "View Z", "float")],
  uses: ["ks.matrix.worldToView", "ks.camera.params"],
  build: (c) => {
    const m = new M(c.b);
    const eye = eyeDepthOfWorld(c, m, m.w(c.in("position")));
    const cam = cameraIr(c, m);
    const lin = m.sel(cam.ortho.gt(0.5), eye.sub(cam.near).div(cam.far.sub(cam.near)), eye.div(cam.far)).clamp(0, 1);
    return { eye: eye.id, linear01: lin.id, z: eye.neg().id };
  },
});

const zBufferParamsNode: NodeDef = sceneNode({
  id: "zBufferParams",
  category: CAT.camera,
  name: "Projection Params",
  synonyms: ["zbuffer params", "projection params", "linearize depth helper", "depth linearization", "_zbufferparams"],
  description:
    "Depth-linearisation helper in Unity's naming. Z-Buffer Params = _ZBufferParams (x, y, z, w): Linear01 = 1 / (x·raw + y), Eye = 1 / (z·raw + w) for PERSPECTIVE cameras; reversed Z (Auto on Unity / Godot): x = far/near − 1, y = 1; standard Z: x = 1 − far/near, y = far/near; z = x/far, w = y/far. Projection Params = _ProjectionParams (flip, near, far, 1/far; flip = −1 on Y-flipped targets). With a Raw Depth input the node also linearises it — correct for orthographic cameras too (decided at run time): Eye = near + d·(far − near), Linear01 = d, d = standard-convention depth. Raw is clamped to its legal range; near ≥ 1e-6, far ≥ near + 1e-6. Any stage.",
  inputs: [floatPort("raw", "Raw Depth", 0.5, "Raw depth-buffer value in the chosen convention.")],
  outputs: [
    out("zbuffer", "Z-Buffer Params", "vec4"),
    out("projection", "Projection Params", "vec4"),
    out("eye", "Eye Depth", "float"),
    out("linear01", "Linear01", "float"),
  ],
  params: [DEPTH_CONV_PARAM],
  uses: ["ks.camera.params"],
  build: (c) => {
    const m = new M(c.b);
    const cam = cameraIr(c, m);
    const conv = resolveConvention(c, c.param<string>("convention"));
    const t = TARGET_CONVENTIONS[c.target];
    const flip = t.yFlipped ? -1 : 1;
    const lin = linearizeRuntime(m, m.w(c.in("raw")), cam, conv);
    return {
      zbuffer: zBufferParamsIr(m, cam, conv === "reversed").id,
      projection: m.v4(flip, cam.near, cam.far, m.f(1).div(cam.far)).id,
      eye: lin.eye.id,
      linear01: lin.linear01.id,
    };
  },
});

export const CAMERA_NODE_DEFS: NodeDef[] = [cameraNode, distanceToCameraNode, viewDepthNode, zBufferParamsNode];
