import { compileGraph, type CompileOptions, type CompileResult } from "../../compile/pipeline";
import { makeDiagnostic } from "../../diagnostics";
import type { Graph } from "../../graph/types";
import type { ProfileProblem } from "../../profiles/types";
import { nodeLabels } from "../glsl";
import { KEKENIK_GENERATOR_VERSION, godotBackend } from "./backend";
import { normalizeRenderer, normalizeVersion } from "./data/versions";
import { validateGodot } from "./validate";

export interface GodotCompile {
  result: CompileResult;
  /** The `.gdshader` text ("" when compilation failed). */
  text: string;
  fileName: string;
  /** Backend problems + static-validator findings. */
  problems: ProfileProblem[];
}

/** Compile a graph (profile `godot.*`) to a Godot 4 shader and run the static validators. Pure and deterministic. */
export function compileGodot(
  graph: Graph,
  options: CompileOptions & { generatorVersion?: string; globalUniforms?: string[] } = {},
): GodotCompile {
  const { generatorVersion, globalUniforms, ...rest } = options;
  const result = compileGraph(graph, {
    ...rest,
    runtimeKeywords: true,
    backend: godotBackend,
    emitOptions: {
      graphName: graph.name,
      settings: graph.settings,
      properties: graph.properties,
      keywords: graph.keywords,
      labels: nodeLabels(graph, rest.registry),
      generatorVersion: generatorVersion ?? KEKENIK_GENERATOR_VERSION,
      ...(globalUniforms ? { globalUniforms } : {}),
      ...(rest.emitOptions ?? {}),
    },
  });
  const file = result.files[0];
  const problems: ProfileProblem[] = [...(result.problems ?? [])];
  if (file) {
    const found = validateGodot(file.content, {
      target: {
        version: normalizeVersion(graph.settings.godotVersion),
        renderer: normalizeRenderer(graph.settings.godotRenderer),
      },
    });
    problems.push(...found);
    for (const p of found)
      if (p.severity === "error")
        result.diagnostics.push(makeDiagnostic("E_BACKEND_FAILED", `[${p.rule}] ${p.message}`));
  }
  for (const d of result.diagnostics)
    if (d.code === "E_NODE_UNSUPPORTED_TARGET")
      problems.push({ rule: "profile.node-unsupported", severity: "warning", message: d.message });
  if (problems.some((p) => p.severity === "error")) result.ok = false;
  result.problems = problems;
  return { result, text: file?.content ?? "", fileName: file?.path ?? "shader.gdshader", problems };
}
export { godotFileBase } from "./backend";
export { resolveGodotOptions } from "./options";
export * as godotData from "./data";
export { GODOT_RENDERERS, isSince, normalizeVersion, normalizeRenderer } from "./data";
