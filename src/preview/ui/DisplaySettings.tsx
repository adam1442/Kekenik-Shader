import { Button, ColorField, PropertyRow, PropertySection, Select, Slider, Toggle, type SelectOption } from "@/ui";
import { type Rgba, parseColor, toHex } from "@/core/values/color";
import {
  DEFAULT_POST,
  POST_PRESETS,
  type PostSection,
  type PostSettings,
  type ToneMap,
  TONE_MAPS,
  normalizePost,
  resetPostSection,
} from "../gl/post/settings";
import { usePreview } from "../previewStore";

const TONE: SelectOption<ToneMap>[] = TONE_MAPS.map((t) => ({ value: t.id, label: t.label }));
const MSAA: SelectOption<string>[] = [
  { value: "0", label: "Off" },
  { value: "2", label: "2×" },
  { value: "4", label: "4×" },
  { value: "8", label: "8×" },
];
const PRESETS: SelectOption<string>[] = POST_PRESETS.map((p) => ({ value: p.id, label: p.label, description: p.note }));
const toRgba = (hex: string): Rgba => parseColor(hex) ?? { r: 1, g: 1, b: 1, a: 1 };

/**
 * Display + post-processing settings of the viewport : exposure / tone mapping, bloom, colour adjustments + vignette,
 * quality (MSAA, FXAA, render scale). Each section has its own Reset; a preset menu applies a whole look. Pure `@/ui` controls.
 * Not offered yet (listed in roadmap): SSAO / GTAO, shadows, environment blur, HDRI background, light gizmo.
 */
export function DisplaySettings() {
  const s = usePreview();
  const p = s.post;
  const set = (patch: Partial<PostSettings>) => s.set({ post: normalizePost({ ...p, ...patch }) });
  const reset = (section: PostSection) => s.set({ post: resetPostSection(p, section) });
  const num = (label: string, key: keyof PostSettings, min: number, max: number, step: number, unit?: string) => (
    <PropertyRow label={label}>
      <Slider
        density="compact"
        value={p[key] as number}
        min={min}
        max={max}
        step={step}
        {...(unit ? { unit } : {})}
        onChange={(v) => set({ [key]: v } as Partial<PostSettings>)}
        aria-label={label}
      />
    </PropertyRow>
  );
  const resetRow = (section: PostSection) => (
    <PropertyRow label="">
      <Button size="sm" variant="ghost" onClick={() => reset(section)}>
        Reset section
      </Button>
    </PropertyRow>
  );
  return (
    <>
      <PropertySection title="Look presets">
        <PropertyRow label="Preset">
          <Select<string>
            density="compact"
            value=""
            placeholder="Apply a look…"
            options={PRESETS}
            onChange={(id) => {
              const pr = POST_PRESETS.find((x) => x.id === id);
              if (pr) s.set({ post: normalizePost(pr.post) });
            }}
            searchable={false}
            aria-label="Display preset"
          />
        </PropertyRow>
        <PropertyRow label="">
          <Button size="sm" variant="ghost" onClick={() => s.set({ post: DEFAULT_POST })}>
            Reset all display settings
          </Button>
        </PropertyRow>
      </PropertySection>
      <PropertySection title="Exposure & tone mapping">
        {num("Exposure (EV)", "exposure", -6, 6, 0.05)}
        <PropertyRow label="Tone mapping">
          <Select<ToneMap>
            density="compact"
            value={p.tonemap}
            options={TONE}
            onChange={(tonemap) => set({ tonemap })}
            searchable={false}
            aria-label="Tone mapping"
          />
        </PropertyRow>
        {resetRow("exposure")}
      </PropertySection>
      <PropertySection title="Bloom">
        <PropertyRow label="Enabled">
          <Toggle density="compact" checked={p.bloom} onChange={(bloom) => set({ bloom })} aria-label="Bloom" />
        </PropertyRow>
        {num("Threshold", "bloomThreshold", 0, 8, 0.05)}
        {num("Soft knee", "bloomKnee", 0, 1, 0.01)}
        {num("Intensity", "bloomIntensity", 0, 4, 0.01)}
        {num("Scatter", "bloomScatter", 0, 1, 0.01)}
        <PropertyRow label="Tint">
          <ColorField
            density="compact"
            alpha={false}
            value={toRgba(p.bloomTint)}
            onChange={(c) => set({ bloomTint: toHex(c) })}
            aria-label="Bloom tint"
          />
        </PropertyRow>
        {num("Clamp", "bloomClamp", 1, 256, 1)}
        {num("Quality (levels)", "bloomIterations", 1, 8, 1)}
        <div className="kk-pv__note">
          URP-style: soft-knee prefilter at half resolution, down-sample chain, up-sample chain mixed by Scatter. Godot
          glow ≈ Threshold = HDR threshold, Intensity = glow intensity, Scatter = bloom.
        </div>
        {resetRow("bloom")}
      </PropertySection>
      <PropertySection title="Colour adjustments">
        {num("Contrast", "contrast", 0, 2, 0.01)}
        {num("Saturation", "saturation", 0, 2, 0.01)}
        {num("Vignette", "vignette", 0, 1, 0.01)}
        {resetRow("color")}
      </PropertySection>
      <PropertySection title="Quality">
        <PropertyRow label="MSAA">
          <Select<string>
            density="compact"
            value={String(p.msaa)}
            options={MSAA}
            onChange={(v) => set({ msaa: Number(v) as PostSettings["msaa"] })}
            searchable={false}
            aria-label="MSAA samples"
          />
        </PropertyRow>
        <PropertyRow label="FXAA">
          <Toggle density="compact" checked={p.fxaa} onChange={(fxaa) => set({ fxaa })} aria-label="FXAA" />
        </PropertyRow>
        {num("Render scale", "renderScale", 0.25, 2, 0.05)}
        {resetRow("quality")}
      </PropertySection>
    </>
  );
}
