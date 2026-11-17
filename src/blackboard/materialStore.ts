import { create } from "zustand";
import type { KeywordValues, MaterialPaste, MaterialValues, PropertyValue } from "@/core";
import { useShader } from "@/app/shaderStore";
import { useGraphs } from "@/ui/graph/graphStore";

/**
 * Material instance state (what a game-engine material stores on top of the shader): property overrides and the
 * active keyword variant, per open document. Textures live in `usePreview.bindings` (asset ids).
 * Editing never touches the graph — it is the "material", not the "shader" — so it is not part of undo.
 */
interface MaterialState {
  values: Record<string, MaterialValues>;
  keywords: Record<string, KeywordValues>;
}

export const useMaterial = create<MaterialState>(() => ({ values: {}, keywords: {} }));

const EMPTY_VALUES: MaterialValues = Object.freeze({});
const EMPTY_KEYWORDS: KeywordValues = Object.freeze({});
const doc = (): string => useGraphs.getState().activeId;

/** Overrides of the active document (stable object while unchanged; `{}` when none). */
export const getMaterialValues = (): MaterialValues => useMaterial.getState().values[doc()] ?? EMPTY_VALUES;
export const getKeywordValues = (): KeywordValues => useMaterial.getState().keywords[doc()] ?? EMPTY_KEYWORDS;

/** React hook: overrides of the active document. */
export function useMaterialValues(): MaterialValues {
  const active = useGraphs((s) => s.activeId);
  return useMaterial((s) => s.values[active] ?? EMPTY_VALUES);
}

/** React hook: keyword variant of the active document. */
export function useKeywordValues(): KeywordValues {
  const active = useGraphs((s) => s.activeId);
  return useMaterial((s) => s.keywords[active] ?? EMPTY_KEYWORDS);
}

function patchValues(fn: (cur: MaterialValues) => MaterialValues): void {
  const id = doc();
  useMaterial.setState((s) => ({ values: { ...s.values, [id]: fn(s.values[id] ?? EMPTY_VALUES) } }));
}

export function setMaterialValue(propId: string, value: PropertyValue): void {
  patchValues((cur) => ({ ...cur, [propId]: value }));
}

export function resetMaterialValue(propId: string): void {
  patchValues((cur) => {
    if (!(propId in cur)) return cur;
    const { [propId]: _gone, ...rest } = cur;
    return rest;
  });
}

export function resetMaterial(): void {
  const id = doc();
  useMaterial.setState((s) => ({
    values: { ...s.values, [id]: EMPTY_VALUES },
    keywords: { ...s.keywords, [id]: EMPTY_KEYWORDS },
  }));
  useShader.getState().setKeywordValues(EMPTY_KEYWORDS);
}

/** Merge keyword values into the active document's variant and compile it (one recompile; cached afterwards). */
function patchKeywords(patch: KeywordValues): void {
  const id = doc();
  const next = { ...(useMaterial.getState().keywords[id] ?? EMPTY_KEYWORDS), ...patch };
  useMaterial.setState((s) => ({ keywords: { ...s.keywords, [id]: next } }));
  useShader.getState().setKeywordValues(next);
}

/** Switch a keyword of the active material; the Preview compiles the new variant (one recompile, cached afterwards). */
export const setKeyword = (keywordId: string, value: number): void => patchKeywords({ [keywordId]: value });

/** Apply pasted material JSON (already parsed and coerced by `parseMaterialJson`). */
export function applyMaterialPaste(p: MaterialPaste): void {
  patchValues((cur) => ({ ...cur, ...p.values }));
  if (Object.keys(p.keywords).length) patchKeywords(p.keywords);
}

let synced = false;
/** Follow tab switches: the keyword variant of the newly active document becomes the compiled variant. Idempotent. */
export function initMaterialSync(): void {
  if (synced) return;
  synced = true;
  useGraphs.subscribe((s, prev) => {
    if (s.activeId !== prev.activeId) useShader.getState().setKeywordValues(getKeywordValues());
  });
}
