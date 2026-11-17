import * as THREE from "three";
import type { DebugView } from "../previewStore";
import { applySceneContext } from "./sceneContext";

/** Set the `ks_*` host uniforms of whichever material is about to draw `obj` (generated shaders, debug and backdrop materials). */
export interface HostClock {
  time: number;
  delta: number;
}

const tmpN = new THREE.Matrix3();
const tmpInv = new THREE.Matrix4();

export function setHostUniforms(
  material: THREE.Material,
  obj: THREE.Object3D,
  camera: THREE.Camera,
  clock: HostClock,
): void {
  const m = material as THREE.RawShaderMaterial;
  const u = m.uniforms;
  if (!u) return;
  if (u.ks_Model) u.ks_Model.value.copy(obj.matrixWorld);
  if (u.ks_View) u.ks_View.value.copy(camera.matrixWorldInverse);
  if (u.ks_Projection) u.ks_Projection.value.copy(camera.projectionMatrix);
  if (u.ks_ViewInverse) u.ks_ViewInverse.value.copy(camera.matrixWorld);
  if (u.ks_WorldToObject) u.ks_WorldToObject.value.copy(tmpInv.copy(obj.matrixWorld).invert());
  if (u.ks_NormalMatrix) u.ks_NormalMatrix.value.copy(tmpN.getNormalMatrix(obj.matrixWorld));
  if (u.ks_CameraPos) u.ks_CameraPos.value.setFromMatrixPosition(camera.matrixWorld);
  if (u.ks_lit_Cam) u.ks_lit_Cam.value.setFromMatrixPosition(camera.matrixWorld);
  if (u.ks_Time) u.ks_Time.value = clock.time;
  if (u.ks_DeltaTime) u.ks_DeltaTime.value = clock.delta;
  if (u.ks_SmoothDeltaTime) u.ks_SmoothDeltaTime.value = clock.delta;
  applySceneContext(u, camera);
  m.uniformsNeedUpdate = true;
}

/** Route `onBeforeRender` of an object to `setHostUniforms` (handles material arrays: the current material is passed in). */
export function attachHostUniforms(obj: THREE.Object3D, clock: HostClock): void {
  obj.onBeforeRender = (_r, _s, camera, _g, material) => setHostUniforms(material, obj, camera, clock);
}

const COMMON_VS = `
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv0;
uniform mat4 ks_Model; uniform mat4 ks_View; uniform mat4 ks_Projection; uniform mat3 ks_NormalMatrix;
out vec3 v_n; out vec2 v_uv;
void main() { v_n = ks_NormalMatrix * a_normal; v_uv = a_uv0; gl_Position = ks_Projection * ks_View * ks_Model * vec4(a_position, 1.0); }
`;

const UV_FS = `
precision highp float;
in vec3 v_n; in vec2 v_uv; out vec4 o;
void main() {
  vec2 g = floor(v_uv * 8.0);
  float checker = mod(g.x + g.y, 2.0);
  vec3 base = mix(vec3(0.16), vec3(0.28), checker);
  vec3 col = mix(base, vec3(v_uv, 0.25), 0.55);
  vec2 f = abs(fract(v_uv * 8.0 - 0.5) - 0.5) / fwidth(v_uv * 8.0);
  col = mix(col, vec3(1.0), (1.0 - min(min(f.x, f.y), 1.0)) * 0.25);
  if (v_uv.x < 0.0 || v_uv.x > 1.0 || v_uv.y < 0.0 || v_uv.y > 1.0) col = vec3(1.0, 0.1, 0.5);
  o = vec4(col, 1.0);
}`;

const NORMAL_FS = `
precision highp float;
in vec3 v_n; in vec2 v_uv; out vec4 o;
void main() { o = vec4(normalize(v_n) * 0.5 + 0.5, 1.0); }`;

/** Debug view materials: UV checker / world normals. */
function makeDebugMaterial(view: Exclude<DebugView, "shader">): THREE.RawShaderMaterial {
  const m = new THREE.RawShaderMaterial({
    vertexShader: COMMON_VS,
    fragmentShader: view === "uv" ? UV_FS : NORMAL_FS,
    uniforms: {
      ks_Model: { value: new THREE.Matrix4() },
      ks_View: { value: new THREE.Matrix4() },
      ks_Projection: { value: new THREE.Matrix4() },
      ks_NormalMatrix: { value: new THREE.Matrix3() },
    },
    side: THREE.DoubleSide,
    glslVersion: THREE.GLSL3,
  });
  return m;
}

