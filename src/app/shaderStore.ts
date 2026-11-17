import { create } from "zustand";
import {
  compileToGlsl,
  getDefaultHoistMode,
  getDefaultOptLevel,
  variantKey,
  type CompileResult,
  type Graph,
  type KeywordValues,
} from "@/core";

/** Export targets of the product. */
export type CodeTarget = "glsl" | "hlsl" | "wgsl" | "godot" | "unity";

export const CODE_TARGETS: Array<{ id: CodeTarget; label: string; enabled: boolean; reason?: string }> = [
  { id: "glsl", label: "GLSL (WebGL2)", enabled: true },
  { id: "hlsl", label: "HLSL", enabled: true },
  { id: "wgsl", label: "WGSL (WebGPU)", enabled: true },
  { id: "godot", label: "Godot 4 (.gdshader)", enabled: true },
  { id: "unity", label: "Unity URP (.shader)", enabled: true },
];

interface ShaderState {
  graph: Graph | null;
  /** Display name of the loaded graph. */
  graphName: string;
  /** Backend emit options that belong to the loaded graph (e.g. interpolation hints). */
  emitOptions: { interpolate?: string[] };
  target: CodeTarget;
  /** Active keyword variant (keyword id → value). Missing ids use the keyword's default. */
  keywordValues: KeywordValues;
  result: CompileResult | null;
  /** Bumped on every (re)compile so views can react even when the text is identical. */
  revision: number;
  setGraph: (graph: Graph | null, name?: string, emitOptions?: { interpolate?: string[] }) => void;
  setTarget: (t: CodeTarget) => void;
  /** Switch the active keyword variant; recompiles only when the variant actually changes. */
  setKeywordValues: (v: KeywordValues) => void;
}

/**
 * Variant cache: an immutable graph compiled for one (target, emit options, keyword variant) is reused.
 * Keyed by graph identity, so edits invalidate automatically while toggling a keyword back and forth is free.
 */
const variants = new WeakMap<Graph, Map<string, CompileResult>>();
const MAX_VARIANTS_PER_GRAPH = 16;

function compile(
  graph: Graph | null,
  target: CodeTarget,
  emit: { interpolate?: string[] },
  keywords: KeywordValues,
): CompileResult | null {
  if (!graph) return null;
  if (target !== "glsl") return null; // this store compiles the GLSL preview only; HLSL / WGSL / Godot / Unity panes compile in CodeOutputPanel (code/codeStore.compileTarget)
  const key = `${target}|o${getDefaultOptLevel()}h${getDefaultHoistMode()}|${JSON.stringify(emit)}|${variantKey(graph.keywords, keywords)}`;
  let cache = variants.get(graph);
  if (!cache) variants.set(graph, (cache = new Map()));
  const hit = cache.get(key);
  if (hit) return hit;
  const result = compileToGlsl(graph, { glsl: emit, keywordValues: keywords });
  if (cache.size >= MAX_VARIANTS_PER_GRAPH) cache.delete(cache.keys().next().value as string);
  cache.set(key, result);
  return result;
}

/**
 * Current graph + generated code synchronized with the active document.
 */
export const useShader = create<ShaderState>((set, get) => ({
  graph: null,
  graphName: "",
  emitOptions: {},
  target: "glsl",
  keywordValues: {},
  result: null,
  revision: 0,
  setGraph: (graph, name = "", emitOptions = {}) => {
    const { target, revision, keywordValues } = get();
    set({
      graph,
      graphName: name,
      emitOptions,
      result: compile(graph, target, emitOptions, keywordValues),
      revision: revision + 1,
    });
  },
  setTarget: (target) => {
    const { graph, emitOptions, revision, keywordValues } = get();
    set({ target, result: compile(graph, target, emitOptions, keywordValues), revision: revision + 1 });
  },
  setKeywordValues: (keywordValues) => {
    const { graph, target, emitOptions, revision, keywordValues: cur } = get();
    const same = graph
      ? variantKey(graph.keywords, cur) === variantKey(graph.keywords, keywordValues)
      : JSON.stringify(cur) === JSON.stringify(keywordValues);
    if (same) {
      set({ keywordValues });
      return;
    }
    set({ keywordValues, result: compile(graph, target, emitOptions, keywordValues), revision: revision + 1 });
  },
}));
