import * as THREE from "three";
import type { ShaderBinding } from "./shaderBinding";

const FLOOR_SIZE = 8;

/**
 * Soft-particle support for the VFX preview. Particles are transparent and write no depth, so to fade them against
 * "something" the preview shows a small opaque floor, renders ONLY that floor into a depth texture before the main
 * pass, and feeds the texture to shaders wrapped by `patchSoft` (uniforms `ks_soft_*`).
 */
export class SoftDepth {
  /** The visible floor (lives in the main scene). */
  readonly floor: THREE.Mesh;
  private readonly depthMesh: THREE.Mesh;
  private readonly depthScene = new THREE.Scene();
  private rt: THREE.WebGLRenderTarget | null = null;
  private readonly geometry = new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE).rotateX(-Math.PI / 2);
  private readonly sizeTmp = new THREE.Vector2();

  constructor() {
    this.floor = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({ color: 0x23262d, side: THREE.DoubleSide }),
    );
    this.floor.visible = false;
    this.depthMesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }),
    );
    this.depthScene.add(this.depthMesh);
  }

  get active(): boolean {
    return this.floor.visible;
  }

  /** Show / hide the floor and put it just below `floorY` (so the grid overlay stays visible on top of it). */
  sync(active: boolean, floorY: number): void {
    this.floor.visible = active;
    this.floor.position.y = floorY - 0.004;
    this.depthMesh.position.y = floorY - 0.004;
  }

  /** Render the floor depth into a texture of the given size (restores the previously bound render target). */
  render(renderer: THREE.WebGLRenderer, camera: THREE.Camera, w: number, h: number): void {
    if (!this.floor.visible) return;
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.depthTexture?.dispose();
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, depthTexture: new THREE.DepthTexture(w, h) });
    }
    const prev = renderer.getRenderTarget();
    const clear = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, true);
    renderer.render(this.depthScene, camera);
    renderer.setRenderTarget(prev);
    renderer.setClearColor(clear, clearAlpha);
  }

  /** Feed the last rendered depth to a soft-wrapped shader (no-op for other shaders). `distance` is the fade length in world units. */
  bind(b: ShaderBinding | null, camera: THREE.Camera, distance: number, w: number, h: number): void {
    if (!b?.uniform("ks_soft_Depth")) return;
    const cam = camera as THREE.PerspectiveCamera;
    b.uniform("ks_soft_Depth")!.value = this.rt?.depthTexture ?? null;
    (b.uniform("ks_soft_Params")!.value as THREE.Vector4).set(
      cam.near,
      cam.far,
      distance,
      (camera as THREE.OrthographicCamera).isOrthographicCamera ? 1 : 0,
    );
    (b.uniform("ks_soft_Size")!.value as THREE.Vector2).set(w, h);
  }

  /** Drawing-buffer size of a renderer (what `gl_FragCoord` is measured in). */
  bufferSize(renderer: THREE.WebGLRenderer): { w: number; h: number } {
    renderer.getDrawingBufferSize(this.sizeTmp);
    return { w: this.sizeTmp.x, h: this.sizeTmp.y };
  }

  dispose(): void {
    this.rt?.depthTexture?.dispose();
    this.rt?.dispose();
    this.rt = null;
    this.geometry.dispose();
    (this.floor.material as THREE.Material).dispose();
    (this.depthMesh.material as THREE.Material).dispose();
  }
}
