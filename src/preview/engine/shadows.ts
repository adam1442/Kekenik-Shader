import * as THREE from "three";

/** Shadow-map resolution of the preview key light. */
export const SHADOW_SIZE = 1024;

export interface ShadowInput {
  /** Unit direction from the scene towards the key light. */
  dir: readonly [number, number, number];
  /** World-space bounds of everything that casts shadows. */
  box: THREE.Box3;
  /** Objects that must not be drawn into the map (backdrop, overlays, receivers such as the floor). */
  hide: readonly THREE.Object3D[];
}

/** Light camera of one frame: orthographic, fitted to a bounding sphere. Pure maths (unit-tested). */
function fitShadowCamera(
  cam: THREE.OrthographicCamera,
  dir: readonly [number, number, number],
  box: THREE.Box3,
): { radius: number } {
  const sphere = box.isEmpty() ? new THREE.Sphere(new THREE.Vector3(), 1) : box.getBoundingSphere(new THREE.Sphere());
  const r = Math.max(0.25, sphere.radius * 1.08);
  cam.left = -r;
  cam.right = r;
  cam.top = r;
  cam.bottom = -r;
  cam.near = 0.05;
  cam.far = r * 5;
  cam.position.copy(sphere.center).addScaledVector(new THREE.Vector3(...dir).normalize(), r * 2.5);
  cam.up.set(Math.abs(dir[1]) > 0.98 ? 1 : 0, Math.abs(dir[1]) > 0.98 ? 0 : 1, 0);
  cam.lookAt(sphere.center);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  return { radius: r };
}

/**
 * Directional shadow map of the preview (Part A/B): the casters are rendered once per frame from the key light into a depth texture;
 * the lighting prelude (`ks_lit_shadowAt`, 3×3 PCF) and the shadow-catcher floor read it. Only rendered when something reads it.
 */
export class ShadowPass {
  /** World → light clip space (`ks_lit_ShadowMat`). */
  readonly matrix = new THREE.Matrix4();
  private rt: THREE.WebGLRenderTarget | null = null;
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 10);
  private readonly mat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  /** Frames rendered (tests assert that a disabled pass costs nothing). */
  renders = 0;

  get texture(): THREE.Texture | null {
    return this.rt?.depthTexture ?? null;
  }

  render(r: THREE.WebGLRenderer, scene: THREE.Scene, i: ShadowInput): void {
    if (!this.rt)
      this.rt = new THREE.WebGLRenderTarget(SHADOW_SIZE, SHADOW_SIZE, {
        depthBuffer: true,
        depthTexture: new THREE.DepthTexture(SHADOW_SIZE, SHADOW_SIZE),
      });
    fitShadowCamera(this.cam, i.dir, i.box);
    this.matrix.multiplyMatrices(this.cam.projectionMatrix, this.cam.matrixWorldInverse);
    const prev = r.getRenderTarget();
    const vis = i.hide.map((o) => o.visible);
    i.hide.forEach((o) => (o.visible = false));
    try {
      scene.overrideMaterial = this.mat;
      r.setRenderTarget(this.rt);
      r.clear(true, true, true);
      r.render(scene, this.cam);
      this.renders++;
    } finally {
      scene.overrideMaterial = null;
      i.hide.forEach((o, k) => (o.visible = vis[k]!));
      r.setRenderTarget(prev);
    }
  }

  dispose(): void {
    this.rt?.depthTexture?.dispose();
    this.rt?.dispose();
    this.rt = null;
    this.mat.dispose();
  }
}

/** Floor that shows ONLY the key-light shadow (transparent elsewhere). Shares the shadow pass' map + matrix. */
export function makeCatcherMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ks_cMat: { value: new THREE.Matrix4() },
      ks_cMap: { value: null },
      ks_cPar: { value: new THREE.Vector4(0.0015, 1, 1 / SHADOW_SIZE, 0.6) },
    },
    vertexShader:
      "varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: `varying vec3 vW; uniform mat4 ks_cMat; uniform highp sampler2D ks_cMap; uniform vec4 ks_cPar;
      void main() {
        vec4 sp = ks_cMat * vec4(vW, 1.0); vec3 c = sp.xyz / sp.w * 0.5 + 0.5;
        float lit = 1.0;
        if (c.x > 0.0 && c.x < 1.0 && c.y > 0.0 && c.y < 1.0 && c.z < 1.0) {
          float s = 0.0;
          for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) s += (c.z - ks_cPar.x > texture2D(ks_cMap, c.xy + vec2(float(i), float(j)) * ks_cPar.z * ks_cPar.y).r) ? 0.0 : 1.0;
          lit = s / 9.0;
        }
        gl_FragColor = vec4(0.0, 0.0, 0.0, (1.0 - lit) * ks_cPar.w);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
