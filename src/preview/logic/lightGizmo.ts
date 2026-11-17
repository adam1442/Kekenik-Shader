/**
 * Light gizmo maths (Part B): the key-light direction as a point on a unit disc seen from the camera side.
 * Disc coordinates are (x right, y DOWN) in [-1, 1]; `front` = the light is on the camera side of the object.
 */
export interface GizmoPoint {
  x: number;
  y: number;
  front: boolean;
}

export const anglesToGizmo = (azimuthDeg: number, elevationDeg: number): GizmoPoint => {
  const az = (azimuthDeg * Math.PI) / 180,
    el = (elevationDeg * Math.PI) / 180;
  return { x: Math.sin(az) * Math.cos(el), y: -Math.sin(el), front: Math.cos(az) >= 0 };
};

/** Inverse of `anglesToGizmo` (points outside the unit disc are clamped to its rim). */
export function gizmoToAngles(x: number, y: number, front: boolean): { azimuth: number; elevation: number } {
  const len = Math.hypot(x, y);
  const k = len > 1 ? 1 / len : 1;
  const px = x * k,
    py = -y * k;
  const z = Math.sqrt(Math.max(0, 1 - px * px - py * py)) * (front ? 1 : -1);
  return {
    azimuth: Math.round((Math.atan2(px, z) * 180) / Math.PI),
    elevation: Math.max(-10, Math.min(89, Math.round((Math.asin(Math.max(-1, Math.min(1, py))) * 180) / Math.PI))),
  };
}
