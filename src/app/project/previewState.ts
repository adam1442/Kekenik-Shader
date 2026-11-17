import { type MaterialPreset, type PreviewSection, embedPreview, materialJson, readPreview } from "@/core";
import { useMaterial, getKeywordValues, getMaterialValues } from "@/blackboard/materialStore";
import { useGraphs } from "@/ui/graph/graphStore";
import { useShader } from "@/app/shaderStore";
import { DEFAULT_PREFS, getPrefs, usePreview } from "@/preview/previewStore";
import { normalizePost } from "@/preview/gl/post/settings";
import { DEFAULT_SIM, getSim, useSceneSim } from "@/preview/sceneSim";
import { downloadText } from "@/app/lib/download";

/** Named material presets of the session (also stored in the project's preview section). */
const presets = new Map<string, MaterialPreset>();
export const listMaterialPresets = (): string[] => [...presets.keys()].sort();

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The current material (overrides, keyword variant, texture bindings) as a preset payload. */
function currentMaterial(): MaterialPreset {
  return clone({
    values: getMaterialValues() as Record<string, unknown>,
    keywords: getKeywordValues() as Record<string, unknown>,
    bindings: usePreview.getState().bindings,
  });
}

export function saveMaterialPreset(name: string): void {
  if (name.trim()) presets.set(name.trim(), currentMaterial());
}
export function deleteMaterialPreset(name: string): void {
  presets.delete(name);
}

/** Apply a preset to the active document (overrides + keywords + texture bindings). */
export function loadMaterialPreset(name: string): boolean {
  const p = presets.get(name);
  if (!p) return false;
  const id = useGraphs.getState().activeId;
  useMaterial.setState((s) => ({
    values: { ...s.values, [id]: clone(p.values) as never },
    keywords: { ...s.keywords, [id]: clone(p.keywords) as never },
  }));
  useShader.getState().setKeywordValues(clone(p.keywords) as never);
  for (const [k, v] of Object.entries(p.bindings)) usePreview.getState().bind(k, v);
  return true;
}

export const exportMaterialJson = (name = "material"): void =>
  downloadText(`${name}.material.json`, materialJson(name, presets.get(name) ?? currentMaterial()));

/** Everything the project file stores about the preview. */
function collectPreviewSection(): Omit<PreviewSection, "version"> {
  return clone({
    prefs: getPrefs() as unknown as Record<string, unknown>,
    sim: getSim() as unknown as Record<string, unknown>,
    bindings: usePreview.getState().bindings,
    material: {
      values: getMaterialValues() as Record<string, unknown>,
      keywords: getKeywordValues() as Record<string, unknown>,
    },
    presets: Object.fromEntries(presets),
  });
}

export const withPreviewSection = (text: string): string => embedPreview(text, collectPreviewSection());

/** Apply the preview section of an opened project (no-op when the file has none). Asset ids that this browser does not know stay unbound. */
export function restorePreviewSection(text: string): boolean {
  const s = readPreview(text);
  if (!s) return false;
  const prefs = { ...DEFAULT_PREFS, ...(s.prefs as object) } as typeof DEFAULT_PREFS;
  usePreview.setState({
    ...prefs,
    post: normalizePost((s.prefs as { post?: never }).post),
    bindings: { ...s.bindings },
  });
  useSceneSim.setState({ ...DEFAULT_SIM, ...(s.sim as object) });
  presets.clear();
  for (const [k, v] of Object.entries(s.presets)) presets.set(k, v);
  const id = useGraphs.getState().activeId;
  useMaterial.setState((m) => ({
    values: { ...m.values, [id]: s.material.values as never },
    keywords: { ...m.keywords, [id]: s.material.keywords as never },
  }));
  return true;
}