const BACKDROP_VS = `
precision highp float;
layout(location = 0) in vec3 a_position;
uniform mat4 ks_View; uniform mat4 ks_Projection;
out vec3 v_dir;
void main() { v_dir = a_position; vec4 p = ks_Projection * mat4(mat3(ks_View)) * vec4(a_position, 1.0); gl_Position = p.xyww; }`;
const BACKDROP_FS = `
precision highp float;
uniform sampler2D ks_lit_Env; uniform float ks_lit_EnvI; uniform float ks_lit_EnvRot; uniform float ks_lit_Blur;
in vec3 v_dir; out vec4 o;
void main() {
  vec3 d = normalize(v_dir);
  vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5 + ks_lit_EnvRot, asin(clamp(d.y, -1.0, 1.0)) / 3.14159265 + 0.5);
  vec3 c = textureLod(ks_lit_Env, uv, 1.5 + ks_lit_Blur * 6.0).rgb * ks_lit_EnvI * 0.6;
  c = c / (1.0 + c);
  o = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`;

/** Sky-sphere that shows the active environment as the viewport background. */
export function makeBackdrop(): { mesh: THREE.Mesh; material: THREE.RawShaderMaterial } {
  const material = new THREE.RawShaderMaterial({
    vertexShader: BACKDROP_VS,
    fragmentShader: BACKDROP_FS,
    uniforms: {
      ks_View: { value: new THREE.Matrix4() },
      ks_Projection: { value: new THREE.Matrix4() },
      ks_lit_Env: { value: null },
      ks_lit_EnvI: { value: 1 },
      ks_lit_EnvRot: { value: 0 },
      ks_lit_Blur: { value: 0 },
    },
    glslVersion: THREE.GLSL3,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const geo = new THREE.SphereGeometry(1, 24, 16);
  geo.setAttribute("a_position", geo.getAttribute("position"));
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, material };
}

/** Grid + axes helpers. */
export class Overlays {
  readonly group = new THREE.Group();
  private readonly grid = new THREE.GridHelper(4, 16, 0x5a5f6b, 0x30343c);
  private readonly axes = new THREE.AxesHelper(0.7);
  constructor() {
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.55;
    this.group.add(this.grid, this.axes);
  }
  update(o: { grid: boolean; axes: boolean; is3d: boolean; floorY: number }): void {
    this.grid.visible = o.grid && o.is3d;
    this.axes.visible = o.axes && o.is3d;
    this.grid.position.y = o.floorY - 0.002;
  }
  dispose(): void {
    this.grid.geometry.dispose();
    this.axes.geometry.dispose();
  }
}

const wireMaterial = new THREE.MeshBasicMaterial({
  color: 0x7ab8ff,
  wireframe: true,
  transparent: true,
  opacity: 0.55,
  depthTest: true,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -1,
});

/** Add / remove a wireframe overlay child on every mesh. */
export function setWireframe(meshes: THREE.Mesh[], on: boolean): void {
  for (const m of meshes) {
    const existing = m.children.find((c) => c.userData.kkWire);
    if (on && !existing) {
      const w = new THREE.Mesh(m.geometry, wireMaterial);
      w.userData.kkWire = true;
      w.raycast = () => undefined;
      m.add(w);
    } else if (!on && existing) m.remove(existing);
  }
}

/** The UV / normals debug material of the current debug view (rebuilt only when the view changes). */
export class DebugMaterials {
  private mat: THREE.RawShaderMaterial | null = null;
  private kind = "";

  get(view: Exclude<DebugView, "shader">): THREE.RawShaderMaterial {
    if (this.kind !== view || !this.mat) {
      this.mat?.dispose();
      this.mat = makeDebugMaterial(view);
      this.kind = view;
    }
    return this.mat;
  }

  dispose(): void {
    this.mat?.dispose();
    this.mat = null;
    this.kind = "";
  }
}

/** Show / hide the environment sky and push its uniforms (intensity, rotation, blur). */
export function syncBackdrop(
  b: { mesh: THREE.Mesh; material: THREE.RawShaderMaterial },
  p: { bg: string; envIntensity: number; envRotation: number; envBlur: number },
  env: THREE.Texture,
  is3d: boolean,
): void {
  b.mesh.visible = p.bg === "environment" && is3d;
  const u = b.material.uniforms;
  u.ks_lit_Env!.value = env;
  u.ks_lit_EnvI!.value = p.envIntensity;
  u.ks_lit_EnvRot!.value = p.envRotation;
  u.ks_lit_Blur!.value = p.envBlur;
}
