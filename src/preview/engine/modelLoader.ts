import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import type { ModelInfo } from "../previewStore";

/** Parse a model file held in memory into a Three.js object tree (GLB / GLTF with embedded data, OBJ, FBX). */
export async function parseModel(ext: string, buffer: ArrayBuffer): Promise<THREE.Object3D> {
  switch (ext.toLowerCase()) {
    case "glb":
    case "gltf":
      return new Promise<THREE.Object3D>((resolve, reject) => {
        new GLTFLoader().parse(
          buffer,
          "",
          (g) => resolve(g.scene),
          (e) => reject(new Error(`glTF: ${(e as { message?: string }).message ?? "could not be parsed"}`)),
        );
      });
    case "obj":
      return new OBJLoader().parse(new TextDecoder().decode(buffer));
    case "fbx":
      return new FBXLoader().parse(buffer, "");
    default:
      throw new Error(`Unsupported model format “.${ext}”`);
  }
}

export const meshesOf = (root: THREE.Object3D): THREE.Mesh[] => {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
  });
  return out;
};

/**
 * Material slots of a model = the distinct ORIGINAL materials in traversal order. (Meshes keep their original materials in
 * `userData.kkOriginal`, so slots stay stable after the shader was assigned.)
 */
function materialSlots(root: THREE.Object3D): THREE.Material[] {
  const seen = new Set<THREE.Material>();
  const out: THREE.Material[] = [];
  for (const m of meshesOf(root)) {
    const orig = (m.userData.kkOriginal as THREE.Material | THREE.Material[] | undefined) ?? m.material;
    for (const mat of Array.isArray(orig) ? orig : [orig]) if (!seen.has(mat)) (seen.add(mat), out.push(mat));
  }
  return out;
}

/**
 * Assign `shader` to material slot `slot` (-1 = every slot) and restore the original material everywhere else.
 * Returns how many (mesh, material-index) pairs received the shader.
 */
export function assignSlot(root: THREE.Object3D, slot: number, shader: THREE.Material): number {
  const slots = materialSlots(root);
  let n = 0;
  for (const mesh of meshesOf(root)) {
    if (!mesh.userData.kkOriginal) mesh.userData.kkOriginal = mesh.material;
    const orig = mesh.userData.kkOriginal as THREE.Material | THREE.Material[];
    const pick = (m: THREE.Material): THREE.Material => {
      const hit = slot < 0 || slots.indexOf(m) === slot;
      if (hit) n++;
      return hit ? shader : m;
    };
    mesh.material = Array.isArray(orig) ? orig.map(pick) : pick(orig);
  }
  return n;
}

export function summarize(root: THREE.Object3D, name: string): ModelInfo {
  const meshes = meshesOf(root);
  let tris = 0;
  for (const m of meshes) {
    const g = m.geometry;
    tris += Math.floor((g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0)) / 3);
  }
  return {
    name,
    meshes: meshes.length,
    triangles: tris,
    materials: materialSlots(root).map((m, i) => m.name || `Material ${i + 1}`),
  };
}

/** Scale to a unit-sized object centred at the origin (so camera framing and grid scale are model independent). */
export function normalizeModel(root: THREE.Object3D): THREE.Group {
  const wrap = new THREE.Group();
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (!box.isEmpty()) {
    const size = box.getSize(new THREE.Vector3());
    const k = 1 / Math.max(size.x, size.y, size.z, 1e-6);
    const c = box.getCenter(new THREE.Vector3());
    root.position.sub(c);
    wrap.scale.setScalar(k);
  }
  wrap.add(root);
  return wrap;
}
