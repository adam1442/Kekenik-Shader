/**
 * Kekenik Shader — depth & projection maths (pure, unit-tested; the IR emitters of the scene nodes mirror these formulas).
 *
 * CONVENTIONS
 *  - View space is right-handed and the camera looks down −Z: a point in front of the camera has view z < 0 and
 *    EYE DEPTH e = −z_view > 0 (the `w` of a perspective clip position; for orthographic cameras `w` is 1, so eye depth must come from z).
 *  - "Raw" depth = the value stored in the depth buffer / depth texture, r ∈ [0, 1] (or the NDC z ∈ [−1, 1] for convention "ndc").
 *      standard : r = 0 at the near plane, 1 at the far plane (OpenGL after the viewport transform, D3D non-reversed, WebGPU default).
 *      reversed : r = 1 at the near plane, 0 at the far plane (Unity on D3D / Metal / Vulkan / consoles, Godot 4).
 *      ndc      : the NDC z of an OpenGL projection, −1 at near and +1 at far.
 *  - Clip range: the projection matrix maps NDC z to [−1, 1] ("-11", OpenGL) or [0, 1] ("01", D3D / Metal / Vulkan / WebGPU).
 *  - Matrices are column-major `number[16]` (column-vector convention, `M·v`).
 *  - Near is clamped to ≥ 1e-6 and far to ≥ near + 1e-6 everywhere, so every result is finite.
 */
import { clamp } from "../values/numeric";

type DepthConvention = "standard" | "reversed" | "ndc";
export type ClipRange = "-11" | "01";
type Mat4 = number[];
type Vec4 = [number, number, number, number];

/** Sanitised (near, far) pair. */
function nearFar(near: number, far: number): { n: number; f: number } {
  const n = Math.max(near, 1e-6);
  return { n, f: Math.max(far, n + 1e-6) };
}

/** Raw depth in `conv` → standard depth in [0, 1] (0 = near, 1 = far). */
function toStandardDepth(raw: number, conv: DepthConvention): number {
  if (conv === "reversed") return 1 - clamp(raw, 0, 1);
  if (conv === "ndc") return clamp(raw, -1, 1) * 0.5 + 0.5;
  return clamp(raw, 0, 1);
}

/** Standard depth in [0, 1] → raw depth in `conv`. */
function fromStandardDepth(d: number, conv: DepthConvention): number {
  const s = clamp(d, 0, 1);
  if (conv === "reversed") return 1 - s;
  if (conv === "ndc") return s * 2 - 1;
  return s;
}

/** Raw depth → EYE depth (world units along the view axis), always in [near, far]. */
function rawToEyeDepth(raw: number, near: number, far: number, conv: DepthConvention, ortho: boolean): number {
  const { n, f } = nearFar(near, far);
  const d = toStandardDepth(raw, conv);
  return clamp(ortho ? n + d * (f - n) : (n * f) / (f - d * (f - n)), n, f); // clamp: float rounding at d = 1 must not exceed far
}

/** Raw depth → Linear01 (perspective: eye / far; orthographic: the standard depth itself, which is already linear). */
export function rawToLinear01(raw: number, near: number, far: number, conv: DepthConvention, ortho: boolean): number {
  const { f } = nearFar(near, far);
  return ortho ? toStandardDepth(raw, conv) : rawToEyeDepth(raw, near, far, conv, false) / f;
}

/** EYE depth → raw depth (inverse of `rawToEyeDepth`; the eye depth is clamped to [near, far]). */
export function eyeDepthToRaw(eye: number, near: number, far: number, conv: DepthConvention, ortho: boolean): number {
  const { n, f } = nearFar(near, far);
  const e = clamp(eye, n, f);
  const d = ortho ? (e - n) / (f - n) : (f * (e - n)) / (e * (f - n));
  return fromStandardDepth(d, conv);
}

/**
 * Unity's `_ZBufferParams` (x, y, z, w) for a PERSPECTIVE camera:
 *   Linear01(raw) = 1 / (x·raw + y), Eye(raw) = 1 / (z·raw + w).
 * reversed: x = −1 + far/near, y = 1, z = x/far, w = 1/far;  standard: x = 1 − far/near, y = far/near, z = x/far, w = y/far.
 */
export function zBufferParams(near: number, far: number, reversedZ: boolean): Vec4 {
  const { n, f } = nearFar(near, far);
  if (reversedZ) {
    const x = -1 + f / n;
    return [x, 1, x / f, 1 / f];
  }
  const x = 1 - f / n;
  const y = f / n;
  return [x, y, x / f, y / f];
}

/** Unity's `_ProjectionParams` = (flip, near, far, 1/far); `flip` is −1 when the target is rendered upside down. */
export const projectionParams = (near: number, far: number, flip = 1): Vec4 => [flip, near, far, 1 / far];

/** Eye depth of a view-space position (right-handed, camera looks down −Z). */
export const eyeDepthOfView = (viewZ: number): number => -viewZ;

export interface ProjOptions {
  /** NDC z range of the projection matrix. */
  clipRange: ClipRange;
  /** The projection matrix itself is reversed-Z (near → 1). */
  reversedZ: boolean;
}

/**
 * Standard depth (0 = near, 1 = far) of the NDC z a projection matrix `o` produces. Reversed-Z projections put the near plane at
 * the TOP of the range, so the window depth is flipped; this is the only place where the matrix convention enters the depth maths.
 */
function ndcZToStandard(ndcZ: number, o: ProjOptions): number {
  const w = o.clipRange === "-11" ? ndcZ * 0.5 + 0.5 : ndcZ;
  return clamp(o.reversedZ ? 1 - w : w, 0, 1);
}

