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
import { SCENE_TARGETS, TARGET_CONVENTIONS, TARGET_LABEL, type SceneTarget } from "@/core/engine/targets";
import { effectiveTarget, familyTarget, useSceneSim } from "../sceneSim";

const TARGET_OPTS: SelectOption<SceneTarget>[] = SCENE_TARGETS.map((t) => ({
  value: t,
  label: TARGET_LABEL[t],
  description: TARGET_CONVENTIONS[t].note,
}));
const toRgba = (hex: string): Rgba => parseColor(hex) ?? { r: 1, g: 1, b: 1, a: 1 };

/**
 * Inspector section "Scene Simulation": overrides for what the preview cannot naturally provide. Everything here is a uniform change
 * (instant, no recompile) except the simulated target, which changes compile-time constants (Target Switch, Is Reversed-Z, …).
 */
export function SceneSimulation() {
  const s = useSceneSim();
  const off = !s.enabled;
  const conv = TARGET_CONVENTIONS[effectiveTarget(s)];
  return (
    <>
      <PropertySection title="Scene Simulation">
        <PropertyRow
          label="Enabled"
          hint="Off: the preview's natural camera (perspective), no fog, white key light, GLSL conventions."
        >
          <Toggle
            density="compact"
            checked={s.enabled}
            onChange={(enabled) => s.set({ enabled })}
            aria-label="Enable scene simulation"
          />
        </PropertyRow>
        <PropertyRow
          label="Follow Target"
          hint="On: the simulated engine is the toolbar Target (default). Off: pick an explicit override below."
        >
          <Toggle
            density="compact"
            checked={s.follow}
            onChange={(follow) => s.set({ follow })}
            aria-label="Simulation follows the Target"
          />
        </PropertyRow>
        <PropertyRow
          label="Target"
          hint="Compile-time conventions used by Target Switch, Is Reversed-Z, Is Y-Flipped, Is Linear Color Space and the emulated depth convention. Recompiles the preview."
        >
          <Select<SceneTarget>
            density="compact"
            value={s.follow ? familyTarget() : s.target}
            options={TARGET_OPTS}
            disabled={s.follow}
            onChange={(target) => s.set({ target })}
            searchable={false}
            aria-label="Simulated target"
          />
        </PropertyRow>
        <PropertyRow
          label="Depth texture"
          hint="URP: Depth Texture enabled / Godot: depth_texture available. Off ⇒ Scene Depth reports a warning and returns a neutral value (like the engine without the texture). Recompiles."
        >
          <Toggle
            density="compact"
            checked={s.depthTexture}
            onChange={(depthTexture) => s.set({ depthTexture })}
            aria-label="Depth texture available"
          />
        </PropertyRow>
        <PropertyRow
          label="Opaque texture"
          hint="URP: Opaque Texture enabled / Godot: screen_texture available. Off ⇒ Scene Color reports a warning and returns a neutral value. Recompiles."
        >
          <Toggle
            density="compact"
            checked={s.opaqueTexture}
            onChange={(opaqueTexture) => s.set({ opaqueTexture })}
            aria-label="Opaque texture available"
          />
        </PropertyRow>
        <div
          className="kk-pv__note"
          data-testid="sim-target-note"
        >{`${off ? "Camera / fog / light / object overrides are off (the target still applies). " : ""}${conv.note} Reversed-Z ${conv.reversedZ ? "on" : "off"} · Y-flip ${conv.yFlipped ? "on" : "off"} · ${conv.linearColor ? "linear" : "as-is"} colours. The preview's own projection stays OpenGL: only compile-time flags and Target Switch follow the target.`}</div>
      </PropertySection>
      <PropertySection title="Camera">
        <PropertyRow
          label="Orthographic"
          hint="3D mode only: switches the viewport camera to an orthographic projection."
        >
          <Toggle
            density="compact"
            checked={s.orthographic}
            disabled={off}
            onChange={(orthographic) => s.set({ orthographic })}
            aria-label="Orthographic camera"
          />
        </PropertyRow>
        <PropertyRow label="Ortho size" hint="Half of the visible height in world units.">
          <NumberField
            density="compact"
            value={s.orthoSize}
            min={0.05}
            max={100}
            step={0.05}
            disabled={off || !s.orthographic}
            onChange={(orthoSize) => s.set({ orthoSize })}
            aria-label="Orthographic size"
          />
        </PropertyRow>
        <PropertyRow label="Override clip">
          <Toggle
            density="compact"
            checked={s.overrideClip}
            disabled={off}
            onChange={(overrideClip) => s.set({ overrideClip })}
            aria-label="Override clip planes"
          />
        </PropertyRow>
        <PropertyRow label="Near">
          <NumberField
            density="compact"
            value={s.near}
            min={0.001}
            max={1000}
            step={0.01}
            disabled={off || !s.overrideClip}
            onChange={(near) => s.set({ near })}
            aria-label="Near plane"
          />
        </PropertyRow>
        <PropertyRow label="Far">
          <NumberField
            density="compact"
            value={s.far}
            min={0.01}
            max={100000}
            step={1}
            disabled={off || !s.overrideClip}
            onChange={(far) => s.set({ far })}
            aria-label="Far plane"
          />
        </PropertyRow>
      </PropertySection>
      <PropertySection title="Light & ambient">
        <PropertyRow
          label="Light colour"
          hint="Main light colour; direction follows the viewport key light (Scene tab)."
        >
          <ColorField
            density="compact"
            alpha={false}
            value={toRgba(s.lightColor)}
            disabled={off}
            onChange={(c) => s.set({ lightColor: toHex(c) })}
            aria-label="Main light colour"
          />
        </PropertyRow>
        <PropertyRow label="Intensity">
          <Slider
            density="compact"
            value={s.lightIntensity}
            min={0}
            max={8}
            step={0.05}
            disabled={off}
            onChange={(lightIntensity) => s.set({ lightIntensity })}
            aria-label="Main light intensity"
          />
        </PropertyRow>
        <PropertyRow label="Ambient">
          <ColorField
            density="compact"
            alpha={false}
            value={toRgba(s.ambient)}
            disabled={off}
            onChange={(c) => s.set({ ambient: toHex(c) })}
            aria-label="Ambient colour"
          />
        </PropertyRow>
        <PropertyRow label="Ambient ×">
          <Slider
            density="compact"
            value={s.ambientIntensity}
            min={0}
            max={4}
            step={0.05}
            disabled={off}
            onChange={(ambientIntensity) => s.set({ ambientIntensity })}
            aria-label="Ambient intensity"
          />
        </PropertyRow>
        <div className="kk-pv__note">
          Light nodes read these values on GLSL / WGSL / HLSL (host-supplied). Ambient is flat; there are no shadow maps
          in the preview.
        </div>
      </PropertySection>
      <PropertySection title="Object">
        <PropertyRow label="Override">
          <Toggle
            density="compact"
            checked={s.overrideObject}
            disabled={off}
            onChange={(overrideObject) => s.set({ overrideObject })}
            aria-label="Override object transform"
          />
        </PropertyRow>
        <PropertyRow label="Position">
          <Vec3Field
            density="compact"
            value={[...s.objectPos]}
            step={0.05}
            disabled={off || !s.overrideObject}
            onChange={(v) => s.set({ objectPos: [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0] })}
            aria-label="Object position"
          />
        </PropertyRow>
        <PropertyRow label="Scale">
          <Vec3Field
            density="compact"
            value={[...s.objectScale]}
            step={0.05}
            min={0.001}
            disabled={off || !s.overrideObject}
            onChange={(v) => s.set({ objectScale: [v[0] ?? 1, v[1] ?? 1, v[2] ?? 1] })}
            aria-label="Object scale"
          />
        </PropertyRow>
        <PropertyRow label="">
          <Button size="sm" variant="ghost" onClick={() => s.reset()}>
            Reset simulation
          </Button>
        </PropertyRow>
      </PropertySection>
    </>
  );
}
