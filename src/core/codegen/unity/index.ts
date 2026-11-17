import { compileGraph, type CompileOptions, type CompileResult } from "../../compile/pipeline";
import { makeDiagnostic } from "../../diagnostics";
import type { Graph } from "../../graph/types";
import type { ProfileProblem } from "../../profiles/types";
import { unityBackend, KEKENIK_GENERATOR_VERSION } from "./backend";
import { validateUnityText } from "./validate";
import { nodeLabels } from "../glsl";

export interface UnityCompile {
  result: CompileResult;
  /** The `.shader` text ("" when compilation failed). */
  text: string;
  fileName: string;
  /** Backend problems + static-validator findings. */
  problems: ProfileProblem[];
}

/** Compile a graph (profile `unity.urp.*`) to a Unity URP shader and run the static validators. Pure and deterministic. */
export function compileUnity(graph: Graph, options: CompileOptions & { generatorVersion?: string } = {}): UnityCompile {
  const { generatorVersion, ...rest } = options;
  const result = compileGraph(graph, {
    ...rest,
    runtimeKeywords: true,
    backend: unityBackend,
    emitOptions: {
      graphName: graph.name,
      settings: graph.settings,
      properties: graph.properties,
      keywordCount: graph.keywords.length,
      keywords: graph.keywords,
      labels: nodeLabels(graph, rest.registry),
      generatorVersion: generatorVersion ?? KEKENIK_GENERATOR_VERSION,
      ...(rest.emitOptions ?? {}),
    },
  });
  const file = result.files[0];
  const problems: ProfileProblem[] = [...(result.problems ?? [])];
  if (file) problems.push(...validateUnityText(file.content, graph));
  // Validator errors are surfaced as graph diagnostics too (Code panel / Problems); warnings stay in `problems`.
  for (const p of problems)
    if (p.severity === "error" && p.rule.startsWith("unity."))
      result.diagnostics.push(makeDiagnostic("E_BACKEND_FAILED", `[${p.rule}] ${p.message}`));
  if (problems.some((p) => p.severity === "error")) result.ok = false;
  result.problems = problems;
  return { result, text: file?.content ?? "", fileName: file?.path ?? "Shader.shader", problems };
}
export * from "./data/targets";
export { sanitizeShaderName, defaultShaderName } from "./options";
