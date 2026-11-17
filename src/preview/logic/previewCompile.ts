import { type CompileResult, type Graph, type KeywordValues, compileToGlsl, variantKey } from "@/core";
import { effectiveTarget, getSim } from "../sceneSim";
import { createEmulation } from "../emulation";
import { getEmulateHalf } from "./halfEmulation";

/**
 * The preview's own GLSL compile (purpose "preview": availability against the ACTIVE TARGET FAMILY, engine intrinsics emulated, preview
 * surface contract on). It differs from the export view (`useShader.result`) in COMPILE-TIME inputs only: `isPreview` (Is Preview = 1),
 * the simulated target (Target Switch, Is Reversed-Z, …), the emulation switches and `surface: "preview"`. Cached per graph
 * identity + variant, like the shader store, so toggling a keyword or a simulation setting back and forth is free.
 */
const cache = new WeakMap<Graph, Map<string, CompileResult>>();
const MAX = 16;

export function compilePreview(
  graph: Graph | null,
  emit: { interpolate?: string[] },
  keywords: KeywordValues,
): CompileResult | null {
  if (!graph) return null;
  const sim = getSim();
  const target = effectiveTarget(sim);
  const emulateHalf = getEmulateHalf();
  const key = `${target}|${emulateHalf ? "h16|" : ""}${sim.depthTexture ? "d" : "-"}${sim.opaqueTexture ? "c" : "-"}|${JSON.stringify(emit)}|${variantKey(graph.keywords, keywords)}`;
  let m = cache.get(graph);
  if (!m) cache.set(graph, (m = new Map()));
  const hit = m.get(key);
  if (hit) return hit;
  const result = compileToGlsl(graph, {
    glsl: {
      ...emit,
      surface: "preview",
      ...(emulateHalf ? { emulateHalf: true } : {}),
      emulation: createEmulation(target, { depthTexture: sim.depthTexture, opaqueTexture: sim.opaqueTexture }),
    },
    keywordValues: keywords,
    sceneTarget: target,
    isPreview: true,
    purpose: "preview",
  });
  if (m.size >= MAX) m.delete(m.keys().next().value as string);
  m.set(key, result);
  return result;
}
