import {
  Box,
  Crosshair,
  FolderInput,
  Grid3x3,
  Maximize,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Sparkles,
  Image as ImageIcon,
  Activity,
  Axis3d,
  Gauge,
} from "lucide-react";
import { IconButton, SegmentedControl, Select, Slider, type SelectOption } from "@/ui";
import { SubgraphOutputSelect } from "@/ui/graph/SubgraphOutputSelect";
import { useProUi } from "@/app/pro/proState";
import { frameObject, importFromPicker, resetCamera, rewindTime, togglePlay } from "../actions";
import { type DebugView, type PreviewMode, type PrimitiveId, usePreview } from "../previewStore";

const MODES = [
  { value: "3d" as PreviewMode, icon: Box, title: "3D model / primitive", label: "3D" },
  { value: "2d" as PreviewMode, icon: ImageIcon, title: "2D sprite (orthographic)", label: "2D" },
  { value: "vfx" as PreviewMode, icon: Sparkles, title: "VFX billboard particles", label: "VFX" },
];

const PRIMS: SelectOption<string>[] = (
  ["sphere", "cube", "plane", "cylinder", "torus", "capsule", "quad"] as PrimitiveId[]
).map((p) => ({ value: p, label: p[0]!.toUpperCase() + p.slice(1) }));
const SHADING: SelectOption<DebugView>[] = [
  { value: "shader", label: "Shader" },
  { value: "uv", label: "UV checker" },
  { value: "normals", label: "Normals (mesh)" },
  { value: "baseColor", label: "Base Color" },
  { value: "normalTS", label: "Normal (tangent)" },
  { value: "normalWS", label: "Normal (world)" },
  { value: "metallic", label: "Metallic" },
  { value: "smoothness", label: "Smoothness" },
  { value: "occlusion", label: "Occlusion" },
  { value: "emission", label: "Emission" },
  { value: "alpha", label: "Alpha" },
  { value: "vertexColor", label: "Vertex Color" },
  { value: "sceneDepth", label: "Scene Depth" },
];
const SPEEDS: SelectOption<string>[] = ["0.25", "0.5", "1", "2", "4"].map((v) => ({ value: v, label: `${v}×` }));

export function PreviewToolbar({ drawer, onDrawer }: { drawer: boolean; onDrawer: () => void }) {
  const s = usePreview();
  const set = s.set;
  const hasModel = !!s.modelAssetId;
  return (
    <div className="kk-pv__bar" data-testid="preview-toolbar">
      <SegmentedControl<PreviewMode>
        value={s.mode}
        options={MODES}
        onChange={(mode) => set({ mode })}
        density="compact"
        aria-label="Preview mode"
      />
      {s.mode === "3d" && (
        <Select<string>
          className="kk-pv__sel"
          density="compact"
          value={hasModel ? "__model" : s.primitive}
          options={hasModel ? [{ value: "__model", label: "Imported model" }, ...PRIMS] : PRIMS}
          onChange={(v) => v !== "__model" && set({ primitive: v as PrimitiveId, modelAssetId: null })}
          searchable={false}
          aria-label="Mesh"
        />
      )}
      <Select<DebugView>
        className="kk-pv__sel"
        density="compact"
        value={s.debugView}
        options={SHADING}
        onChange={(debugView) => set({ debugView })}
        searchable={false}
        aria-label="Shading view"
      />
      <SubgraphOutputSelect className="kk-pv__sel" />
      <span className="kk-pv__sp" />
      <IconButton
        icon={Square}
        label="Wireframe overlay"
        size="sm"
        active={s.wireframe}
        onClick={() => set({ wireframe: !s.wireframe })}
      />
      <IconButton icon={Grid3x3} label="Grid" size="sm" active={s.grid} onClick={() => set({ grid: !s.grid })} />
      <IconButton icon={Axis3d} label="Axes" size="sm" active={s.axes} onClick={() => set({ axes: !s.axes })} />
      <IconButton
        icon={Activity}
        label="Stats overlay"
        size="sm"
        active={s.stats}
        onClick={() => set({ stats: !s.stats })}
      />
      <IconButton
        icon={Gauge}
        label="Performance: GPU benchmark, A/B compare, fp16 emulation"
        size="sm"
        onClick={() => useProUi.getState().set({ benchOpen: true })}
      />
      <IconButton icon={Maximize} label="Frame object (F)" size="sm" onClick={frameObject} />
      <IconButton icon={Crosshair} label="Reset camera" size="sm" onClick={resetCamera} />
      <IconButton
        icon={FolderInput}
        label="Import model / sprite / HDR…"
        size="sm"
        onClick={() => void importFromPicker()}
      />
      <IconButton icon={SlidersHorizontal} label="Preview settings" size="sm" active={drawer} onClick={onDrawer} />
    </div>
  );
}

export function TimeBar({ time, onScrub }: { time: number; onScrub: (t: number) => void }) {
  const playing = usePreview((s) => s.playing);
  const speed = usePreview((s) => s.speed);
  const set = usePreview((s) => s.set);
  return (
    <div className="kk-pv__time" data-testid="preview-time">
      <IconButton
        icon={playing ? Pause : Play}
        label={playing ? "Pause time" : "Play time"}
        size="sm"
        onClick={togglePlay}
      />
      <IconButton icon={RotateCcw} label="Restart time (t = 0)" size="sm" onClick={rewindTime} />
      <span className="kk-pv__clock" title="Value of the Time node">
        t = {time.toFixed(2)} s
      </span>
      <Slider
        className="kk-pv__scrub"
        density="compact"
        value={time % 60}
        min={0}
        max={60}
        step={0.01}
        showField={false}
        onChange={onScrub}
        aria-label="Scrub time"
      />
      <Select<string>
        className="kk-pv__speed"
        density="compact"
        value={String(speed)}
        options={SPEEDS}
        onChange={(v) => set({ speed: Number(v) })}
        searchable={false}
        aria-label="Time speed"
      />
    </div>
  );
}
