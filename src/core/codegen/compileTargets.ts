import { type CompileOptions, type CompileResult, compileGraph } from "../compile/pipeline";
import type { Backend } from "../compile/backend";
import type { Graph } from "../graph/types";
import { glslBackend, nodeLabels } from "./glsl";
import { hlslBackend, type HlslEmitOptions } from "./hlsl";
import { wgslBackend, type WgslEmitOptions } from "./wgsl";

/** Targets with a real code generator today (Godot / Unity arrive in ). */
export type GeneratedTarget = "glsl" | "hlsl" | "wgsl";
export const GENERATED_TARGETS: readonly GeneratedTarget[] = ["glsl", "hlsl", "wgsl"];

const BACKENDS: Record<GeneratedTarget, Backend> = { glsl: glslBackend, hlsl: hlslBackend, wgsl: wgslBackend };

/** Emit options shared by all targets plus the per-target ones (`hlsl` / `wgsl` entries). */
export type TargetEmitOptions = { interpolate?: string[] } & HlslEmitOptions & WgslEmitOptions;

/** Compile a graph with any generated target; temporaries are named after the graph nodes. */
export function compileForTarget(
  graph: Graph,
  target: GeneratedTarget,
  options: CompileOptions & { emit?: TargetEmitOptions } = {},
): CompileResult {
  const { emit, ...rest } = options;
  return compileGraph(graph, {
    ...rest,
    backend: BACKENDS[target],
    emitOptions: { labels: nodeLabels(graph, rest.registry), ...emit, ...(rest.emitOptions ?? {}) },
  });
}

export const compileToHlsl = (graph: Graph, options: CompileOptions & { emit?: HlslEmitOptions } = {}): CompileResult =>
  compileForTarget(graph, "hlsl", options);
export const compileToWgsl = (graph: Graph, options: CompileOptions & { emit?: WgslEmitOptions } = {}): CompileResult =>
  compileForTarget(graph, "wgsl", options);
