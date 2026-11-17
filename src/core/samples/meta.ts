import type { Property } from "../properties/model";

/**
 * Sample library metadata . Pure data + pure helpers: the sample builders (`samples/**`), the Sample Browser and the
 * auto-generated tests all read the same `SampleMeta` / `SampleIndexEntry` shapes. See docs/SAMPLES.md.
 */
export const SAMPLE_CATEGORIES = ["3D / Lit", "2D / Sprites", "VFX / Particles", "Utility"] as const;
export type SampleCategory = (typeof SAMPLE_CATEGORIES)[number];
export const SAMPLE_DIFFICULTIES = ["Beginner", "Intermediate", "Advanced"] as const;
export type SampleDifficulty = (typeof SAMPLE_DIFFICULTIES)[number];
/** Export targets a sample is verified on (Unity = URP; Godot = the profile reached through `switchProfile`). */
export const SAMPLE_TARGETS = ["glsl", "hlsl", "wgsl", "unity", "godot"] as const;
export type SampleTarget = (typeof SAMPLE_TARGETS)[number];
export const SAMPLE_BUDGETS = ["Mobile", "Desktop"] as const;
export type BudgetClass = (typeof SAMPLE_BUDGETS)[number];

/** Embedded preview configuration (translated to the project's `preview` section by `previewSectionOf`). */
export interface SamplePreviewConfig {
  mode: "3d" | "2d" | "vfx";
  /** Preview primitive (3D / VFX). */
  mesh?: "sphere" | "cube" | "plane" | "cylinder" | "torus" | "capsule" | "quad";
  /** 2D: the sprite shown is the sample's own procedural sprite texture (bound to the Sprite Texture property). */
  sprite?: boolean;
  lighting?: { lit?: "auto" | "unlit" | "lit"; azimuth?: number; elevation?: number; intensity?: number; envIntensity?: number; shadows?: boolean };
  /** Samples never auto-rotate the 3-D view (the user starts it from the preview toolbar), so there is no `autoRotate` here. */
  camera?: { fov?: number };
  background?: { mode?: "gradient" | "dark" | "light" | "checker" | "solid" | "environment"; color?: string; ground?: "none" | "grid" | "catcher" | "matte" };
  /** Depth-intersector object (water foam / force-field intersection). */
  intersector?: { kind: "sphere" | "box"; position?: [number, number, number]; scale?: number };
  /** VFX emitter overrides (free-form; merged over the preview's default emitter). */
  emitter?: Record<string, unknown>;
  /** Scene Simulation: simulated export target + engine resource switches. */
  simulation?: { target?: "glsl" | "unity" | "godot"; depthTexture?: boolean; opaqueTexture?: boolean };
  nearest?: boolean;
}

export interface SampleMeta {
  /** Stable id, `kebab-case` (also the file name `<id>.kshader`). */
  id: string;
  title: string;
  description: string;
  tags: string[];
  category: SampleCategory;
  difficulty: SampleDifficulty;
  /** Targets the sample compiles on (auto-tested). */
  targets: SampleTarget[];
  /** Precise notes on what differs / is unavailable per target (shown as badges in the Browser). */
  compatNotes: string[];
  /** Engine features that must be on (e.g. "URP Depth Texture"). */
  requiredFeatures: string[];
  budgetClass: BudgetClass;
  previewConfig: SamplePreviewConfig;
  /** Profile switched to for the `godot` target. */
  godotProfile: string;
  /** Master slot whose source is rendered as the Browser thumbnail (default: Base Color). Use `emission` when the colour is dark / flat. */
  thumbnailSlot?: string;
  /** Subgraph ids of the sample that are meant to be reused (offered by "Insert as subgraph"). */
  reusableSubgraphs?: string[];
}

export interface SampleParamSummary {
  id: string;
  name: string;
  type: string;
  category: string;
  default: unknown;
  min?: number;
  max?: number;
  hdr?: boolean;
  tooltip: string;
  texture?: string;
}

/** One entry of `public/samples/index.json`. */
export interface SampleIndexEntry extends SampleMeta {
  file: string;
  nodes: number;
  groups: number;
  comments: number;
  subgraphs: string[];
  /** Texture assets embedded in the file (procedural, seeded). */
  textures: string[];
  parameters: SampleParamSummary[];
  bytes: number;
}
export interface SampleIndex { format: "kekenik-samples"; version: 1; samples: SampleIndexEntry[] }

