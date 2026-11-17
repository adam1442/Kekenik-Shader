import * as THREE from "three";
import type { PreviewPrefs } from "../previewStore";
import { makeCatcherMaterial } from "./shadows";

/**
 * Scene props of the preview (Part B): the optional INTERSECTOR (sphere / box) that gives depth nodes (Scene Depth, Soft Particles,
 * intersection / depth-fade effects) something to intersect, and the ground-mode switch of the floor owned by `SoftDepth`
 * (none / grid / shadow catcher / matte). The props live in the main scene, so the depth pre-pass and the opaque-colour pass of the
 * emulation layer include them automatically.
 */
export class SceneProps {
  readonly intersector: THREE.Mesh;
  readonly catcher = makeCatcherMaterial();
  private readonly spheres = new THREE.SphereGeometry(0.5, 32, 20);
  private readonly boxes = new THREE.BoxGeometry(1, 1, 1);
  private matte: THREE.Material | null = null;

  constructor() {
    this.intersector = new THREE.Mesh(
      this.spheres,
      new THREE.MeshStandardMaterial({ color: 0x8a93a3, roughness: 0.6, metalness: 0 }),
    );
    this.intersector.visible = false;
  }

  /** Does the ground need a floor mesh (everything but none / grid)? */
  static wantsFloor(p: Pick<PreviewPrefs, "ground" | "mode">): boolean {
    return p.mode !== "2d" && (p.ground === "matte" || p.ground === "catcher");
  }

  sync(p: PreviewPrefs, floor: THREE.Mesh): void {
    const on = p.intersector !== "none" && p.mode === "3d";
    this.intersector.visible = on;
    if (on) {
      this.intersector.geometry = p.intersector === "box" ? this.boxes : this.spheres;
      this.intersector.position.set(...p.intersectorPos);
      this.intersector.scale.setScalar(Math.max(0.01, p.intersectorScale));
    }
    if (!this.matte) this.matte = floor.material as THREE.Material;
    floor.material = p.ground === "catcher" ? this.catcher : this.matte;
  }

  /** World bounds of everything that casts a shadow: the content box plus the intersector prop. */
  casterBox(content: THREE.Box3): THREE.Box3 {
    const b = content.clone();
    if (this.intersector.visible) b.union(new THREE.Box3().setFromObject(this.intersector));
    return b;
  }

  /** Feed the catcher the key-light shadow map. */
  bindShadow(matrix: THREE.Matrix4, map: THREE.Texture | null, bias: number, softness: number, texel: number): void {
    const u = this.catcher.uniforms;
    (u.ks_cMat!.value as THREE.Matrix4).copy(matrix);
    u.ks_cMap!.value = map;
    (u.ks_cPar!.value as THREE.Vector4).set(bias, softness, texel, 0.6);
  }

  dispose(): void {
    this.catcher.dispose();
    this.spheres.dispose();
    this.boxes.dispose();
    (this.intersector.material as THREE.Material).dispose();
  }
}
