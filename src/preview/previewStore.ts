import { create } from "zustand";
import type { Diagnostic } from "@/core";
import { storage } from "@/app/lib/storage";
import { DEFAULT_EMITTER, type EmitterSettings } from "./logic/emitter";
import { DEFAULT_SHEET, type SheetConfig } from "./logic/spriteSheet";
import { DEFAULT_POST, type PostSettings, migrateBloomDefault, normalizePost } from "./gl/post/settings";

export type PreviewMode = "3d" | "2d" | "vfx";
export type PrimitiveId = "sphere" | "cube" | "plane" | "cylinder" | "torus" | "capsule" | "quad";
export type BgMode = "gradient" | "dark" | "light" | "checker" | "solid" | "environment";
/** Debug views (Preview toolbar). `uv` / `normals` use their own materials; all others read the preview surface contract (`ks_lit_Cfg.y`). */
export type DebugView =
  | "shader"
  | "uv"
  | "normals"
  | "baseColor"
  | "normalTS"
  | "normalWS"
  | "metallic"
  | "smoothness"
  | "occlusion"
  | "emission"
  | "alpha"
  | "vertexColor"
  | "sceneDepth";
export type GroundMode = "none" | "grid" | "catcher" | "matte";
export type IntersectorKind = "none" | "sphere" | "box";
export type EnvSource = "procedural" | "hdri";
export type LitMode = "auto" | "unlit" | "lit";
export type CameraPresetId = "front" | "back" | "left" | "right" | "top" | "bottom" | "iso";

export interface PreviewPrefs {
  mode: PreviewMode;
  primitive: PrimitiveId;
  /** Asset ids (null = none). */
  modelAssetId: string | null;
  spriteAssetId: string | null;
  hdrAssetId: string | null;
  /** Material slot that receives the shader; -1 = every slot. */
  materialSlot: number;
  debugView: DebugView;
  wireframe: boolean;
  grid: boolean;
  axes: boolean;
  stats: boolean;
  autoRotate: boolean;
  lit: LitMode;
  fillIntensity: number;
  rimIntensity: number;
  ground: GroundMode;
  fov: number;
  /** Light colours (hex, sRGB) multiplied into the key / fill / rim lights. */
  lightColor: string;
  fillColor: string;
  rimColor: string;
  shadows: boolean;
  /** PCF kernel scale (1 = one texel). */
  shadowSoftness: number;
  /** Depth bias in light-clip units. */
  shadowBias: number;
  envSource: EnvSource;
  /** Background blur of the environment (0 = sharp, 1 = fully blurred). */
  envBlur: number;
  intersector: IntersectorKind;
  intersectorPos: [number, number, number];
  intersectorScale: number;
  post: PostSettings;
  lightAzimuth: number;
  lightElevation: number;
  lightIntensity: number;
  envIntensity: number;
  envRotation: number;
  bg: BgMode;
  bgColor: string;
  speed: number;
  sheet: SheetConfig;
  nearest: boolean;
  emitter: EmitterSettings;
}

export const DEFAULT_PREFS: PreviewPrefs = {
  mode: "3d",
  primitive: "sphere",
  modelAssetId: null,
  spriteAssetId: null,
  hdrAssetId: null,
  materialSlot: 0,
  debugView: "shader",
  wireframe: false,
  grid: true,
  axes: false,
  stats: true,
  autoRotate: false,
  lit: "auto",
  fillIntensity: 1,
  rimIntensity: 1,
  ground: "none",
  fov: 45,
  lightColor: "#ffffff",
  fillColor: "#ffffff",
  rimColor: "#ffffff",
  shadows: true,
  shadowSoftness: 1.5,
  shadowBias: 0.0015,
  envSource: "hdri",
  envBlur: 0,
  intersector: "none",
  intersectorPos: [0.55, -0.2, 0.35],
  intersectorScale: 0.6,
  post: DEFAULT_POST,
  lightAzimuth: 35,
  lightElevation: 40,
  lightIntensity: 1,
  envIntensity: 1,
  envRotation: 0,
  bg: "gradient",
  bgColor: "#1b1d22",
  speed: 1,
  sheet: DEFAULT_SHEET,
  nearest: false,
  emitter: DEFAULT_EMITTER,
};

