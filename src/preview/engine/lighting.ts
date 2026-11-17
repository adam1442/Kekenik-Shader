import * as THREE from "three";
import type { PreviewPrefs } from "../previewStore";
import { parseColor } from "@/core/values/color";
import { studioRig } from "../logic/roomEnv";
import { type SceneSim } from "../sceneSim";
import { SURFACE_DEBUG_ID } from "../gl/lighting/prelude";
import type { Environment } from "./environment";
import type { ShaderBinding } from "./shaderBinding";

/** The preview's lighting inputs as plain numbers (pure; unit-tested): key / fill / rim directions + linear colours. */
const tint = (hex: string | undefined): [number, number, number] => {
  const c = hex ? parseColor(hex) : null;
  return c ? [c.r, c.g, c.b] : [1, 1, 1];
};

export function lightRig(
  p: Pick<PreviewPrefs, "lightAzimuth" | "lightElevation" | "lightIntensity" | "fillIntensity" | "rimIntensity"> &
    Partial<Pick<PreviewPrefs, "lightColor" | "fillColor" | "rimColor">>,
): { dirs: Array<[number, number, number]>; colors: Array<[number, number, number]> } {
  const rig = studioRig(p.lightAzimuth, p.lightElevation, p.lightIntensity);
  const k = [1, p.fillIntensity, p.rimIntensity];
  const t = [tint(p.lightColor), tint(p.fillColor), tint(p.rimColor)];
  return {
    dirs: rig.dirs as Array<[number, number, number]>,
    colors: rig.colors.map(
      (c, i) => [c[0] * k[i]! * t[i]![0], c[1] * k[i]! * t[i]![1], c[2] * k[i]! * t[i]![2]] as [number, number, number],
    ),
  };
}

export interface LitFrame {
  /** 1 = Godot-like (Burley + Schlick-GGX), 0 = Unity-like (Lambert + GGX / Smith-Schlick). */
  godotBrdf: boolean;
  premultiplied: boolean;
  /** Key-light shadow map (null = shadows off or nothing rendered). */
  shadow?: { matrix: THREE.Matrix4; map: THREE.Texture | null; bias: number; softness: number; texel: number } | null;
  /** Fog of the scene (the same values feed the Fog node). */
  fog?: Pick<SceneSim, "fogMode" | "fogColor" | "fogDensity" | "fogStart" | "fogEnd">;
}

/** Studio 3-light rig for the ORIGINAL materials of imported models (three.js lights) and the uniforms of the preview lighting prelude. */
export class Lighting {
  readonly lights: THREE.DirectionalLight[] = [0, 1, 2].map(() => new THREE.DirectionalLight(0xffffff, 1));
  readonly ambient = new THREE.HemisphereLight(0xbcc8ff, 0x2a2420, 0.55);

  addTo(scene: THREE.Scene): void {
    scene.add(this.ambient, ...this.lights);
  }

  /** Aim the three.js lights at the preview rig (same directions as the surface prelude). */
  sync(p: PreviewPrefs): void {
    const rig = lightRig(p);
    this.lights.forEach((l, i) => {
      l.position.set(...rig.dirs[i]!).multiplyScalar(5);
      l.color.setRGB(...rig.colors[i]!);
      l.intensity = 1;
    });
    this.ambient.intensity = 0.5 * p.envIntensity;
  }

  /** Push light / config / environment values into a surface-wrapped shader (no-op for shaders without the prelude). */
  updateLit(b: ShaderBinding | null, p: PreviewPrefs, env: Environment, f: LitFrame): void {
    if (!b?.uniform("ks_lit_D0")) return;
    const rig = lightRig(p);
    for (let i = 0; i < 3; i++) {
      (b.uniform(`ks_lit_D${i}`)!.value as THREE.Vector3).set(...rig.dirs[i]!);
      (b.uniform(`ks_lit_C${i}`)!.value as THREE.Vector3).set(...rig.colors[i]!);
    }
    const dbg = (SURFACE_DEBUG_ID as Record<string, number>)[p.debugView === "shader" ? "final" : p.debugView] ?? 0;
    const sh = f.shadow && f.shadow.map ? f.shadow : null;
    (b.uniform("ks_lit_Cfg")!.value as THREE.Vector4).set(
      f.godotBrdf ? 1 : 0,
      dbg,
      sh ? 1 : 0,
      f.premultiplied ? 1 : 0,
    );
    if (sh) {
      (b.uniform("ks_lit_ShadowMat")!.value as THREE.Matrix4).copy(sh.matrix);
      b.uniform("ks_lit_ShadowMap")!.value = sh.map;
      (b.uniform("ks_lit_Shadow")!.value as THREE.Vector4).set(sh.bias, sh.softness, sh.texel, 0);
    }
    const fg = f.fog;
    (b.uniform("ks_lit_Fog")!.value as THREE.Vector4).set(
      fg?.fogMode ?? 0,
      fg?.fogDensity ?? 0,
      fg?.fogStart ?? 0,
      fg?.fogEnd ?? 1,
    );
    const fc = tint(fg?.fogColor);
    (b.uniform("ks_lit_FogCol")!.value as THREE.Vector3).set(fc[0], fc[1], fc[2]);
    (b.uniform("ks_lit_Cfg2")!.value as THREE.Vector4).set(p.lit === "unlit" ? -1 : p.lit === "lit" ? 1 : 0, 0, 0, 0);
    b.uniform("ks_lit_Env")!.value = env.active;
    b.uniform("ks_lit_EnvI")!.value = p.envIntensity;
    b.uniform("ks_lit_EnvRot")!.value = p.envRotation;
    b.uniform("ks_lit_EnvFlip")!.value = 0;
  }
}
