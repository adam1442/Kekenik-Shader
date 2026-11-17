import * as THREE from "three";
import type { ShaderBinding } from "../engine/shaderBinding";
import { COLOR_TEX, DEPTH_TEX, NORMALS_TEX } from "./table";

/**
 * Render resources of the emulation layer (Part C): the OPAQUE COLOUR target (backdrop + ground + props, WITHOUT the shaded mesh — what
 * Scene Color shows) and the DEPTH PRE-PASS target (scene props + the shaded mesh when it is opaque). Only rendered when the compiled
 * shader actually reads them (`resourcesUsedBy`).
 */
export class EmulationPass {
  private colorRt: THREE.WebGLRenderTarget | null = null;
  private depthRt: THREE.WebGLRenderTarget | null = null;
  private normalsRt: THREE.WebGLRenderTarget | null = null;
  /** World-space normals (−1..1) written as colour into a half-float target. */
  private readonly normalsMat = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader:
      "varying vec3 vN; void main() { vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader:
      "varying vec3 vN; void main() { vec3 n = normalize(vN); gl_FragColor = vec4(gl_FrontFacing ? n : -n, 1.0); }",
  });
  private readonly depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  /** Passes rendered in the last `render` (tests read it). */
  last: string[] = [];

  private ensure(w: number, h: number): void {
    if (this.colorRt && this.colorRt.width === w && this.colorRt.height === h) return;
    this.dispose();
    this.colorRt = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.depthRt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, depthTexture: new THREE.DepthTexture(w, h) });
    this.normalsRt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: true });
  }

  /** `hideForDepth` = objects that must not write depth (grid / axes / backdrop); `content` is hidden for the colour pass. */
  render(
    r: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    o: {
      w: number;
      h: number;
      depth: boolean;
      color: boolean;
      normals?: boolean;
      content: THREE.Object3D;
      contentOpaque: boolean;
      hideForDepth: THREE.Object3D[];
      backdrop: readonly [number, number, number];
    },
  ): void {
    this.last = [];
    if (!o.depth && !o.color && !o.normals) return;
    this.ensure(o.w, o.h);
    const prev = r.getRenderTarget();
    const clear = r.getClearColor(new THREE.Color());
    const alpha = r.getClearAlpha();
    const contentVisible = o.content.visible;
    try {
      if (o.color) {
        o.content.visible = false;
        r.setRenderTarget(this.colorRt);
        r.setClearColor(new THREE.Color(o.backdrop[0], o.backdrop[1], o.backdrop[2]), 1); // the viewport backdrop (CSS behind the canvas is invisible to GL) — Scene Color shows it
        r.clear(true, true, true);
        r.render(scene, camera);
        this.last.push("color");
      }
      // Depth + normals pre-passes: the scene props + the shaded mesh when it is opaque (one override material each).
      for (const [wanted, name, rt, mat] of [
        [o.depth, "depth", this.depthRt, this.depthMat],
        [o.normals === true, "normals", this.normalsRt, this.normalsMat],
      ] as const) {
        if (!wanted) continue;
        const vis = o.hideForDepth.map((x) => x.visible);
        o.hideForDepth.forEach((x) => (x.visible = false));
        o.content.visible = o.contentOpaque;
        scene.overrideMaterial = mat;
        r.setRenderTarget(rt);
        r.setClearColor(0x000000, 0);
        r.clear(true, true, true);
        r.render(scene, camera);
        this.last.push(name);
        scene.overrideMaterial = null;
        o.hideForDepth.forEach((x, i) => (x.visible = vis[i]!));
      }
    } finally {
      scene.overrideMaterial = null;
      o.content.visible = contentVisible;
      r.setRenderTarget(prev);
      r.setClearColor(clear, alpha);
    }
  }

  bind(b: ShaderBinding | null): void {
    const d = b?.uniform(DEPTH_TEX);
    if (d) d.value = this.depthRt?.depthTexture ?? null;
    const c = b?.uniform(COLOR_TEX);
    if (c) c.value = this.colorRt?.texture ?? null;
    const n = b?.uniform(NORMALS_TEX);
    if (n) n.value = this.normalsRt?.texture ?? null;
  }

  dispose(): void {
    this.colorRt?.dispose();
    this.depthRt?.depthTexture?.dispose();
    this.depthRt?.dispose();
    this.normalsRt?.dispose();
    this.normalsRt = null;
    this.colorRt = null;
    this.depthRt = null;
  }
}
