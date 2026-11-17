import { useState } from "react";
import {
  ColorField,
  IntField,
  NumberField,
  PropertyGrid,
  PropertyRow,
  PropertySection,
  Select,
  Slider,
  Tabs,
  Toggle,
  Button,
  type SelectOption,
} from "@/ui";
import { type Rgba, parseColor, toHex } from "@/core/values/color";
import { useShader } from "@/app/shaderStore";
import { useAssets } from "../assets/assetStore";
import { importFromPicker } from "../actions";
import { getController } from "../controller";
import { DEFAULT_EMITTER, type EmitterSettings } from "../logic/emitter";
import { type SheetLoop } from "../logic/spriteSheet";
import { MaterialSettings } from "./MaterialSettings";
import { MaterialPresets } from "./MaterialPresets";
import { SceneSimulation } from "./SceneSimulation";
import { PropertyTextureSlot } from "./PropertyTextureSlot";
import { type BgMode, usePreview } from "../previewStore";
import { DisplaySettings } from "./DisplaySettings";
import { SceneSettings } from "./SceneSettings";

const BG: SelectOption<BgMode>[] = [
  { value: "gradient", label: "Gradient" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "checker", label: "Checker" },
  { value: "solid", label: "Solid colour" },
  { value: "environment", label: "Environment" },
];
const LOOPS: SelectOption<SheetLoop>[] = [
  { value: "loop", label: "Loop" },
  { value: "pingpong", label: "Ping-pong" },
  { value: "once", label: "Once" },
];

const toRgba = (hex: string): Rgba => parseColor(hex) ?? { r: 0.1, g: 0.1, b: 0.12, a: 1 };

function Scene() {
  const s = usePreview();
  return (
    <>
      <PropertySection title="Viewport">
        <PropertyRow label="Background">
          <Select<BgMode>
            density="compact"
            value={s.bg}
            options={BG}
            onChange={(bg) => s.set({ bg })}
            searchable={false}
            aria-label="Background"
          />
        </PropertyRow>
        {s.bg === "solid" && (
          <PropertyRow label="Colour">
            <ColorField
              density="compact"
              alpha={false}
              value={toRgba(s.bgColor)}
              onChange={(c) => s.set({ bgColor: toHex(c) })}
              aria-label="Background colour"
            />
          </PropertyRow>
        )}
        <PropertyRow label="Auto-rotate">
          <Toggle
            density="compact"
            checked={s.autoRotate}
            onChange={(autoRotate) => s.set({ autoRotate })}
            aria-label="Auto-rotate"
          />
        </PropertyRow>
      </PropertySection>
      <SceneSettings />

      <DisplaySettings />
    </>
  );
}

