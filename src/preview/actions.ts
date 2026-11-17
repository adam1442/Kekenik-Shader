import { toast } from "@/ui";
import { ACCEPT_ALL } from "./assets/classify";
import { type ImportResult, deleteAsset, getAssetMeta, importFiles } from "./assets/assetStore";
import { getController } from "./controller";
import { type CameraPresetId, type PrimitiveId, usePreview } from "./previewStore";
import { useShader } from "@/app/shaderStore";

/** Open the native file picker (created programmatically so no raw form element lives in feature JSX). */
function pickFiles(accept = ACCEPT_ALL, multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const el = document.createElement("input");
    el.type = "file";
    el.accept = accept;
    el.multiple = multiple;
    el.style.display = "none";
    el.onchange = () => {
      resolve(Array.from(el.files ?? []));
      el.remove();
    };
    el.oncancel = () => {
      resolve([]);
      el.remove();
    };
    document.body.appendChild(el);
    el.click();
  });
}

/** Import files and put them to use: model → 3D viewport, texture → sprite (2D) or the first free texture property, HDR → environment. */
export async function importAndUse(files: readonly File[], opts: { use?: boolean } = {}): Promise<ImportResult[]> {
  const results = await importFiles(files);
  const st = usePreview.getState();
  for (const r of results) {
    if (!r.ok || !r.asset) {
      toast.show({ title: "Import failed", description: r.error ?? r.file, kind: "danger" });
      continue;
    }
    const a = r.asset;
    toast.show({
      title: `Imported ${a.name}`,
      ...(a.warning ? { description: a.warning } : {}),
      kind: a.warning ? "warning" : "success",
      duration: a.warning ? 6000 : 2200,
    });
    if (opts.use === false) continue;
    if (a.kind === "model") st.set({ modelAssetId: a.id, mode: "3d", debugView: "shader", materialSlot: 0 });
    else if (a.kind === "hdr") st.set({ hdrAssetId: a.id, bg: "environment" });
    else if (st.mode === "2d") st.set({ spriteAssetId: a.id });
    else {
      const free = useShader
        .getState()
        .graph?.properties.find((p) => p.type === "texture2D" && !usePreview.getState().bindings[p.id]);
      if (free) st.bind(free.id, a.id);
      else st.set({ spriteAssetId: a.id });
    }
  }
  return results;
}

export async function importFromPicker(): Promise<void> {
  const files = await pickFiles();
  if (files.length) await importAndUse(files);
}

/** Remove an asset and every reference the project holds to it. */
export async function removeAsset(id: string): Promise<void> {
  const st = usePreview.getState();
  const patch: Partial<Parameters<typeof st.set>[0]> = {};
  if (st.modelAssetId === id) patch.modelAssetId = null;
  if (st.spriteAssetId === id) patch.spriteAssetId = null;
  if (st.hdrAssetId === id) patch.hdrAssetId = null;
  if (Object.keys(patch).length) st.set(patch);
  for (const [p, a] of Object.entries(st.bindings)) if (a === id) st.bind(p, null);
  await deleteAsset(id);
}

/** Use an existing asset in the viewport (double-click / context menu / drop on the Preview). */
export function useAsset(id: string): void {
  const a = getAssetMeta(id);
  const st = usePreview.getState();
  if (!a) return;
  if (a.kind === "model") st.set({ modelAssetId: id, mode: "3d", materialSlot: 0 });
  else if (a.kind === "hdr") st.set({ hdrAssetId: id, bg: "environment" });
  else if (st.mode === "2d") st.set({ spriteAssetId: id });
  else {
    const free = useShader.getState().graph?.properties.find((p) => p.type === "texture2D" && !st.bindings[p.id]);
    if (free) st.bind(free.id, id);
    else st.set({ spriteAssetId: id, mode: "2d" });
  }
}

export const resetCamera = (): void => getController()?.engine.resetCamera();
export const frameObject = (): void => getController()?.engine.frameContent();
export const cameraPreset = (id: CameraPresetId): void => getController()?.engine.rig.preset(id);
export const setPrimitive = (primitive: PrimitiveId): void =>
  usePreview.getState().set({ primitive, modelAssetId: null, mode: "3d" });
export const toggleWireframe = (): void => usePreview.getState().set({ wireframe: !usePreview.getState().wireframe });
export const togglePlay = (): void => usePreview.getState().setRuntime({ playing: !usePreview.getState().playing });
export const rewindTime = (): void => {
  const c = getController();
  c?.engine.setTime(0);
  c?.engine.content.emitter.reset();
};
