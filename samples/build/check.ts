/**
 * Static + CPU-evaluated checks of a sample, shared by `scripts/build-samples.mjs` (fail the build early) and the auto-generated
 * tests (`11a.auto.*`). Pure: no DOM, no GPU. Every function returns a list of problems (empty = OK).
 */
import {
  sampleBudget, sampleSceneTarget, type EvalEnv, type Graph, type SampleMeta, type SampleTarget, compileGodot, compileGraph, compileToGlsl, compileToHlsl, compileToWgsl, compileUnity,
  componentCount, builtinInputType, evalOutputs, switchProfile,
} from "@/core";
import { createEmulation } from "@/preview/emulation";
import { type LayoutEnv, sizeOf } from "./layout";

const errorsOf = (r: { diagnostics: ReadonlyArray<{ severity: string; code: string; message: string }> }): string[] => r.diagnostics.filter((d) => d.severity === "error").map((d) => `${d.code}: ${d.message}`);

/** Compile the sample for one target; returns the generated text (all files joined) or the error list. */
export function compileTarget(graph: Graph, meta: SampleMeta, t: SampleTarget): { ok: boolean; errors: string[]; text: string } {
  try {
    if (t === "glsl") {
      // Same compile the Preview does: availability + emulation follow the simulated target family (Scene Depth etc. are emulated).
      const sim = meta.previewConfig.simulation;
      const st = sim?.target ?? sampleSceneTarget(graph.profileId);
      const r = compileToGlsl(graph, { glsl: { surface: "preview", emulation: createEmulation(st, { depthTexture: sim?.depthTexture ?? true, opaqueTexture: sim?.opaqueTexture ?? true }) }, isPreview: true, purpose: "preview", sceneTarget: st });
      return { ok: r.ok, errors: errorsOf(r), text: r.files.map((f) => f.content).join("\n") };
    }
    if (t === "hlsl" || t === "wgsl") {
      const r = (t === "hlsl" ? compileToHlsl : compileToWgsl)(graph, { sceneTarget: t });
      return { ok: r.ok, errors: errorsOf(r), text: r.files.map((f) => f.content).join("\n") };
    }
    if (t === "unity") {
      const u = compileUnity(graph);
      return { ok: u.result.ok, errors: [...errorsOf(u.result), ...u.problems.filter((p) => p.severity === "error").map((p) => `${p.rule}: ${p.message}`)], text: u.text };
    }
    const sw = switchProfile(graph, meta.godotProfile);
    const g = compileGodot(sw.graph);
    return { ok: g.result.ok, errors: [...errorsOf(g.result), ...g.problems.filter((p) => p.severity === "error").map((p) => `${p.rule}: ${p.message}`)], text: g.text };
  } catch (e) {
    return { ok: false, errors: [`threw: ${(e as Error).message}`], text: "" };
  }
}

/** Sample points for the finite-value check: varying inputs / textures; uniforms hold the graph's property defaults. */
export function evalEnvAt(k: number, defaults: Record<string, number[]>, engineWidth: Map<string, number> = new Map()): EvalEnv {
  const comp = (i: number, c: number): number => Math.abs(Math.sin(k * 1.7 + c * 0.9 + i * 0.37)) * 0.9 + 0.05;
  return {
    input: (i, sp) => {
      const n = componentCount(builtinInputType(i, sp));
      const name = String(i);
      return Array.from({ length: n }, (_, c) => (name.startsWith("uv") ? comp(k, c) : name === "position" ? comp(k + 3, c) * 2 - 1 : comp(k + 5, c) * 2 - 1));
    },
    uniform: (p) => defaults[p] ?? [0.42, 0.53, 0.64, 0.75],
    sample: (s) => [comp(k, 0 + (s.uv[0] ?? 0)), comp(k, 1 + (s.uv[1] ?? 0)), comp(k, 2), 1],
    textureSize: () => [64, 64],
    engine: (name, args) => [0.2 + (name.length % 4) * 0.2 + (args[0]?.[0] ?? 0) * 0.01, 0.55, 0.6, 0.65].slice(0, engineWidth.get(name) ?? 4),
  };
}

const defaultsOf = (graph: Graph, m: { uniforms: ReadonlyArray<{ prop: string; ty: string }> }): Record<string, number[]> => {
  const out: Record<string, number[]> = {};
  for (const u of m.uniforms) {
    const p = graph.properties.find((x) => x.id === u.prop);
    const d = p?.default;
    out[u.prop] = Array.isArray(d) ? [...d] : typeof d === "number" ? [d] : typeof d === "boolean" ? [d ? 1 : 0] : [0.5, 0.5, 0.5, 1];
  }
  return out;
};