/** Inverse of `ndcZToStandard`: the NDC z a projection matrix `o` assigns to a standard depth. */
function standardToNdcZ(std: number, o: ProjOptions): number {
  const s = clamp(std, 0, 1);
  const w = o.reversedZ ? 1 - s : s;
  return o.clipRange === "-11" ? w * 2 - 1 : w;
}

/** NDC z (of a projection matrix `o`) that corresponds to a raw depth of convention `conv`. */
const ndcZFromRaw = (raw: number, conv: DepthConvention, o: ProjOptions): number =>
  standardToNdcZ(toStandardDepth(raw, conv), o);

/** NDC z of the near / far plane for a (reversed?, range) projection. */
const planeNdc = (reversed: boolean, range: ClipRange): { zn: number; zf: number } => {
  const lo = range === "-11" ? -1 : 0;
  return reversed ? { zn: 1, zf: lo } : { zn: lo, zf: 1 };
};

/** Perspective projection (vertical FOV in radians), column-major. */
export function perspectiveMatrix(fovY: number, aspect: number, near: number, far: number, o: ProjOptions): Mat4 {
  const { n, f } = nearFar(near, far);
  const { zn, zf } = planeNdc(o.reversedZ, o.clipRange);
  const t = 1 / Math.tan(fovY / 2);
  const b = (zn - zf) / (1 / n - 1 / f);
  const a = b / n - zn;
  // clip.z = −a·e + b with e = −z_view  ⇒  row 2 = (0, 0, a, b)
  return [t / aspect, 0, 0, 0, 0, t, 0, 0, 0, 0, a, -1, 0, 0, b, 0];
}

/** Orthographic projection (`halfHeight` = half the visible height in world units), column-major. */
export function orthographicMatrix(
  halfHeight: number,
  aspect: number,
  near: number,
  far: number,
  o: ProjOptions,
): Mat4 {
  const { n, f } = nearFar(near, far);
  const { zn, zf } = planeNdc(o.reversedZ, o.clipRange);
  const a = (zn - zf) / (f - n);
  const b = zn + a * n;
  const h = 1 / halfHeight;
  return [h / aspect, 0, 0, 0, 0, h, 0, 0, 0, 0, a, 0, 0, 0, b, 1];
}

/* ── small matrix kit (tests, host code) ─────────────────────────────────────────────────────────────────── */

const identityMat4 = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function mulMat4Vec4(m: Mat4, v: Vec4): Vec4 {
  const o: Vec4 = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) o[r] = m[r]! * v[0] + m[4 + r]! * v[1] + m[8 + r]! * v[2] + m[12 + r]! * v[3];
  return o;
}

export function mulMat4(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}

/** General 4×4 inverse (Gauss-Jordan with partial pivoting); a singular matrix returns the identity. */
export function invertMat4(m: Mat4): Mat4 {
  const a: number[][] = [0, 1, 2, 3].map((r) => [
    m[r]!,
    m[4 + r]!,
    m[8 + r]!,
    m[12 + r]!,
    r === 0 ? 1 : 0,
    r === 1 ? 1 : 0,
    r === 2 ? 1 : 0,
    r === 3 ? 1 : 0,
  ]);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(a[r]![c]!) > Math.abs(a[p]![c]!)) p = r;
    if (Math.abs(a[p]![c]!) < 1e-30) return identityMat4();
    const tmp = a[c]!;
    a[c] = a[p]!;
    a[p] = tmp;
    const d = a[c]![c]!;
    for (let k = 0; k < 8; k++) a[c]![k]! /= d;
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const f = a[r]![c]!;
      for (let k = 0; k < 8; k++) a[r]![k]! -= f * a[c]![k]!;
    }
  }
  const o = new Array<number>(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[c * 4 + r] = a[r]![4 + c]!;
  return o;
}

/** World position → (screen uv 0…1 bottom-left, raw depth in `conv`, in front of the camera). */
export function worldToScreen(
  world: [number, number, number],
  viewProj: Mat4,
  conv: DepthConvention,
  o: ProjOptions,
): { uv: [number, number]; raw: number; front: boolean } {
  const c = mulMat4Vec4(viewProj, [world[0], world[1], world[2], 1]);
  const w = Math.abs(c[3]) < 1e-20 ? 1e-20 : c[3];
  return {
    uv: [(c[0] / w) * 0.5 + 0.5, (c[1] / w) * 0.5 + 0.5],
    raw: fromStandardDepth(ndcZToStandard(c[2] / w, o), conv),
    front: c[3] > 0,
  };
}

/** Screen uv (0…1, bottom-left) + raw depth → world position through the inverse view-projection matrix. */
export function reconstructWorld(
  uv: [number, number],
  raw: number,
  invViewProj: Mat4,
  conv: DepthConvention,
  o: ProjOptions,
): [number, number, number] {
  const p = mulMat4Vec4(invViewProj, [uv[0] * 2 - 1, uv[1] * 2 - 1, ndcZFromRaw(raw, conv, o), 1]);
  const w = Math.abs(p[3]) < 1e-20 ? 1e-20 : p[3];
  return [p[0] / w, p[1] / w, p[2] / w];
}

/** Vertical FOV (radians) and aspect recovered from a perspective projection matrix (P11 = 1/tan(fov/2), P00 = P11/aspect). */
export function fovAspectOf(p: Mat4): { fovY: number; aspect: number } {
  return { fovY: 2 * Math.atan(1 / p[5]!), aspect: p[5]! / p[0]! };
}
