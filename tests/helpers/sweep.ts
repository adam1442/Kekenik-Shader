import { createGraph, createNode } from "../../src/core/graph/create";
import { applyOperation } from "../../src/core/graph/ops/apply";
import { ops } from "../../src/core/graph/ops/make";
import { defaultNodeRegistry } from "../../src/core/nodes";
import { compileGodot } from "../../src/core/codegen/godot";
import { targetProfiles } from "../../src/core/profiles";
import type { Graph, SubgraphDef } from "../../src/core/graph/types";
import type { NodeDef } from "../../src/core/registry/nodeDef";

export const GODOT_PROFILES = ["godot.spatial", "godot.canvasitem", "godot.spatial.vfx"] as const;
export type SweepStatus = "OK" | "UNSUPPORTED" | "BROKEN" | "SKIP";
export interface SweepResult {
  node: string;
  category: string;
  profile: string;
  variant: "main" | "function";
  status: SweepStatus;
  detail: string;
}

/** Non-default inline values for the static inputs of a node. */
function sampleValues(def: NodeDef): Record<string, number | number[]> {
  const v: Record<string, number | number[]> = {};
  for (const p of def.inputs) {
    if (p.type.k !== "type") continue;
    const t = p.type.type as string;
    if (t === "float") v[p.id] = 0.37;
    else if (t === "int") v[p.id] = 3;
    else if (t === "vec2") v[p.id] = [0.3, 0.7];
    else if (t === "vec3") v[p.id] = [0.2, 0.5, 0.9];
    else if (t === "vec4") v[p.id] = [0.2, 0.5, 0.9, 1];
  }
  return v;
}
const outType = (def: NodeDef): string => {
  const o = def.outputs[0];
  return o && o.type.k === "type" ? (o.type.type as string) : "float";
};

function connectAny(g: Graph, from: { node: string; port: string }, toNode: string, ports: string[], scope?: string): Graph {
  for (const port of ports) {
    const r = applyOperation(g, ops.connect(from, { node: toNode, port }, scope));
    if (Object.keys(r.graph.edges).length > Object.keys(g.edges).length || scope) return r.graph;
  }
  return g;
}

export function buildSweepGraph(def: NodeDef, profile: string, variant: "main" | "function"): Graph | undefined {
  const out0 = def.outputs[0];
  if (!out0 || def.structural || def.id === "masterOutput") return undefined;
  const ot = outType(def);
  if (["texture2D", "sampler", "texture3D", "textureCube", "texture2DArray"].includes(ot)) return undefined;
  let g = createGraph({ name: `Sweep ${def.id}`, profileId: profile, settings: { godotVersion: "4.7" } });
  g = applyOperation(g, ops.addNode(createNode("master", "masterOutput", { position: { x: 900, y: 0 } }))).graph;
  const init = { values: sampleValues(def), position: { x: 0, y: 0 } };
  if (variant === "main") {
    g = applyOperation(g, ops.addNode(createNode("n", def.id, init))).graph;
    g = connectAny(g, { node: "n", port: out0.id }, "master", ["baseColor", "emission", "alpha"]);
    return g;
  }
  const sub: SubgraphDef = {
    id: "sweep_fn",
    name: "Sweep Fn",
    inputs: [],
    outputs: [{ id: "o", name: "O", type: (["float", "int", "vec2", "vec3", "vec4"].includes(ot) ? ot : "vec4") as never }],
    nodes: {
      n: createNode("n", def.id, init),
      outputs: createNode("outputs", "subgraphOutputs", { position: { x: 400, y: 0 } }),
    },
    edges: {},
  };
  g = applyOperation(g, ops.addSubgraphDef(sub)).graph;
  g = connectAny(g, { node: "n", port: out0.id }, "outputs", ["o"], "sweep_fn");
  g = applyOperation(g, ops.addNode(createNode("fn", "subgraph", { params: { subgraph: "sweep_fn" }, position: { x: 400, y: 0 } }))).graph;
  g = connectAny(g, { node: "fn", port: "o" }, "master", ["baseColor", "emission", "alpha"]);
  return g;
}

export function runSweep(profiles: readonly string[] = GODOT_PROFILES): SweepResult[] {
  const results: SweepResult[] = [];
  for (const def of defaultNodeRegistry.list()) {
    for (const profile of profiles) {
      if (!targetProfiles.get(profile)) continue;
      for (const variant of ["main", "function"] as const) {
        const base = { node: def.id, category: def.category, profile, variant };
        let g: Graph | undefined;
        try {
          g = buildSweepGraph(def, profile, variant);
        } catch (e) {
          results.push({ ...base, status: "SKIP", detail: `graph build: ${(e as Error).message}` });
          continue;
        }
        if (!g) {
          results.push({ ...base, status: "SKIP", detail: "no standalone value output" });
          continue;
        }
        try {
          const r = compileGodot(g);
          const diagErrors = r.result.diagnostics.filter((d) => d.severity === "error");
          // A clean "this node cannot be exported to Godot" diagnostic = UNSUPPORTED. Everything else the compiler rejects is a limit of the
          // one-node harness graph (unconnected required input, stage wiring …) and is reported as SKIP, not as a Godot verdict.
          const isTarget = (d: { code: string; message: string }): boolean =>
            d.code === "E_NODE_UNSUPPORTED_TARGET" || /Godot|canvas_item|shader_type|Engine intrinsic|FRONT_FACING/.test(d.message);
          const unsup = diagErrors.filter(isTarget);
          const val = r.problems.filter((p) => p.severity === "error");
          if (r.text && val.length) results.push({ ...base, status: "BROKEN", detail: val.map((p) => `${p.rule}${p.line ? ` L${p.line}` : ""}: ${p.message}`).slice(0, 4).join(" | ") });
          else if (unsup.length) results.push({ ...base, status: "UNSUPPORTED", detail: unsup[0]!.message });
          else if (!r.text || diagErrors.length) results.push({ ...base, status: "SKIP", detail: `harness: ${diagErrors[0]?.message ?? "no output"}` });
          else results.push({ ...base, status: "OK", detail: "" });
        } catch (e) {
          results.push({ ...base, status: "BROKEN", detail: `exception: ${(e as Error).message}` });
        }
      }
    }
  }
  return results;
}