const SAMPLE_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Static metadata problems (empty = valid). */
export function validateSampleMeta(m: SampleMeta): string[] {
  const p: string[] = [];
  if (!SAMPLE_ID_PATTERN.test(m.id)) p.push(`id "${m.id}" must be kebab-case`);
  if (m.title.trim().length < 3) p.push("title is too short");
  if (m.description.trim().length < 30) p.push("description must explain the sample (≥ 30 characters)");
  if (m.tags.length < 2) p.push("at least two tags");
  if (!SAMPLE_CATEGORIES.includes(m.category)) p.push(`unknown category "${m.category}"`);
  if (!SAMPLE_DIFFICULTIES.includes(m.difficulty)) p.push(`unknown difficulty "${m.difficulty}"`);
  if (m.targets.length === 0 || m.targets.some((t) => !SAMPLE_TARGETS.includes(t))) p.push("targets must be a non-empty subset of glsl / hlsl / wgsl / unity / godot");
  if (!SAMPLE_BUDGETS.includes(m.budgetClass)) p.push(`unknown budget class "${m.budgetClass}"`);
  if (!["3d", "2d", "vfx"].includes(m.previewConfig.mode)) p.push("previewConfig.mode must be 3d / 2d / vfx");
  if (m.previewConfig.mode === "2d" && !m.previewConfig.sprite) p.push("2D samples must declare previewConfig.sprite");
  if (m.targets.includes("godot") && !m.godotProfile.startsWith("godot.")) p.push("godotProfile must be a godot.* profile id");
  if (new Set(m.tags).size !== m.tags.length) p.push("duplicate tags");
  return p;
}

/** Parameter-manifest problems of a sample's exposed properties (empty = complete). */
export function parameterProblems(props: readonly Property[]): string[] {
  const out: string[] = [];
  for (const p of props) {
    if (!p.exposed) continue;
    const tag = `parameter "${p.displayName}" (${p.id})`;
    const isTex = p.type.startsWith("texture");
    if (!p.tooltip || p.tooltip.trim().length < 8) out.push(`${tag}: missing tooltip`);
    if (!p.category) out.push(`${tag}: missing header (category)`);
    if (isTex && !p.textureDefault) out.push(`${tag}: texture needs a default`);
    if ((p.type === "float" || p.type === "int") && p.slider && (p.min === undefined || p.max === undefined)) out.push(`${tag}: slider needs min and max`);
    if (p.type === "float" && !p.enumValues && !p.keyword && (p.min === undefined || p.max === undefined)) out.push(`${tag}: float needs a range`);
    if (typeof p.default === "number" && p.min !== undefined && p.max !== undefined && (p.default < p.min || p.default > p.max)) out.push(`${tag}: default outside its range`);
  }
  return out;
}

/** Summary rows of the exposed parameters (stored in the index; drives the details drawer). */
export function summarizeParameters(props: readonly Property[], textureNames: Readonly<Record<string, string>> = {}): SampleParamSummary[] {
  return props.filter((p) => p.exposed).map((p) => ({
    id: p.id, name: p.displayName, type: p.type, category: p.category ?? "", default: p.default,
    ...(p.min !== undefined ? { min: p.min } : {}), ...(p.max !== undefined ? { max: p.max } : {}), ...(p.hdr ? { hdr: true } : {}),
    tooltip: p.tooltip ?? "", ...(textureNames[p.id] ? { texture: textureNames[p.id] } : {}),
  }));
}

/** Translate a `SamplePreviewConfig` to the `prefs` / `sim` objects of the project's preview section. */
export function previewSectionOf(c: SamplePreviewConfig): { prefs: Record<string, unknown>; sim: Record<string, unknown> } {
  const prefs: Record<string, unknown> = { mode: c.mode, primitive: c.mesh ?? (c.mode === "2d" ? "quad" : "sphere"), grid: false, stats: false };
  const l = c.lighting;
  if (l) {
    if (l.lit) prefs.lit = l.lit;
    if (l.azimuth !== undefined) prefs.lightAzimuth = l.azimuth;
    if (l.elevation !== undefined) prefs.lightElevation = l.elevation;
    if (l.intensity !== undefined) prefs.lightIntensity = l.intensity;
    if (l.envIntensity !== undefined) prefs.envIntensity = l.envIntensity;
    if (l.shadows !== undefined) prefs.shadows = l.shadows;
  }
  if (c.camera?.fov !== undefined) prefs.fov = c.camera.fov;
  const b = c.background;
  if (b) { if (b.mode) prefs.bg = b.mode; if (b.color) prefs.bgColor = b.color; if (b.ground) prefs.ground = b.ground; }
  if (c.intersector) { prefs.intersector = c.intersector.kind; if (c.intersector.position) prefs.intersectorPos = c.intersector.position; if (c.intersector.scale !== undefined) prefs.intersectorScale = c.intersector.scale; }
  if (c.emitter) prefs.emitter = c.emitter;
  if (c.nearest !== undefined) prefs.nearest = c.nearest;
  const sim: Record<string, unknown> = {};
  if (c.simulation) {
    sim.enabled = true;
    if (c.simulation.target) { sim.target = c.simulation.target; sim.follow = false; }
    if (c.simulation.depthTexture !== undefined) sim.depthTexture = c.simulation.depthTexture;
    if (c.simulation.opaqueTexture !== undefined) sim.opaqueTexture = c.simulation.opaqueTexture;
  }
  return { prefs, sim };
}