interface CompileStatus {
  state: "idle" | "ok" | "error";
  /** Wall-clock ms of the last graph → GLSL compile + GPU link. */
  ms: number;
  /** GPU programs created so far (increments only when the shader TEXT changed). */
  programs: number;
  /** Uniform-only updates (property edits that did not recompile). */
  uniformUpdates: number;
  message: string;
}

export interface ModelInfo {
  name: string;
  meshes: number;
  triangles: number;
  materials: string[];
}

interface RuntimeState {
  playing: boolean;
  compile: CompileStatus;
  /** GPU compile errors mapped to graph nodes (merged into the canvas badges and the Problems panel). */
  gpuDiagnostics: Diagnostic[];
  modelInfo: ModelInfo | null;
  fps: number;
  /** Texture property id → asset id (the project references assets by id). */
  bindings: Record<string, string | null>;
  loadError: string;
}

type State = PreviewPrefs &
  RuntimeState & {
    set: (patch: Partial<PreviewPrefs>) => void;
    setRuntime: (patch: Partial<RuntimeState>) => void;
    bind: (propId: string, assetId: string | null) => void;
  };

const PREFS_KEY = "preview.prefs";
const BIND_KEY = "preview.bindings";
const BLOOM_MIGRATION_KEY = "preview.bloomDefaultOn";

function loadPrefs(): PreviewPrefs {
  const saved = storage.getJSON<Partial<PreviewPrefs>>(PREFS_KEY) ?? {};
  const {
    metallic: _m,
    roughness: _r,
    ...rest
  } = saved as Partial<PreviewPrefs> & { metallic?: number; roughness?: number };
  void _m;
  void _r; // removed in 10b: material overrides live in the Material panel
  const bloomDone = storage.getJSON<boolean>(BLOOM_MIGRATION_KEY) === true;
  const post = migrateBloomDefault(saved.post, bloomDone);
  if (!bloomDone) storage.setJSON(BLOOM_MIGRATION_KEY, true);
  return {
    ...DEFAULT_PREFS,
    ...rest,
    post: normalizePost(post),
    sheet: { ...DEFAULT_SHEET, ...(saved.sheet ?? {}) },
    emitter: { ...DEFAULT_EMITTER, ...(saved.emitter ?? {}) },
  };
}

export const usePreview = create<State>((set, get) => ({
  ...loadPrefs(),
  playing: true,
  compile: { state: "idle", ms: 0, programs: 0, uniformUpdates: 0, message: "" },
  gpuDiagnostics: [],
  modelInfo: null,
  fps: 0,
  bindings: storage.getJSON<Record<string, string | null>>(BIND_KEY) ?? {},
  loadError: "",
  set: (patch) => set(patch),
  setRuntime: (patch) => set(patch),
  bind: (propId, assetId) => {
    set({ bindings: { ...get().bindings, [propId]: assetId } });
  },
}));

/** Prefs only (no runtime fields). */
export function getPrefs(): PreviewPrefs {
  const s = usePreview.getState();
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_PREFS)) out[k] = (s as unknown as Record<string, unknown>)[k];
  return out as unknown as PreviewPrefs;
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;
usePreview.subscribe((s, prev) => {
  const prefsChanged = Object.keys(DEFAULT_PREFS).some(
    (k) => (s as unknown as Record<string, unknown>)[k] !== (prev as unknown as Record<string, unknown>)[k],
  );
  if (!prefsChanged && s.bindings === prev.bindings) return;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    storage.setJSON(PREFS_KEY, getPrefs());
    storage.setJSON(BIND_KEY, usePreview.getState().bindings);
  }, 300);
});

/** Assets the project currently references (for the unused-asset indicator). */
export function referencedAssetIds(): Set<string> {
  const s = usePreview.getState();
  const ids = new Set<string>();
  for (const id of [s.modelAssetId, s.spriteAssetId, s.hdrAssetId]) if (id) ids.add(id);
  for (const id of Object.values(s.bindings)) if (id) ids.add(id);
  return ids;
}
