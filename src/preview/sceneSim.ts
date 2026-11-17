import { create } from "zustand";
import type { SceneTarget } from "@/core/engine/targets";
import { storage } from "@/app/lib/storage";
import { useShader } from "@/app/shaderStore";
import { backendOfFamily, targetFamilyOf } from "@/core/profiles/family";

/**
 * Scene Simulation: overrides for what the preview cannot naturally provide (camera kind / clip planes, fog, ambient, main light,
 * object transform, simulated export target). Everything except `target` is a UNIFORM-level change (no recompile); `target`
 * changes the compile-time constants (Target Switch, Is Reversed-Z, …) and therefore recompiles.
 */
export interface SceneSim {
  /** Master switch: off = the preview's natural values (perspective camera, no fog, white light, GLSL conventions). */
  enabled: boolean;
  /** Simulated export target for compile-time decisions (Target Switch, Is Reversed-Z / Y-Flipped / Linear). */
  target: SceneTarget;
  /** The simulated target FOLLOWS the graph's Target (toolbar dropdown) — `target` is only used when this is off (explicit override). */
  follow: boolean;
  /** Engine resource switches: "URP Depth Texture" / "Opaque Texture" off ⇒ Scene Depth / Scene Color behave like the engine without it (warning + neutral value). */
  depthTexture: boolean;
  opaqueTexture: boolean;
  orthographic: boolean;
  /** Orthographic half-height in world units. */
  orthoSize: number;
  overrideClip: boolean;
  near: number;
  far: number;
  fogMode: 0 | 1 | 2 | 3;
  fogColor: string;
  fogDensity: number;
  fogStart: number;
  fogEnd: number;
  ambient: string;
  ambientIntensity: number;
  lightColor: string;
  lightIntensity: number;
  overrideObject: boolean;
  objectPos: [number, number, number];
  objectScale: [number, number, number];
}

export const DEFAULT_SIM: SceneSim = {
  enabled: false,
  target: "glsl",
  follow: true,
  depthTexture: true,
  opaqueTexture: true,
  orthographic: false,
  orthoSize: 1.5,
  overrideClip: false,
  near: 0.1,
  far: 50,
  fogMode: 0,
  fogColor: "#8da2b8",
  fogDensity: 0.25,
  fogStart: 3,
  fogEnd: 12,
  ambient: "#404858",
  ambientIntensity: 1,
  lightColor: "#ffffff",
  lightIntensity: 1,
  overrideObject: false,
  objectPos: [0, 0, 0],
  objectScale: [1, 1, 1],
};

const KEY = "preview.sceneSim";
const load = (): SceneSim => ({ ...DEFAULT_SIM, ...(storage.getJSON<Partial<SceneSim>>(KEY) ?? {}) });

interface SimState extends SceneSim {
  set: (patch: Partial<SceneSim>) => void;
  reset: () => void;
}

export const useSceneSim = create<SimState>((set) => ({
  ...load(),
  set: (patch) => set(patch),
  reset: () => set({ ...DEFAULT_SIM }),
}));

const FIELDS = Object.keys(DEFAULT_SIM) as Array<keyof SceneSim>;
export const getSim = (): SceneSim => {
  const s = useSceneSim.getState();
  const o = {} as Record<string, unknown>;
  for (const k of FIELDS) o[k] = s[k];
  return o as unknown as SceneSim;
};

let timer: ReturnType<typeof setTimeout> | undefined;
useSceneSim.subscribe((s, prev) => {
  if (!FIELDS.some((k) => s[k] !== prev[k])) return;
  clearTimeout(timer);
  timer = setTimeout(() => storage.setJSON(KEY, getSim()), 300);
});

/** Backend of the graph's current target family (what "follow" resolves to). */
export const familyTarget = (): SceneTarget => {
  const g = useShader.getState().graph;
  return g ? backendOfFamily(targetFamilyOf(g)) : "glsl";
};

/**
 * The target compile-time decisions (Target Switch, Is Reversed-Z, node availability in the preview, emulation conventions) use:
 * the Target family of the graph while `follow` is on (default), else the explicit override. Independent of `enabled` — that switch
 * only controls the camera / fog / light / object overrides (root cause of defect 3: it used to gate the target too).
 */
export const effectiveTarget = (s: Pick<SceneSim, "follow" | "target">): SceneTarget =>
  s.follow ? familyTarget() : s.target;