/** CPU evaluation of every master output at 8 sample points: all components must be finite (no NaN / ±Inf). */
export function finiteProblems(graph: Graph): string[] {
  const r = compileGraph(graph, { skipEmit: true, purpose: "preview", isPreview: true, optimize: 0, sceneTarget: sampleSceneTarget(graph.profileId) });
  if (!r.ok || !r.module) return [`does not compile: ${errorsOf(r).join("; ")}`];
  const defaults = defaultsOf(graph, r.module);
  const engineWidth = new Map<string, number>();
  const scan = (o: unknown): void => {
    if (Array.isArray(o)) { for (const e of o) { const x = e as { op?: string; name?: string; ty?: string }; if (x && x.op === "engine" && x.name && x.ty) engineWidth.set(x.name, componentCount(x.ty as never)); else scan(e); } }
    else if (o && typeof o === "object") for (const v of Object.values(o)) scan(v);
  };
  scan(r.module);
  const bad: string[] = [];
  for (let k = 0; k < 8; k++) {
    try {
      const out = evalOutputs(r.module, evalEnvAt(k, defaults, engineWidth));
      for (const [slot, v] of Object.entries(out)) if (v.some((x) => !Number.isFinite(x))) bad.push(`output "${slot}" is not finite at sample point ${k}: [${v.map((x) => (Number.isFinite(x) ? x.toFixed(3) : String(x))).join(", ")}]`);
    } catch (e) {
      bad.push(`evaluation threw at point ${k}: ${(e as Error).message}`);
      break;
    }
  }
  return [...new Set(bad)];
}

/** Estimated cost vs. the declared budget class (shared with the Sample Browser: `sampleBudget` in core). */
export const budgetReport = (graph: Graph, meta: SampleMeta): ReturnType<typeof sampleBudget> => sampleBudget(graph, meta.budgetClass);

/** Everything the build script verifies before writing a sample. */
export function checkSample(graph: Graph, meta: SampleMeta): string[] {
  const out: string[] = [];
  const base = compileGraph(graph, { skipEmit: true });
  if (!base.ok) out.push(...errorsOf(base).map((e) => `analysis: ${e}`));
  for (const t of meta.targets) { const c = compileTarget(graph, meta, t); if (!c.ok) out.push(...c.errors.map((e) => `${t}: ${e}`)); }
  out.push(...finiteProblems(graph).map((e) => `finite: ${e}`));
  out.push(...equivalenceProblems(graph).map((e) => `optimiser: ${e}`));
  out.push(...overlapProblems(graph).map((e) => `layout: ${e}`));
  out.push(...budgetReport(graph, meta).problems.map((e) => `budget: ${e}`));
  return out;
}

/** Optimiser equivalence gate: every master output at optimisation level 2 equals level 0 (same CPU evaluation, tolerance 1e-3 relative) at 6 sample points. */
export function equivalenceProblems(graph: Graph): string[] {
  const opts = { skipEmit: true, purpose: "preview", isPreview: true, sceneTarget: sampleSceneTarget(graph.profileId) } as const;
  const a = compileGraph(graph, { ...opts, optimize: 0 }), b = compileGraph(graph, { ...opts, optimize: 2 });
  if (!a.module || !b.module) return ["does not compile"];
  const defaults = defaultsOf(graph, a.module);
  const widths = new Map<string, number>();
  const scan = (o: unknown): void => {
    if (Array.isArray(o)) { for (const e of o) { const x = e as { op?: string; name?: string; ty?: string }; if (x && x.op === "engine" && x.name && x.ty) widths.set(x.name, componentCount(x.ty as never)); else scan(e); } }
    else if (o && typeof o === "object") for (const v of Object.values(o)) scan(v);
  };
  scan(a.module);
  const bad: string[] = [];
  for (let k = 0; k < 6; k++) {
    const ea = evalOutputs(a.module, evalEnvAt(k, defaults, widths)), eb = evalOutputs(b.module, evalEnvAt(k, defaults, widths));
    for (const [slot, v] of Object.entries(ea)) {
      const w = eb[slot];
      if (!w || w.length !== v.length || v.some((x, i) => Math.abs(x - w[i]!) > 1e-3 * Math.max(1, Math.abs(x)))) bad.push(`output "${slot}" differs between optimisation level 0 and 2 at point ${k}`);
    }
  }
  return [...new Set(bad)];
}

/** Node boxes (main graph and every subgraph body) must not overlap — the DSL layout guarantees a readable canvas. */
export function overlapProblems(graph: Graph): string[] {
  const env: LayoutEnv = { subDefs: graph.subgraphDefs, profileId: graph.profileId, settings: graph.settings as never };
  const bodies: Array<[string, Record<string, import("@/core").NodeInstance>]> = [["main", graph.nodes], ...Object.values(graph.subgraphDefs).map((d) => [d.id, d.nodes] as [string, Record<string, import("@/core").NodeInstance>])];
  const out: string[] = [];
  for (const [name, nodes] of bodies) {
    const boxes = Object.values(nodes).map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, ...sizeOf(n, env) }));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i]!, q = boxes[j]!;
      if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) out.push(`${name}: nodes "${p.id}" and "${q.id}" overlap`);
    }
  }
  return out;
}
