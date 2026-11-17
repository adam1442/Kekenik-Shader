import {
  Button,
  ColorField,
  NumberField,
  PropertyRow,
  PropertySection,
  Select,
  Slider,
  Toggle,
  Vec3Field,
  type SelectOption,
} from "@/ui";
import { type Rgba, parseColor, toHex } from "@/core/values/color";
import { useAssets } from "../assets/assetStore";
import {
  type EnvSource,
  type GroundMode,
  type IntersectorKind,
  type LitMode,
  type PreviewPrefs,
  DEFAULT_PREFS,
  usePreview,
} from "../previewStore";
import { useSceneSim } from "../sceneSim";

const GROUND: SelectOption<GroundMode>[] = [
  { value: "none", label: "None" },
  { value: "grid", label: "Grid" },
  { value: "catcher", label: "Shadow catcher" },
  { value: "matte", label: "Matte floor" },
];
const INTERSECTOR: SelectOption<IntersectorKind>[] = [
  { value: "none", label: "None" },
  { value: "sphere", label: "Sphere" },
  { value: "box", label: "Box" },
];
const ENV_SRC: SelectOption<EnvSource>[] = [
  { value: "hdri", label: "HDRI asset (else procedural room)" },
  { value: "procedural", label: "Procedural room" },
];
const LIT: SelectOption<LitMode>[] = [
  { value: "auto", label: "Auto (profile)", description: "Lit only for Lit profiles" },
  { value: "unlit", label: "Unlit (shader output)" },
  { value: "lit", label: "Lighting approximation" },
];
const FOG_OPTS: SelectOption<string>[] = [
  { value: "0", label: "Off" },
  { value: "1", label: "Linear" },
  { value: "2", label: "Exponential" },
  { value: "3", label: "Exponential²" },
];
const toRgba = (hex: string): Rgba => parseColor(hex) ?? { r: 1, g: 1, b: 1, a: 1 };

/** Section key → the prefs it owns (per-section Reset). */
const SCENE_SECTIONS = {
  environment: ["envSource", "envIntensity", "envRotation", "envBlur", "hdrAssetId"],
  lighting: [
    "lit",
    "lightAzimuth",
    "lightElevation",
    "lightIntensity",
    "fillIntensity",
    "rimIntensity",
    "lightColor",
    "fillColor",
    "rimColor",
    "shadows",
    "shadowSoftness",
    "shadowBias",
  ],
  props: ["ground", "intersector", "intersectorPos", "intersectorScale"],
  camera: ["fov"],
} as const satisfies Record<string, ReadonlyArray<keyof PreviewPrefs>>;
export type SceneSection = keyof typeof SCENE_SECTIONS;

/** Defaults of one section as a prefs patch. */
const sectionDefaults = (section: SceneSection): Partial<PreviewPrefs> =>
  Object.fromEntries(SCENE_SECTIONS[section].map((k) => [k, DEFAULT_PREFS[k]])) as Partial<PreviewPrefs>;

/**
 * Scene part of the preview settings : Environment · Lighting (+ viewport light gizmo) · Scene props · Camera · Fog.
 * Display / post settings live in `DisplaySettings`; ortho / near / far are Simulation values (single source, see Decision Log).
 */
