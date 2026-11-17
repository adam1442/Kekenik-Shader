/** Display / post-processing settings of the preview viewport . Pure data + presets; no three.js. */
export type ToneMap = "none" | "reinhard" | "aces" | "agx" | "neutral";
export const TONE_MAPS: ReadonlyArray<{ id: ToneMap; label: string }> = [
  { id: "none", label: "None (clamp)" },
  { id: "reinhard", label: "Reinhard" },
  { id: "aces", label: "ACES" },
  { id: "agx", label: "AgX" },
  { id: "neutral", label: "Khronos Neutral" },
];

export interface PostSettings {
  /** Exposure compensation in EV stops (linear × 2^EV, applied BEFORE tone mapping). */
  exposure: number;
  tonemap: ToneMap;
  bloom: boolean;
  bloomThreshold: number;
  bloomKnee: number;
  bloomIntensity: number;
  /** URP "Scatter": 0 = tight, 1 = very wide. */
  bloomScatter: number;
  bloomTint: string;
  /** Maximum luminance fed into the bloom (fireflies guard). */
  bloomClamp: number;
  /** Down / up-sample levels (quality). */
  bloomIterations: number;
  contrast: number;
  saturation: number;
  vignette: number;
  /** MSAA samples of the HDR target (0 = off). */
  msaa: 0 | 2 | 4 | 8;
  fxaa: boolean;
  /** Internal render resolution scale (0.25 … 2). */
  renderScale: number;
}

export const DEFAULT_POST: PostSettings = {
  exposure: 0,
  tonemap: "none",
  bloom: true,
  bloomThreshold: 1,
  bloomKnee: 0.5,
  bloomIntensity: 0.6,
  bloomScatter: 0.7,
  bloomTint: "#ffffff",
  bloomClamp: 64,
  bloomIterations: 5,
  contrast: 1,
  saturation: 1,
  vignette: 0,
  msaa: 4,
  fxaa: false,
  renderScale: 1,
};

/** Neutral pipeline (bloom off): the deterministic baseline for pixel-exact tests; NOT the app default. */
export const POST_OFF: PostSettings = { ...DEFAULT_POST, bloom: false };

/**
 * One-time migration: Bloom became ON by default (fix pass 2). Settings saved while the default was OFF carry an explicit `bloom: false`
 * that the user never chose — switch it on ONCE (afterwards the user's choice, on or off, is kept).
 */
export function migrateBloomDefault(
  saved: Partial<PostSettings> | undefined,
  alreadyApplied: boolean,
): Partial<PostSettings> | undefined {
  if (alreadyApplied || !saved || saved.bloom !== false) return saved;
  return { ...saved, bloom: true };
}

export interface PostPreset {
  id: string;
  label: string;
  note: string;
  post: Partial<PostSettings>;
}
export const POST_PRESETS: readonly PostPreset[] = [
  {
    id: "unity",
    label: "Unity-like",
    note: "URP default volume: no tone mapping, bloom off, MSAA 4×.",
    post: { ...DEFAULT_POST, tonemap: "none", bloom: false },
  },
  {
    id: "godot",
    label: "Godot-like",
    note: "Godot 4 default environment: ACES-style filmic curve, glow on above HDR 1.0.",
    post: { ...DEFAULT_POST, tonemap: "aces", bloom: true, bloomThreshold: 1, bloomIntensity: 0.8, bloomScatter: 0.7 },
  },
  {
    id: "studio",
    label: "Neutral studio",
    note: "Khronos Neutral tone mapping, subtle bloom.",
    post: { ...DEFAULT_POST, tonemap: "neutral", bloom: true, bloomThreshold: 1.2, bloomIntensity: 0.35 },
  },
  {
    id: "mobile",
    label: "Mobile game",
    note: "No tone mapping, no bloom, no MSAA + FXAA, render scale 0.75.",
    post: { ...DEFAULT_POST, tonemap: "none", bloom: false, msaa: 0, fxaa: true, renderScale: 0.75 },
  },
];

/** Settings groups for per-section Reset. */
const POST_SECTIONS = {
  exposure: ["exposure", "tonemap"],
  bloom: [
    "bloom",
    "bloomThreshold",
    "bloomKnee",
    "bloomIntensity",
    "bloomScatter",
    "bloomTint",
    "bloomClamp",
    "bloomIterations",
  ],
  color: ["contrast", "saturation", "vignette"],
  quality: ["msaa", "fxaa", "renderScale"],
} as const satisfies Record<string, ReadonlyArray<keyof PostSettings>>;
export type PostSection = keyof typeof POST_SECTIONS;

export const resetPostSection = (cur: PostSettings, section: PostSection): PostSettings => {
  const next = { ...cur } as Record<string, unknown>;
  for (const k of POST_SECTIONS[section]) next[k] = DEFAULT_POST[k];
  return next as unknown as PostSettings;
};

/** Merge saved (possibly partial / older) settings over the defaults, dropping unknown keys and clamping ranges. */
export function normalizePost(saved: Partial<PostSettings> | undefined): PostSettings {
  const p = { ...DEFAULT_POST, ...(saved ?? {}) } as PostSettings;
  const n = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
  return {
    ...p,
    exposure: n(p.exposure, -8, 8),
    bloomThreshold: n(p.bloomThreshold, 0, 32),
    bloomKnee: n(p.bloomKnee, 0, 1),
    bloomIntensity: n(p.bloomIntensity, 0, 8),
    bloomScatter: n(p.bloomScatter, 0, 1),
    bloomClamp: n(p.bloomClamp, 1, 4096),
    bloomIterations: Math.round(n(p.bloomIterations, 1, 8)),
    contrast: n(p.contrast, 0, 3),
    saturation: n(p.saturation, 0, 3),
    vignette: n(p.vignette, 0, 1),
    msaa: ([0, 2, 4, 8] as const).includes(p.msaa) ? p.msaa : 4,
    renderScale: n(p.renderScale, 0.25, 2),
    tonemap: TONE_MAPS.some((t) => t.id === p.tonemap) ? p.tonemap : "none",
  };
}

/** Linear multiplier of an EV offset — what the composite pass applies before tone mapping. */
export const evToScale = (ev: number): number => Math.pow(2, ev);
