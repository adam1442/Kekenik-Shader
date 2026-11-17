import type { BuildContext } from "../../registry/nodeDef";
import type { ProjOptions } from "../../engine/depth";
import { TARGET_CONVENTIONS } from "../../engine/targets";
import { M, type V } from "../procedural/irm";
import { eng, mulPoint } from "./common";

/**
 * IR emitters of the depth maths in `core/engine/depth.ts` (the same formulas, built from IR so every backend runs them).
 * `conv` is the raw-depth convention ("reversed" | "standard" | "ndc") already resolved by `resolveConvention`.
 */

/** Camera parameters as IR values. `ortho` is 0 / 1, `halfHeight` the orthographic half-height. */
export interface CamIr {
  near: V;
  far: V;
  ortho: V;
  halfHeight: V;
}

/** Sanitised clip planes (near ≥ 1e-6, far ≥ near + 1e-6) — the IR twin of `nearFar` in core/engine/depth.ts. */
function clipPlanes(near: V, far: V): { near: V; far: V } {
  const n = near.max(1e-6);
  return { near: n, far: far.max(n.add(1e-6)) };
}

export function cameraIr(c: BuildContext, m: M): CamIr {
  const p = m.w(eng(c, "ks.camera.params"));
  return { ...clipPlanes(p.x, p.y), ortho: p.z, halfHeight: p.w };
}

/** Raw depth → standard depth 0…1 (0 = near). */
function stdFromRaw(m: M, raw: V, conv: string): V {
  if (conv === "reversed") return m.f(1).sub(raw.clamp(0, 1));
  if (conv === "ndc") return raw.clamp(-1, 1).mul(0.5).add(0.5);
  return raw.clamp(0, 1);
}

/** Standard depth 0…1 → raw depth. */
export function rawFromStd(m: M, d: V, conv: string): V {
  const s = d.clamp(0, 1);
  if (conv === "reversed") return m.f(1).sub(s);
  if (conv === "ndc") return s.mul(2).sub(1);
  return s;
}

/**
 * Convention of the projection MATRICES the host supplies (`ks.matrix.*`): the target's own (Unity / Godot: 0…1 + reversed-Z), except in
 * the preview, where the viewport renders with an OpenGL matrix whatever target is being simulated (see D-8d-6).
 */
const matrixProjection = (c: BuildContext): ProjOptions =>
  c.isPreview
    ? { clipRange: "-11", reversedZ: false }
    : { clipRange: TARGET_CONVENTIONS[c.target].clipRange, reversedZ: TARGET_CONVENTIONS[c.target].reversedZ };

/** NDC z (of the host projection matrix) of a raw depth in convention `conv`. */
export function ndcZFromRaw(c: BuildContext, m: M, raw: V, conv: string): V {
  const o = matrixProjection(c);
  const w = stdFromRaw(m, raw, conv);
  const win = o.reversedZ ? m.f(1).sub(w) : w;
  return o.clipRange === "-11" ? win.mul(2).sub(1) : win;
}

/** Standard depth (0 = near) of an NDC z produced by the host projection matrix. */
export function stdFromNdcZ(c: BuildContext, ndcZ: V): V {
  const o = matrixProjection(c);
  const win = o.clipRange === "-11" ? ndcZ.mul(0.5).add(0.5) : ndcZ;
  return (o.reversedZ ? win.neg().add(1) : win).clamp(0, 1);
}

/** Eye depth (world units) + Linear01 of a STANDARD depth `d` (0 = near) for a perspective or an orthographic camera. */
const eyeOfStd = (d: V, near: V, far: V, ortho: boolean): { eye: V; linear01: V } => {
  if (ortho) return { eye: near.add(d.mul(far.sub(near))), linear01: d };
  const eye = near.mul(far).div(far.sub(d.mul(far.sub(near))));
  return { eye, linear01: eye.div(far) };
};

/** Eye depth + Linear01 of a raw depth for a camera kind known at COMPILE time (Scene Depth / Linear Eye Depth nodes with their own near / far inputs). */
export function linearizeStatic(m: M, raw: V, near: V, far: V, conv: string, ortho: boolean): { eye: V; linear01: V } {
  const p = clipPlanes(near, far);
  return eyeOfStd(stdFromRaw(m, raw, conv), p.near, p.far, ortho);
}

/** Eye depth + Linear01 of a raw depth; the camera kind (perspective / orthographic) is decided at RUN time from the camera parameters. */
export function linearizeRuntime(m: M, raw: V, cam: CamIr, conv: string): { eye: V; linear01: V } {
  const d = stdFromRaw(m, raw, conv);
  const p = eyeOfStd(d, cam.near, cam.far, false);
  const o = eyeOfStd(d, cam.near, cam.far, true);
  const isOrtho = cam.ortho.gt(0.5);
  return { eye: m.sel(isOrtho, o.eye, p.eye), linear01: m.sel(isOrtho, o.linear01, p.linear01) };
}

/** Unity-style `_ZBufferParams` as IR (perspective) for the resolved reversed / standard convention. */
export function zBufferParamsIr(m: M, cam: CamIr, reversed: boolean): V {
  const ratio = cam.far.div(cam.near);
  if (reversed) {
    const x = ratio.sub(1);
    return m.v4(x, 1, x.div(cam.far), m.f(1).div(cam.far));
  }
  const x = m.f(1).sub(ratio);
  return m.v4(x, ratio, x.div(cam.far), ratio.div(cam.far));
}

/** World → clip position of a world point. */
export function worldToClipIr(c: BuildContext, m: M, world: V): V {
  return m.w(c.b.matmul(eng(c, "ks.matrix.worldToClip"), m.vec("vec4", world, 1).id));
}

/** Eye depth of a world position: −z of the view-space position (valid for perspective AND orthographic cameras). */
export function eyeDepthOfWorld(c: BuildContext, m: M, world: V): V {
  return mulPoint(m, eng(c, "ks.matrix.worldToView"), world, 1).z.neg();
}

/** Screen UV (0…1, bottom-left) of the current fragment from the clip-space position (fragment stage only). */
export function screenUvOfFragment(c: BuildContext, m: M): V {
  const raw = m.w(c.b.input("screenPos"));
  return raw.sw("xy").div(raw.w).mul(0.5).add(0.5);
}

/** The wired `uv` input, or this fragment's screen UV when it is unconnected (fragment stage). */
export const uvOrFragment = (c: BuildContext, m: M): V =>
  c.connected("uv") ? m.w(c.in("uv")) : screenUvOfFragment(c, m);
