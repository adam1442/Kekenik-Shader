import * as THREE from "three";
import { parseColor } from "@/core/values/color";
import { type SceneSim, getSim } from "../sceneSim";
import type { PreviewPrefs } from "../previewStore";

/**
 * SceneContext: feeds every `ks_*` scene uniform (camera parameters, screen size, fog, ambient, main light, sprite info) of the
 * generated shaders. Values are the REAL ones (camera, viewport, loaded sprite) unless Scene Simulation overrides them. Only uniforms
 * are touched here — nothing recompiles when a simulation value changes.
 */
export interface FrameInfo {
  /** Drawing-buffer size in pixels. */
  w: number;
  h: number;
}
export interface SpriteContext {
  /** Frame rectangle inside the sheet in UV units (x, y, w, h). */
  rect: [number, number, number, number];
  /** Frame size in pixels. */
  px: [number, number];
}

const frame: FrameInfo = { w: 1, h: 1 };
let sprite: SpriteContext | null = null;
let lightPrefs = { azimuth: 35, elevation: 40, intensity: 1 };

const setFrameInfo = (w: number, h: number): void => {
  frame.w = Math.max(1, w);
  frame.h = Math.max(1, h);
};
export const setSpriteContext = (s: SpriteContext | null): void => {
  sprite = s;
};
const setLightPrefs = (p: Pick<PreviewPrefs, "lightAzimuth" | "lightElevation" | "lightIntensity">): void => {
  lightPrefs = { azimuth: p.lightAzimuth, elevation: p.lightElevation, intensity: p.lightIntensity };
};

/** Linear RGB × `k` of a hex colour (`parseColor` already returns LINEAR components — no second sRGB decode). */
const rgb = (hex: string, k: number): [number, number, number] => {
  const c = parseColor(hex) ?? { r: 1, g: 1, b: 1, a: 1 };
  return [c.r * k, c.g * k, c.b * k];
};

/** Unit world-space direction TOWARDS the key light (the preview's key light: azimuth / elevation in degrees). */
function lightDirection(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

type Uniforms = Record<string, THREE.IUniform>;
const set3 = (u: Uniforms, n: string, v: [number, number, number]): void => {
  (u[n]?.value as THREE.Vector3 | undefined)?.set(v[0], v[1], v[2]);
};
const set4 = (u: Uniforms, n: string, a: number, b: number, c: number, d: number): void => {
  (u[n]?.value as THREE.Vector4 | undefined)?.set(a, b, c, d);
};

/** Write the scene uniforms a material declares (absent uniforms are skipped). */
export function applySceneContext(u: Uniforms, camera: THREE.Camera): void {
  const sim = getSim();
  const cam = camera as THREE.PerspectiveCamera & THREE.OrthographicCamera;
  if (u.ks_ProjectionInverse) (u.ks_ProjectionInverse.value as THREE.Matrix4).copy(camera.projectionMatrixInverse);
  if (u.ks_CameraParams) {
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera === true;
    set4(
      u,
      "ks_CameraParams",
      cam.near,
      cam.far,
      ortho ? 1 : 0,
      ortho ? (cam.top - cam.bottom) / 2 / Math.max(1e-6, cam.zoom || 1) : 0,
    );
  }
  set4(u, "ks_ScreenParams", frame.w, frame.h, 1 / frame.w, 1 / frame.h);
  const fogOn = sim.fogMode !== 0; // fog is a scene setting (Display → Fog), independent of the Simulation overrides
  set4(u, "ks_FogParams", fogOn ? sim.fogDensity : 0, sim.fogStart, sim.fogEnd, fogOn ? sim.fogMode : 0);
  const fc = rgb(sim.fogColor, 1);
  set4(u, "ks_FogColor", fc[0], fc[1], fc[2], 1);
  set3(u, "ks_MainLightDir", lightDirection(lightPrefs.azimuth, lightPrefs.elevation));
  const lc = sim.enabled
    ? rgb(sim.lightColor, sim.lightIntensity * lightPrefs.intensity)
    : ([lightPrefs.intensity, lightPrefs.intensity, lightPrefs.intensity] as [number, number, number]);
  set3(u, "ks_MainLightColor", lc);
  set3(u, "ks_AmbientColor", sim.enabled ? rgb(sim.ambient, sim.ambientIntensity) : [0.03, 0.03, 0.04]);
  const r = sprite?.rect ?? [0, 0, 1, 1];
  set4(u, "ks_SpriteRect", r[0], r[1], r[2], r[3]);
  const px = sprite?.px ?? [frame.w, frame.h];
  set4(u, "ks_SpriteInfo", px[0], px[1], 100, 0);
}

/** Apply (or undo) the object transform override on the content root. */
function applyObjectOverride(root: THREE.Object3D): void {
  const s = getSim();
  if (s.enabled && s.overrideObject) {
    root.position.set(...s.objectPos);
    root.scale.set(...s.objectScale);
  } else if (root.userData.simApplied) {
    root.position.set(0, 0, 0);
    root.scale.set(1, 1, 1);
  }
  root.userData.simApplied = s.enabled && s.overrideObject;
}

/** Camera overrides of Scene Simulation for the camera rig (orthographic in 3D and VFX mode — soft particles need it; clip planes only when overridden). */
export const cameraSimOf = (
  sim: SceneSim,
  mode: PreviewPrefs["mode"],
): { ortho: boolean; halfHeight: number; near: number | null; far: number | null } => ({
  ortho: sim.enabled && sim.orthographic && mode !== "2d",
  halfHeight: sim.orthoSize,
  near: sim.enabled && sim.overrideClip ? sim.near : null,
  far: sim.enabled && sim.overrideClip ? sim.far : null,
});

/** Per-frame SceneContext sync: Scene Simulation camera overrides, object transform override, buffer size and the key light. */
export function syncSceneContext(
  rig: { sim: ReturnType<typeof cameraSimOf> },
  root: THREE.Object3D,
  prefs: PreviewPrefs,
  size: FrameInfo,
): void {
  rig.sim = cameraSimOf(getSim(), prefs.mode);
  applyObjectOverride(root);
  setFrameInfo(size.w, size.h);
  setLightPrefs(prefs);
}
