import { type Edge, type Graph, type GraphAnalysis, type ShaderType, isImplicit } from "@/core";
import { type ConnectCtx, inputType, outputType } from "./connect";
import { portColor } from "./portStyles";
import type { SceneIndex } from "./sceneIndex";

/**
 * How one wire is painted. The wire takes the SOURCE port's colour; when the connection involves an implicit
 * conversion (`isImplicit(from, to)`: splat / truncate / pad / reinterpret) it becomes a gradient source → target.
 */
export interface WireStyle {
  from: string;
  to: string;
  gradient: boolean;
  fromType?: ShaderType;
  toType?: ShaderType;
}

export function wireStyleFor(src: ShaderType | undefined, dst: ShaderType | undefined): WireStyle {
  const from = portColor(src);
  const to = portColor(dst ?? src);
  const gradient = !!src && !!dst && isImplicit(src, dst);
  return { from, to, gradient, ...(src ? { fromType: src } : {}), ...(dst ? { toType: dst } : {}) };
}

/** Style of an existing edge using the analysis (resolved generic types, through reroutes) with declared types as fallback. */
export function edgeStyle(
  graph: Graph,
  scene: SceneIndex,
  analysis: GraphAnalysis | null | undefined,
  e: Edge,
): WireStyle {
  const res = analysis?.main.info.get(e.to.node)?.inputs[e.to.port];
  const ctx: ConnectCtx = { graph, scene, analysis };
  const src = res?.source ?? outputType(ctx, e.from);
  const dst = res?.target ?? inputType(ctx, e.to);
  return wireStyleFor(src, dst);
}
