import { readFileSync } from "node:fs";
import { buildBundle } from "../../src/core/export/bundle";
import { validateGodot } from "../../src/core/codegen/godot/validate";
import { parseKShader } from "../../src/core/serialization/kshader";
import type { Graph } from "../../src/core/graph/types";

export const loadSample = (id: string): Graph => parseKShader(readFileSync(`public/samples/${id}.kshader`, "utf8")).graph;

/** Export `graph` for Godot (profile/version optional) and return the .gdshader text + every problem (bundle report + static validator). */
export function exportGodot(graph: Graph, profile?: string, version = "4.7") {
  const b = buildBundle(graph, { godot: { enabled: true, version, ...(profile ? { profile } : {}) } });
  const file = b.files.find((f) => f.target === "godot");
  const text = file?.content ?? "";
  const rep = b.reports.find((r) => r.id === "godot");
  const fresh = text ? validateGodot(text) : [];
  return { text, bundle: b, problems: [...(rep?.problems ?? []), ...fresh], errors: [...(rep?.problems ?? []), ...fresh].filter((p) => p.severity === "error") };
}
export const errorsOf = (src: string) => validateGodot(src).filter((p) => p.severity === "error");
export const rules = (src: string): string[] => errorsOf(src).map((p) => p.rule);
