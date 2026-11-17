import { type GeneratedTarget, compileForTarget } from "../codegen/compileTargets";
import { compileGodot } from "../codegen/godot";
import { compileUnity } from "../codegen/unity";
import { compileGraph, type CompileResult } from "../compile/pipeline";
import type { Graph } from "../graph/types";
import { type OptLevel, optimizeModuleWithReport } from "../opt";
import { type CostReport, costModule } from "./cost";

interface TargetSize {
  target: string;
  statements: number;
  lines: number;
}
interface LevelSnapshot {
  level: OptLevel;
  exprs: number;
  desktop: CostReport;
  mobile: CostReport;
  rules: Record<string, number>;
  targets: TargetSize[];
}
export interface OptimizationReport {
  graphName: string;
  levels: LevelSnapshot[];
}

const textOf = (r: CompileResult): string => r.files.map((f) => f.content).join("\n");
const size = (target: string, text: string): TargetSize => ({
  target,
  lines: text ? text.split("\n").length : 0,
  statements: (text.match(/;\s*$/gm) ?? []).length,
});

/** Generated code of `target` at an optimisation level (used for the code diff between levels). */
export function targetText(graph: Graph, target: GeneratedTarget | "unity" | "godot", level: OptLevel): string {
  if (target === "unity") return compileUnity(graph, { optimize: level }).text;
  if (target === "godot") return compileGodot(graph, { optimize: level }).text;
  return textOf(compileForTarget(graph, target, { optimize: level }));
}

/** Before / after numbers of the whole graph at optimisation levels 0, 1 and 2 plus the transformations the optimiser applied. */
export function buildOptimizationReport(graph: Graph): OptimizationReport | undefined {
  const levels: LevelSnapshot[] = [];
  const raw = compileGraph(graph, { skipEmit: true, optimize: 0 });
  if (!raw.module) return undefined;
  for (const level of [0, 1, 2] as const) {
    const mod = level === 0 ? raw.module : optimizeModuleWithReport(raw.module, level).module;
    const rules = level === 0 ? {} : optimizeModuleWithReport(raw.module, level).report.rules;
    const targets: TargetSize[] = [];
    for (const t of ["glsl", "hlsl", "wgsl"] as const) targets.push(size(t.toUpperCase(), targetText(graph, t, level)));
    if (graph.profileId.startsWith("unity.")) targets.push(size("Unity URP", targetText(graph, "unity", level)));
    if (graph.profileId.startsWith("godot.")) targets.push(size("Godot 4", targetText(graph, "godot", level)));
    levels.push({
      level,
      exprs: mod.main.exprs.length,
      desktop: costModule(mod, "desktop"),
      mobile: costModule(mod, "mobile"),
      rules,
      targets,
    });
  }
  return { graphName: graph.name, levels };
}
