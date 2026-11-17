import { Box, FolderOpen } from "lucide-react";
import { Copy, Crosshair, FolderInput, Maximize, Pencil, Play, Square, Trash2, Wand2 } from "lucide-react";
import * as THREE from "three";
import { SEP, type MenuItem } from "@/ui";
import { registerPanelExtras } from "@/app/contextmenu/panelExtras";
import { registerContextMenu } from "@/app/contextmenu/registry";
import { getPanelDef, registerPanel } from "@/app/dock/panelRegistry";
import { copyText } from "@/ui/controls/clipboard";
import {
  cameraPreset,
  frameObject,
  importFromPicker,
  removeAsset,
  resetCamera,
  setPrimitive,
  togglePlay,
  toggleWireframe,
  useAsset as applyPreviewAsset,
} from "./actions";
import { getAssetMeta, useAssets } from "./assets/assetStore";
import { getController } from "./controller";
import { type CameraPresetId, type PrimitiveId, usePreview } from "./previewStore";
import { startThumbnails } from "./thumbs/thumbManager";
import { AssetsPanel, useAssetUi } from "./ui/AssetsPanel";
import { PreviewPanel } from "./ui/PreviewPanel";

const PRIMS: PrimitiveId[] = ["sphere", "cube", "plane", "cylinder", "torus", "capsule", "quad"];
const PRESETS: CameraPresetId[] = ["front", "back", "left", "right", "top", "bottom", "iso"];
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Items that act on the mesh under the cursor / the displayed content. */
function meshMenuItems(): MenuItem[] {
  const s = usePreview.getState();
  return [
    {
      label: "Change Mesh",
      icon: Box,
      submenu: PRIMS.map((p) => ({
        label: cap(p),
        type: "radio" as const,
        checked: !s.modelAssetId && s.primitive === p,
        run: () => setPrimitive(p),
      })),
    },
    { label: "Wireframe Overlay", icon: Square, type: "checkbox", checked: s.wireframe, run: toggleWireframe },
    {
      label: "Shading View",
      submenu: (["shader", "uv", "normals"] as const).map((v) => ({
        label: v === "shader" ? "Shader" : v === "uv" ? "UV checker" : "Normals",
        type: "radio" as const,
        checked: s.debugView === v,
        run: () => s.set({ debugView: v }),
      })),
    },
    ...(s.modelInfo && s.mode === "3d"
      ? [
          {
            label: "Shader Material Slot",
            submenu: [
              {
                label: "All slots",
                type: "radio" as const,
                checked: s.materialSlot === -1,
                run: () => s.set({ materialSlot: -1 }),
              },
              ...s.modelInfo.materials.map((m, i) => ({
                label: `${i + 1}. ${m}`,
                type: "radio" as const,
                checked: s.materialSlot === i,
                run: () => s.set({ materialSlot: i }),
              })),
            ],
          },
        ]
      : []),
  ];
}

function viewportMenuItems(): MenuItem[] {
  const s = usePreview.getState();
  return [
    { label: "Reset Camera", icon: Crosshair, run: resetCamera },
    { label: "Frame Object", icon: Maximize, shortcut: "F", run: frameObject },
    {
      label: "Camera Preset",
      submenu: PRESETS.map((p) => ({ label: cap(p), run: () => cameraPreset(p) })),
      disabled: s.mode === "2d",
      disabledReason: "3D cameras only",
    },
    SEP,
    { label: "Grid", type: "checkbox", checked: s.grid, run: () => s.set({ grid: !s.grid }), keepOpen: true },
    { label: "Axes", type: "checkbox", checked: s.axes, run: () => s.set({ axes: !s.axes }), keepOpen: true },
    { label: "Stats", type: "checkbox", checked: s.stats, run: () => s.set({ stats: !s.stats }), keepOpen: true },
    { label: s.playing ? "Pause Time" : "Play Time", icon: Play, run: togglePlay },
    SEP,
    { label: "Import Model / Sprite / HDR…", icon: FolderInput, run: () => void importFromPicker() },
  ];
}

/** Is there a mesh under the context-menu cursor? (raycast through the engine's camera) */
function meshUnder(e: MouseEvent): boolean {
  const eng = getController()?.engine;
  if (!eng) return false;
  const r = eng.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, eng.rig.camera);
  eng.content.root.updateMatrixWorld(true);
  return ray.intersectObjects(eng.content.meshes, false).length > 0;
}

const assetItems = (id: string | null): MenuItem[] => {
  const a = getAssetMeta(id);
  if (!a) return [];
  return [
    {
      label: a.kind === "model" ? "Show in Preview" : a.kind === "hdr" ? "Use as Environment" : "Use in Preview",
      icon: Wand2,
      run: () => applyPreviewAsset(a.id),
    },
    ...(a.kind === "texture"
      ? [
          {
            label: "Use as Sprite (2D)",
            run: () => usePreview.getState().set({ spriteAssetId: a.id, mode: "2d" as const }),
          },
        ]
      : []),
    { label: "Rename…", icon: Pencil, shortcut: "F2", run: () => useAssetUi.getState().setRenaming(a.id) },
    { label: "Copy Asset Id", icon: Copy, run: () => void copyText(a.id) },
    SEP,
    { label: "Delete", icon: Trash2, danger: true, run: () => void removeAsset(a.id) },
  ];
};

/** Register the Preview + Assets panels, their context menus and body extras (idempotent per id). */
export function registerPreviewFeatures(): void {
  const prevP = getPanelDef("preview");
  registerPanel({
    id: "preview",
    title: "Preview",
    icon: Box,
    component: PreviewPanel,
    defaultPlacement: prevP?.defaultPlacement ?? { ref: "graph", direction: "right", width: 420 },
    closable: true,
  });
  const prevA = getPanelDef("assets");
  registerPanel({
    id: "assets",
    title: "Assets",
    icon: FolderOpen,
    component: AssetsPanel,
    defaultPlacement: prevA?.defaultPlacement ?? { ref: "code", direction: "within", inactive: true },
    closable: true,
  });

  registerContextMenu("assets.item", (_t, _e, info) => assetItems(info.id));
  registerContextMenu("assets.empty", () => [
    { label: "Import Asset…", icon: FolderInput, run: () => void importFromPicker() },
    { label: "Refresh", run: () => void import("./assets/assetStore").then((m) => m.loadAssets()) },
    { label: `${useAssets.getState().items.length} asset(s)`, disabled: true },
  ]);
  registerContextMenu("preview.mesh", () => [...meshMenuItems(), SEP, ...viewportMenuItems()]);
  registerContextMenu("preview.viewport", (_t, e) =>
    meshUnder(e) ? [...meshMenuItems(), SEP, ...viewportMenuItems()] : viewportMenuItems(),
  );

  registerPanelExtras("preview", () => [
    { label: "Reset Camera", icon: Crosshair, run: resetCamera },
    ...meshMenuItems().slice(0, 2),
  ]);
  registerPanelExtras("assets", () => [
    { label: "Import Asset…", icon: FolderInput, run: () => void importFromPicker() },
    { label: "Refresh", run: () => void import("./assets/assetStore").then((m) => m.loadAssets()) },
  ]);
  startThumbnails();
}
