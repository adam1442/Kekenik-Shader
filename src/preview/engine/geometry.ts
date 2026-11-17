import * as THREE from "three";
import type { PrimitiveId } from "../previewStore";
import { type SheetConfig, frameAt, frameRect, frameTotal } from "../logic/spriteSheet";

/** Build a primitive (unit-ish size, UVs 0..1). */
export function makePrimitive(id: PrimitiveId): THREE.BufferGeometry {
  switch (id) {
    case "sphere":
      return new THREE.SphereGeometry(0.5, 64, 40);
    case "cube":
      return new THREE.BoxGeometry(0.8, 0.8, 0.8, 1, 1, 1);
    case "plane":
      return new THREE.PlaneGeometry(1.2, 1.2, 1, 1);
    case "cylinder":
      return new THREE.CylinderGeometry(0.38, 0.38, 0.9, 48, 1);
    case "torus":
      return new THREE.TorusGeometry(0.36, 0.15, 32, 72);
    case "capsule":
      return new THREE.CapsuleGeometry(0.28, 0.5, 12, 32);
    case "quad":
      return new THREE.PlaneGeometry(1, 1, 1, 1);
  }
}

const ATTR_MAP: Array<[string, string, number]> = [
  ["position", "a_position", 3],
  ["normal", "a_normal", 3],
  ["uv", "a_uv0", 2],
  ["color", "a_color", 4],
  ["tangent", "a_tangent", 4],
  ["uv1", "a_uv1", 2],
  ["uv2", "a_uv2", 2],
  ["uv3", "a_uv3", 2],
];

/** Widen a vertex-colour attribute (3 → 4 components, alpha 1). */
function widenColor(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const out = new Float32Array(a.count * 4);
  for (let i = 0; i < a.count; i++) {
    out[i * 4] = a.getX(i);
    out[i * 4 + 1] = a.getY(i);
    out[i * 4 + 2] = a.getZ(i);
    out[i * 4 + 3] = a.itemSize > 3 ? a.getW(i) : 1;
  }
  return new THREE.BufferAttribute(out, 4);
}

/**
 * Geometry whose attributes use the generated shader's names (`a_position`, `a_normal`, `a_uv0`, …). Attribute buffers
 * are shared with the source geometry (no copy) except widened vertex colours and computed tangents.
 */
export function toShaderGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  if (src.index) g.setIndex(src.index);
  const hasTangent = !!src.getAttribute("tangent");
  if (!hasTangent && src.index && src.getAttribute("uv") && src.getAttribute("normal")) {
    try {
      const c = src.clone();
      c.computeTangents();
      src = c;
    } catch {
      /* tangents are optional */
    }
  }
  // Keep the original names too so engine materials (original model materials, debug overlays) can share this geometry.
  for (const name of Object.keys(src.attributes)) g.setAttribute(name, src.getAttribute(name));
  for (const [from, to, size] of ATTR_MAP) {
    const a = src.getAttribute(from);
    if (!a) continue;
    if (from === "color" && a.itemSize !== size) g.setAttribute(to, widenColor(a));
    else if (a.itemSize === size) g.setAttribute(to, a as THREE.BufferAttribute);
  }
  g.groups = src.groups.map((x) => ({ ...x }));
  g.boundingBox = src.boundingBox;
  g.boundingSphere = src.boundingSphere;
  if (!g.boundingSphere) g.computeBoundingSphere();
  return g;
}

/** Sprite quad: aspect-correct, UV0 = sheet-space UV of the current frame, UV1 = local 0..1, UV2 = (frame, frames), UV3 = frame rect size. */
export function makeSpriteGeometry(
  width: number,
  height: number,
  sheet: SheetConfig,
  time: number,
): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const hw = width / 2;
  const hh = height / 2;
  const pos = new THREE.BufferAttribute(new Float32Array([-hw, -hh, 0, hw, -hh, 0, hw, hh, 0, -hw, hh, 0]), 3);
  g.setAttribute("a_position", pos);
  g.setAttribute("position", pos); // three.js needs `position` for bounds / framing
  g.setAttribute("a_normal", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute("a_uv0", new THREE.BufferAttribute(new Float32Array(8), 2));
  g.setAttribute("a_uv1", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setAttribute("a_uv2", new THREE.BufferAttribute(new Float32Array(8), 2));
  g.setAttribute("a_uv3", new THREE.BufferAttribute(new Float32Array(8), 2));
  g.setAttribute("a_color", new THREE.BufferAttribute(new Float32Array(16).fill(1), 4));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  updateSpriteFrame(g, sheet, time);
  g.computeBoundingSphere();
  return g;
}

/** Write the current frame's UV rect into the sprite quad; returns the frame index. */
export function updateSpriteFrame(g: THREE.BufferGeometry, sheet: SheetConfig, time: number): number {
  const f = frameAt(sheet, time);
  const r = frameRect(sheet, f);
  const uv0 = g.getAttribute("a_uv0") as THREE.BufferAttribute;
  const uv2 = g.getAttribute("a_uv2") as THREE.BufferAttribute;
  const uv3 = g.getAttribute("a_uv3") as THREE.BufferAttribute;
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  corners.forEach(([cx, cy], i) => {
    uv0.setXY(i, r.u + cx! * r.w, r.v + cy! * r.h);
    uv2.setXY(i, f, frameTotal(sheet));
    uv3.setXY(i, r.w, r.h);
  });
  uv0.needsUpdate = uv2.needsUpdate = uv3.needsUpdate = true;
  return f;
}