function Sprite() {
  const s = usePreview();
  const tex = useAssets((a) => a.items).filter((a) => a.kind === "texture");
  const opts: SelectOption<string>[] = [
    { value: "", label: "Placeholder (256×256)" },
    ...tex.map((t) => ({ value: t.id, label: t.name })),
  ];
  const sh = s.sheet;
  const setSheet = (patch: Partial<typeof sh>) => s.set({ sheet: { ...sh, ...patch } });
  const zoom = (k: number) => {
    const e = getController()?.engine;
    if (e) e.rig.setPixelScale(k, e.content.texelsPerUnit);
  };
  return (
    <PropertySection title="Sprite (2D mode)">
      <PropertyRow label="Sprite">
        <Select<string>
          density="compact"
          value={s.spriteAssetId ?? ""}
          options={opts}
          onChange={(v) => s.set({ spriteAssetId: v || null })}
          searchable={false}
          aria-label="Sprite asset"
        />
      </PropertyRow>
      <PropertyRow label="Columns">
        <IntField
          density="compact"
          value={sh.cols}
          min={1}
          max={64}
          onChange={(cols) => setSheet({ cols })}
          aria-label="Sheet columns"
        />
      </PropertyRow>
      <PropertyRow label="Rows">
        <IntField
          density="compact"
          value={sh.rows}
          min={1}
          max={64}
          onChange={(rows) => setSheet({ rows })}
          aria-label="Sheet rows"
        />
      </PropertyRow>
      <PropertyRow label="Frames (0 = all)">
        <IntField
          density="compact"
          value={sh.frameCount ?? 0}
          min={0}
          max={4096}
          onChange={(frameCount) => setSheet({ frameCount })}
          aria-label="Frame count"
        />
      </PropertyRow>
      <PropertyRow label="FPS">
        <NumberField
          density="compact"
          value={sh.fps}
          min={0}
          max={120}
          step={1}
          onChange={(fps) => setSheet({ fps })}
          aria-label="Frames per second"
        />
      </PropertyRow>
      <PropertyRow label="Playback">
        <Select<SheetLoop>
          density="compact"
          value={sh.loop}
          options={LOOPS}
          onChange={(loop) => setSheet({ loop })}
          searchable={false}
          aria-label="Loop mode"
        />
      </PropertyRow>
      <PropertyRow label="Nearest filter">
        <Toggle
          density="compact"
          checked={s.nearest}
          onChange={(nearest) => s.set({ nearest })}
          aria-label="Nearest filter"
        />
      </PropertyRow>
      <PropertyRow label="Zoom">
        <div className="kk-pv__btns">
          {[1, 2, 4, 8].map((k) => (
            <Button key={k} size="sm" variant="ghost" onClick={() => zoom(k)}>
              {k}×
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => getController()?.engine.frameContent()}>
            Fit
          </Button>
        </div>
      </PropertyRow>
      <div className="kk-pv__note">
        UV0 = sheet UV of the current frame · UV1 = 0..1 inside the frame · UV2 = (frame, frames) · UV3 = frame size. A
        texture property named _MainTex receives the sprite.
      </div>
    </PropertySection>
  );
}

function Vfx() {
  const s = usePreview();
  const e = s.emitter;
  const set = (patch: Partial<EmitterSettings>) => s.set({ emitter: { ...e, ...patch } });
  const stops = e.colorOverLife;
  const color = (i: number): Rgba => ({
    r: stops[i]!.rgba[0],
    g: stops[i]!.rgba[1],
    b: stops[i]!.rgba[2],
    a: stops[i]!.rgba[3],
  });
  const setColor = (i: number, c: Rgba) =>
    set({
      colorOverLife: stops.map((st, k) =>
        k === i ? { ...st, rgba: [c.r, c.g, c.b, c.a] as [number, number, number, number] } : st,
      ),
    });
  const n = (label: string, key: keyof EmitterSettings, min: number, max: number, step: number) => (
    <PropertyRow label={label}>
      <Slider
        density="compact"
        value={e[key] as number}
        min={min}
        max={max}
        step={step}
        onChange={(v) => set({ [key]: v } as Partial<EmitterSettings>)}
        aria-label={label}
      />
    </PropertyRow>
  );
  return (
    <PropertySection title="Emitter (VFX mode)">
      {n("Rate /s", "rate", 1, 400, 1)}
      {n("Lifetime", "lifetime", 0.1, 8, 0.05)}
      {n("Life variance", "lifetimeVar", 0, 1, 0.01)}
      {n("Size start", "sizeStart", 0.01, 1.5, 0.01)}
      {n("Size end", "sizeEnd", 0, 1.5, 0.01)}
      {n("Speed", "speed", 0, 6, 0.05)}
      {n("Spread °", "spread", 0, 180, 1)}
      <PropertyRow label="Gravity Y">
        <Slider
          density="compact"
          value={e.gravity[1]}
          min={-4}
          max={4}
          step={0.05}
          onChange={(y) => set({ gravity: [e.gravity[0], y, e.gravity[2]] })}
          aria-label="Gravity Y"
        />
      </PropertyRow>
      <PropertyRow label="Max particles">
        <IntField
          density="compact"
          value={e.maxParticles}
          min={10}
          max={4000}
          onChange={(maxParticles) => set({ maxParticles })}
          aria-label="Max particles"
        />
      </PropertyRow>
      <PropertyRow label="Seed">
        <IntField
          density="compact"
          value={e.seed}
          min={0}
          max={999999}
          onChange={(seed) => set({ seed })}
          aria-label="Seed"
        />
      </PropertyRow>
      <PropertyRow label="Colour: birth">
        <ColorField density="compact" value={color(0)} onChange={(c) => setColor(0, c)} aria-label="Birth colour" />
      </PropertyRow>
      <PropertyRow label="Colour: mid">
        <ColorField density="compact" value={color(1)} onChange={(c) => setColor(1, c)} aria-label="Mid colour" />
      </PropertyRow>
      <PropertyRow label="Colour: death">
        <ColorField density="compact" value={color(2)} onChange={(c) => setColor(2, c)} aria-label="Death colour" />
      </PropertyRow>
      <PropertyRow label="">
        <Button size="sm" variant="ghost" onClick={() => s.set({ emitter: DEFAULT_EMITTER })}>
          Reset emitter
        </Button>
      </PropertyRow>
      <div className="kk-pv__note">
        Particles feed vertex colour (a_color), UV0 (quad) and UV1 = (life 0..1, size). Blend mode and Soft Particles
        come from the graph settings (Material tab); with Soft Particles on, a floor is shown so you can see the fade.
      </div>
    </PropertySection>
  );
}

function Model() {
  const s = usePreview();
  const info = s.modelInfo;
  const models = useAssets((a) => a.items).filter((a) => a.kind === "model");
  const opts: SelectOption<string>[] = [
    { value: "", label: "None (primitive)" },
    ...models.map((m) => ({ value: m.id, label: m.name })),
  ];
  const slots: SelectOption<string>[] = [
    { value: "-1", label: "All material slots" },
    ...(info?.materials ?? []).map((m, i) => ({ value: String(i), label: `${i + 1}. ${m}` })),
  ];
  return (
    <PropertySection title="Model">
      <PropertyRow label="Model">
        <Select<string>
          density="compact"
          value={s.modelAssetId ?? ""}
          options={opts}
          onChange={(v) => s.set({ modelAssetId: v || null })}
          searchable={false}
          aria-label="Model asset"
        />
      </PropertyRow>
      <PropertyRow label="Shader slot">
        <Select<string>
          density="compact"
          disabled={!info}
          value={String(s.materialSlot)}
          options={slots}
          onChange={(v) => s.set({ materialSlot: Number(v) })}
          searchable={false}
          aria-label="Material slot"
        />
      </PropertyRow>
      {info && (
        <div className="kk-pv__note">
          {info.name} · {info.meshes} mesh(es) · {info.triangles.toLocaleString()} triangles · {info.materials.length}{" "}
          material slot(s). The shader replaces the chosen slot; other slots keep their original material.
        </div>
      )}
      {s.loadError && <div className="kk-pv__note is-error">{s.loadError}</div>}
      <PropertyRow label="">
        <Button size="sm" variant="ghost" onClick={() => void importFromPicker()}>
          Import…
        </Button>
      </PropertyRow>
    </PropertySection>
  );
}

function Inputs() {
  const graph = useShader((s) => s.graph);
  const props = (graph?.properties ?? []).filter((p) => p.type === "texture2D");
  if (!props.length)
    return (
      <div className="kk-pv__note">
        The graph has no Texture 2D properties. Add one in the Blackboard and drop an image here to feed it.
      </div>
    );
  return (
    <PropertySection title="Texture inputs">
      {props.map((p) => (
        <PropertyRow key={p.id} label={p.displayName}>
          <PropertyTextureSlot p={p} />
        </PropertyRow>
      ))}
    </PropertySection>
  );
}

const TABS = [
  { id: "scene", label: "Scene" },
  { id: "model", label: "Model" },
  { id: "sprite", label: "Sprite" },
  { id: "vfx", label: "VFX" },
  { id: "material", label: "Material" },
  { id: "sim", label: "Simulation" },
  { id: "inputs", label: "Inputs" },
];

export function PreviewDrawer() {
  const [tab, setTab] = useState("scene");
  return (
    <div className="kk-pv__drawer" data-testid="preview-drawer">
      <Tabs items={TABS} value={tab} onChange={setTab} />
      <div className="kk-pv__drawer-body">
        <PropertyGrid density="compact" labelWidth={104}>
          {tab === "scene" && <Scene />}
          {tab === "model" && <Model />}
          {tab === "sprite" && <Sprite />}
          {tab === "vfx" && <Vfx />}
          {tab === "material" && (
            <>
              <MaterialSettings />
              <MaterialPresets />
            </>
          )}
          {tab === "sim" && <SceneSimulation />}
          {tab === "inputs" && <Inputs />}
        </PropertyGrid>
      </div>
    </div>
  );
}
