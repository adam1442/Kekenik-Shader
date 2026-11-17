import { M, type V } from "../procedural/irm";
import { enumParam } from "../kit";
import { linearizeStatic } from "../info/depthIr";

/**
 * DEPTH CONVENTIONS (Scene Depth, Linear Eye Depth, Soft-Particle Depth Fade):
 *  - "Raw" depth is the value stored in the depth buffer / depth texture, d ∈ [0, 1].
 *      standard  : 0 = near plane, 1 = far plane (OpenGL after the [-1,1] → [0,1] viewport transform, D3D non-reversed).
 *      reversed  : 1 = near plane, 0 = far plane (reversed-Z: Unity on D3D11/12, Metal, Vulkan, consoles; Godot 4).
 *      ndc       : the NDC z of an OpenGL projection, d ∈ [-1, 1] (gl_Position.z / w); remapped with d·0.5 + 0.5.
 *  - Eye depth = distance along the camera's view axis in world units (positive in front of the camera), the same quantity as
 *    the `w` of the clip-space position for a perspective camera.
 *  - Perspective:  eye = n·f / (f − d·(f − n)) with d already converted to the standard convention.  Orthographic: eye = n + d·(f − n).
 *  - Raw depth is clamped to its legal range, near is clamped to ≥ 1e-6 and far to ≥ near + 1e-6, so the result is always finite
 *    and lies in [near, far].
 */
export const CONVENTION_PARAM = enumParam(
  "convention",
  "Depth convention",
  [
    ["reversed", "Reversed Z (1 = near)"],
    ["standard", "Standard (0 = near)"],
    ["ndc", "OpenGL NDC (−1…1)"],
  ],
  "reversed",
);
export const PROJECTION_PARAM = enumParam(
  "projection",
  "Projection",
  [
    ["perspective", "Perspective"],
    ["orthographic", "Orthographic"],
  ],
  "perspective",
);

/** Raw depth → standard depth in [0, 1] (0 = near). Single implementation: info/depthIr. */
/** Eye depth (world units) and Linear01 depth from raw depth, projection chosen by the node parameter (shared maths: info/depthIr). */
export const linearizeDepth = (m: M, raw: V, near: V, far: V, conv: string, proj: string): { eye: V; linear01: V } =>
  linearizeStatic(m, raw, near, far, conv, proj === "orthographic");