export function SceneSettings() {
  const s = usePreview();
  const sim = useSceneSim();
  const hdrs = useAssets((a) => a.items).filter((a) => a.kind === "hdr");
  const hdrOpts: SelectOption<string>[] = [
    { value: "", label: "None" },
    ...hdrs.map((h) => ({ value: h.id, label: h.name })),
  ];
  const reset = (section: SceneSection) => (
    <Button size="sm" variant="ghost" onClick={() => s.set(sectionDefaults(section))}>
      Reset
    </Button>
  );
  const num = (
    label: string,
    key:
      | "envIntensity"
      | "envRotation"
      | "envBlur"
      | "lightIntensity"
      | "fillIntensity"
      | "rimIntensity"
      | "shadowSoftness"
      | "shadowBias"
      | "intersectorScale"
      | "fov",
    min: number,
    max: number,
    step: number,
    unit?: string,
  ) => (
    <PropertyRow label={label}>
      <Slider
        density="compact"
        value={s[key]}
        min={min}
        max={max}
        step={step}
        {...(unit ? { unit } : {})}
        onChange={(v) => s.set({ [key]: v } as Partial<PreviewPrefs>)}
        aria-label={label}
      />
    </PropertyRow>
  );
  const col = (label: string, key: "lightColor" | "fillColor" | "rimColor") => (
    <PropertyRow label={label}>
      <ColorField
        density="compact"
        alpha={false}
        value={toRgba(s[key])}
        onChange={(c) => s.set({ [key]: toHex(c) } as Partial<PreviewPrefs>)}
        aria-label={label}
      />
    </PropertyRow>
  );
  return (
    <>
      <PropertySection title="Environment" actions={reset("environment")}>
        <PropertyRow label="Source">
          <Select<EnvSource>
            density="compact"
            value={s.envSource}
            options={ENV_SRC}
            onChange={(envSource) => s.set({ envSource })}
            searchable={false}
            aria-label="Environment source"
          />
        </PropertyRow>
        <PropertyRow label="HDRI">
          <Select<string>
            density="compact"
            value={s.hdrAssetId ?? ""}
            options={hdrOpts}
            disabled={s.envSource !== "hdri"}
            onChange={(v) => s.set({ hdrAssetId: v || null })}
            searchable={false}
            aria-label="HDRI asset"
          />
        </PropertyRow>
        {num("Intensity", "envIntensity", 0, 4, 0.05)}
        {num("Rotation", "envRotation", 0, 1, 0.005)}
        {num("Background blur", "envBlur", 0, 1, 0.01)}
      </PropertySection>
      <PropertySection title="Lighting" actions={reset("lighting")}>
        <PropertyRow label="Shading">
          <Select<LitMode>
            density="compact"
            value={s.lit}
            options={LIT}
            onChange={(lit) => s.set({ lit })}
            searchable={false}
            aria-label="Lighting mode"
          />
        </PropertyRow>
        <PropertyRow label="Key azimuth">
          <Slider
            density="compact"
            value={s.lightAzimuth}
            min={-180}
            max={180}
            step={1}
            unit="°"
            onChange={(lightAzimuth) => s.set({ lightAzimuth })}
            aria-label="Light azimuth"
          />
        </PropertyRow>
        <PropertyRow label="Key elevation">
          <Slider
            density="compact"
            value={s.lightElevation}
            min={-10}
            max={89}
            step={1}
            unit="°"
            onChange={(lightElevation) => s.set({ lightElevation })}
            aria-label="Light elevation"
          />
        </PropertyRow>
        {num("Key intensity", "lightIntensity", 0, 4, 0.05)}
        {col("Key colour", "lightColor")}
        {num("Fill intensity", "fillIntensity", 0, 4, 0.05)}
        {col("Fill colour", "fillColor")}
        {num("Rim intensity", "rimIntensity", 0, 4, 0.05)}
        {col("Rim colour", "rimColor")}
        <PropertyRow label="Shadows">
          <Toggle
            density="compact"
            checked={s.shadows}
            onChange={(shadows) => s.set({ shadows })}
            aria-label="Shadows"
          />
        </PropertyRow>
        {num("Softness", "shadowSoftness", 0.5, 4, 0.05)}
        {num("Bias", "shadowBias", 0, 0.02, 0.0005)}
        <div className="kk-pv__note">
          Drag the light gizmo (top-right of the viewport) to aim the key light. Preview lighting approximates the
          target engine (Unity-like: Lambert + GGX; Godot-like: Burley + Schlick-GGX). Metallic / smoothness / emission
          / normal / occlusion come from the master output.
        </div>
      </PropertySection>
      <PropertySection title="Scene props" actions={reset("props")}>
        <PropertyRow label="Ground">
          <Select<GroundMode>
            density="compact"
            value={s.ground}
            options={GROUND}
            onChange={(ground) => s.set({ ground })}
            searchable={false}
            aria-label="Ground"
          />
        </PropertyRow>
        <PropertyRow
          label="Intersector"
          hint="A prop for Scene Depth / depth-fade / soft-particle effects to intersect with."
        >
          <Select<IntersectorKind>
            density="compact"
            value={s.intersector}
            options={INTERSECTOR}
            onChange={(intersector) => s.set({ intersector })}
            searchable={false}
            aria-label="Intersector"
          />
        </PropertyRow>
        <PropertyRow label="Position">
          <Vec3Field
            density="compact"
            value={s.intersectorPos}
            disabled={s.intersector === "none"}
            onChange={(v) => s.set({ intersectorPos: [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] })}
            aria-label="Intersector position"
          />
        </PropertyRow>
        {num("Scale", "intersectorScale", 0.05, 4, 0.05)}
      </PropertySection>
      <PropertySection title="Camera" actions={reset("camera")}>
        {num("Field of view", "fov", 10, 120, 1, "°")}
        <div className="kk-pv__note">
          Orthographic projection, size and near / far planes are Simulation values (Simulation tab) because Camera /
          Linear Eye Depth nodes read them.
        </div>
      </PropertySection>
      <PropertySection
        title="Fog"
        actions={
          <Button size="sm" variant="ghost" onClick={() => sim.set({ fogMode: 0 })}>
            Off
          </Button>
        }
      >
        <PropertyRow label="Mode">
          <Select<string>
            density="compact"
            value={String(sim.fogMode)}
            options={FOG_OPTS}
            onChange={(v) => sim.set({ fogMode: Number(v) as 0 | 1 | 2 | 3 })}
            searchable={false}
            aria-label="Fog mode"
          />
        </PropertyRow>
        <PropertyRow label="Colour">
          <ColorField
            density="compact"
            alpha={false}
            value={toRgba(sim.fogColor)}
            disabled={sim.fogMode === 0}
            onChange={(c) => sim.set({ fogColor: toHex(c) })}
            aria-label="Fog colour"
          />
        </PropertyRow>
        <PropertyRow label="Density">
          <Slider
            density="compact"
            value={sim.fogDensity}
            min={0}
            max={2}
            step={0.01}
            disabled={sim.fogMode < 2}
            onChange={(fogDensity) => sim.set({ fogDensity })}
            aria-label="Fog density"
          />
        </PropertyRow>
        <PropertyRow label="Start">
          <NumberField
            density="compact"
            value={sim.fogStart}
            min={0}
            max={10000}
            step={0.5}
            disabled={sim.fogMode !== 1}
            onChange={(fogStart) => sim.set({ fogStart })}
            aria-label="Fog start"
          />
        </PropertyRow>
        <PropertyRow label="End">
          <NumberField
            density="compact"
            value={sim.fogEnd}
            min={0}
            max={10000}
            step={0.5}
            disabled={sim.fogMode !== 1}
            onChange={(fogEnd) => sim.set({ fogEnd })}
            aria-label="Fog end"
          />
        </PropertyRow>
        <div className="kk-pv__note">
          The same values feed the Fog nodes and tint lit / unlit surfaces by camera distance.
        </div>
      </PropertySection>
    </>
  );
}
