import { create } from "zustand";
import {
  type CompileResult,
  type Graph,
  type GeneratedTarget,
  type KeywordValues,
  compileForTarget,
  getDefaultHoistMode,
  getDefaultOptLevel,
  variantKey,
} from "@/core";
import type { CodeTarget } from "../../shaderStore";

/** Per-target generation options exposed in the pane's options popover (GLSL has none). */
export interface TargetOptions {
  /** Keep the platform's native `ddy` sign instead of the canonical (GLSL, "up") one. */
  nativeDerivatives: boolean;
  /** v' = 1 − v on mesh UVs. */
  flipUvV: boolean;
  /** Negate clip-space Y (render targets that are sampled upside down). */
  flipClipY: boolean;
}
const DEFAULT_TARGET_OPTIONS: TargetOptions = { nativeDerivatives: false, flipUvV: false, flipClipY: false };

export interface PaneState {
  target: CodeTarget;
  file: string;
}
export const MAX_PANES = 3;

interface CodeState {
  panes: PaneState[];
  options: Record<GeneratedTarget, TargetOptions>;
  diff: boolean;
  setPaneTarget: (i: number, t: CodeTarget) => void;
  setPaneFile: (i: number, file: string) => void;
  addPane: () => void;
  removePane: (i: number) => void;
  setOption: (t: GeneratedTarget, key: keyof TargetOptions, v: boolean) => void;
  setDiff: (d: boolean) => void;
}

const NEXT: CodeTarget[] = ["glsl", "wgsl", "hlsl"];
const initialPanes = (): PaneState[] => [{ target: "glsl", file: "shader.frag" }];

export const useCode = create<CodeState>((set, get) => ({
  panes: initialPanes(),
  options: {
    glsl: { ...DEFAULT_TARGET_OPTIONS },
    hlsl: { ...DEFAULT_TARGET_OPTIONS },
    wgsl: { ...DEFAULT_TARGET_OPTIONS },
  },
  diff: false,
  setPaneTarget: (i, target) => set({ panes: get().panes.map((p, k) => (k === i ? { target, file: "" } : p)) }),
  setPaneFile: (i, file) => set({ panes: get().panes.map((p, k) => (k === i ? { ...p, file } : p)) }),
  addPane: () => {
    const { panes } = get();
    if (panes.length >= MAX_PANES) return;
    const used = new Set(panes.map((p) => p.target));
    set({ panes: [...panes, { target: NEXT.find((t) => !used.has(t)) ?? "wgsl", file: "" }] });
  },
  removePane: (i) => {
    const { panes } = get();
    if (panes.length > 1)
      set({ panes: panes.filter((_, k) => k !== i), diff: panes.length - 1 < 2 ? false : get().diff });
  },
  setOption: (t, key, v) => set({ options: { ...get().options, [t]: { ...get().options[t], [key]: v } } }),
  setDiff: (diff) => set({ diff: diff && get().panes.length >= 2 }),
}));

/** Back to one GLSL pane on the fragment file, no diff. */
export const resetCodePanes = (): void => useCode.setState({ panes: initialPanes(), diff: false });

/** Variant cache: immutable graph × target × options × keyword variant → compile result. */
const cache = new WeakMap<Graph, Map<string, CompileResult>>();

export function compileTarget(
  graph: Graph,
  target: GeneratedTarget,
  emit: { interpolate?: string[] },
  keywords: KeywordValues,
  options: TargetOptions,
): CompileResult {
  const key = `${target}|o${getDefaultOptLevel()}h${getDefaultHoistMode()}|${JSON.stringify(emit)}|${JSON.stringify(options)}|${variantKey(graph.keywords, keywords)}`;
  let m = cache.get(graph);
  if (!m) cache.set(graph, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;
  const r = compileForTarget(graph, target, {
    keywordValues: keywords,
    emit: { ...emit, ...(target === "glsl" ? {} : options) },
  });
  if (m.size > 24) m.delete(m.keys().next().value as string);
  m.set(key, r);
  return r;
}

/** Latest result shown by each pane (non-reactive; context menus read it). */
export const livePanes: Array<
  { target: CodeTarget; file: string; text: string; result: CompileResult | null } | undefined
> = [];
