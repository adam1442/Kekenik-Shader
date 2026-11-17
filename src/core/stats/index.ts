import type { ExprId, IRBody, IRExpr, IRModule, Stage } from "../ir/types";
import { MAIN_BODY, sourceKey } from "../ir/types";
import { operandsOf, reachableMask } from "../ir/walk";
import { componentCount, isOpaque, isTextureType } from "../types/shaderType";
import { VARYING_INPUTS, findHoistCandidates, fragmentView } from "../opt/hoist";
import { isLutUv } from "../opt/sampleRules";
import { sampleDependence } from "./cost";

/** Rough ALU cost per scalar component (a GPU-agnostic estimate, NOT a profiler number). */
const INTRINSIC_COST: Record<string, number> = {
  sin: 4,
  cos: 4,
  tan: 6,
  asin: 6,
  acos: 6,
  atan: 6,
  atan2: 8,
  pow: 5,
  exp: 3,
  exp2: 2,
  log: 3,
  log2: 2,
  sqrt: 2,
  inversesqrt: 1,
  abs: 0.5,
  sign: 1,
  floor: 1,
  ceil: 1,
  fract: 1,
  round: 1,
  trunc: 1,
  mod: 3,
  min: 1,
  max: 1,
  clamp: 2,
  saturate: 0.5,
  mix: 2,
  step: 1,
  smoothstep: 4,
  radians: 1,
  degrees: 1,
  dot: 1,
  cross: 3,
  normalize: 4,
  length: 3,
  distance: 4,
  reflect: 4,
  refract: 8,
  ihash: 14,
};
const CHEAP = new Set(["const", "param", "input", "uniform", "samplerState", "textureSize"]);
const HEAVY_NODE = /noise|voronoi|fbm|fractal|cellular|simplex|worley|perlin|mandelbrot|julia/i;

interface StageStats {
  /** Estimated ALU instructions (sum over reachable expressions, vector width and function calls included). */
  instructions: number;
  textureSamples: number;
  derivatives: number;
  expressions: number;
}
interface UniformStats {
  count: number;
  textures: number;
  /** vec4 slots when the value uniforms are packed. */
  vec4Slots: number;
}
interface HintItem {
  id:
    | "pow-const"
    | "lut-lod0"
    | "dependent-read"
    | "channel-packing"
    | "many-samples"
    | "heavy-noise"
    | "deriv-in-loop"
    | "many-interpolators"
    | "div-const"
    | "unoptimised-constants"
    | "heavy-fragment"
    | "vertex-hoist";
  severity: "info" | "warning";
  message: string;
  nodeIds: string[];
}
export interface ShaderStats {
  vertex: StageStats;
  fragment: StageStats;
  uniforms: UniformStats;
  /** Distinct vertex→fragment interpolators (estimate from the built-in inputs the fragment reads). */
  interpolators: number;
  customFunctions: number;
  hints: HintItem[];
}

function exprCost(e: IRExpr, fnCost: (id: string) => StageStats): { alu: number; tex: number; deriv: number } {
  const n = Math.max(1, componentCount(e.ty));
  switch (e.op) {
    case "binary":
      return { alu: e.kind === "div" ? 4 * n : n, tex: 0, deriv: 0 };
    case "unary":
      return { alu: 0.5 * n, tex: 0, deriv: 0 };
    case "intrinsic":
      return {
        alu: (INTRINSIC_COST[e.fn] ?? 2) * (["dot", "length", "distance", "normalize", "cross"].includes(e.fn) ? 1 : n),
        tex: 0,
        deriv: 0,
      };
    case "select":
      return { alu: n, tex: 0, deriv: 0 };
    case "matmul":
      return { alu: n * 4, tex: 0, deriv: 0 };
    case "sample":
      return { alu: 0, tex: 1, deriv: 0 };
    case "deriv":
      return { alu: 2 * n, tex: 0, deriv: 1 };
    case "call": {
      const f = fnCost(e.fn);
      return { alu: f.instructions, tex: f.textureSamples, deriv: f.derivatives };
    }
    case "custom":
      return { alu: 10, tex: 0, deriv: 0 };
    case "construct":
    case "swizzle":
    case "cast":
      return { alu: 0.25, tex: 0, deriv: 0 };
    case "engine":
      return { alu: 4, tex: 0, deriv: 0 };
    default:
      return { alu: CHEAP.has(e.op) ? 0 : 1, tex: 0, deriv: 0 };
  }
}

/**
 * Static statistics + heuristic hints of a compiled module. `defIdOf` maps a graph node id to its node-definition id (noise detection).
 * Everything is derived from the IR (target independent); per-target facts (emitted lines …) come from the generated files in the UI.
 */
export function analyzeModule(
  m: IRModule,
  opts: { defIdOf?: (nodeId: string) => string | undefined; optimized?: boolean } = {},
): ShaderStats {
  const fnStats = new Map<string, StageStats>();
  const fnById = new Map(m.functions.map((f) => [f.id, f]));
  const fnCost = (id: string): StageStats => {
    const hit = fnStats.get(id);
    if (hit) return hit;
    fnStats.set(id, { instructions: 0, textureSamples: 0, derivatives: 0, expressions: 0 }); // recursion guard
    const f = fnById.get(id);
    const s = f
      ? bodyStats(f.body, f.ret, fnCost)
      : { instructions: 0, textureSamples: 0, derivatives: 0, expressions: 0 };
    fnStats.set(id, s);
    return s;
  };
  const roots = (stage: Stage): ExprId[] => m.outputs.filter((o) => o.stage === stage).map((o) => o.value);
  const hoisted = (m.hoist ?? []).filter((id) => m.main.exprs[id] !== undefined);
  const fv = fragmentView(m);
  const vertex = bodyStats(m.main, [...roots("vertex"), ...hoisted], fnCost);
  const fragment = bodyStats(fv.main, roots("fragment"), fnCost);

  const fmask = reachableMask(fv.main, roots("fragment"));
  const varyings = new Set<string>();
  fv.main.exprs.forEach((e, i) => {
    if (fmask[i] && e.op === "input" && VARYING_INPUTS.has(e.input)) varyings.add(`${e.input}:${e.space ?? ""}`);
  });
  for (const id of hoisted) if (fmask[id]) varyings.add(`hoist#${id}`);

  const tex = m.uniforms.filter((u) => isOpaque(u.ty));
  const comps = m.uniforms.filter((u) => !isOpaque(u.ty)).map((u) => Math.max(1, componentCount(u.ty)));
  const uniforms: UniformStats = {
    count: m.uniforms.length,
    textures: m.uniforms.filter((u) => isTextureType(u.ty)).length,
    vec4Slots: Math.ceil(comps.reduce((s, c) => s + c, 0) / 4),
  };
  void tex;

  const hints = buildHints(m, fragment, varyings.size, fmask, opts);
  return {
    vertex,
    fragment,
    uniforms,
    interpolators: varyings.size,
    customFunctions: m.customBlocks.length + m.functions.filter((f) => f.native !== undefined).length,
    hints,
  };
}

function bodyStats(body: IRBody, rootIds: readonly ExprId[], fnCost: (id: string) => StageStats): StageStats {
  const mask = reachableMask(body, rootIds);
  const s: StageStats = { instructions: 0, textureSamples: 0, derivatives: 0, expressions: 0 };
  body.exprs.forEach((e, i) => {
    if (!mask[i]) return;
    const c = exprCost(e, fnCost);
    s.instructions += c.alu;
    s.textureSamples += c.tex;
    s.derivatives += c.deriv;
    if (!CHEAP.has(e.op)) s.expressions++;
  });
  s.instructions = Math.round(s.instructions * 10) / 10;
  return s;
}

function buildHints(
  m: IRModule,
  fragment: StageStats,
  interpolators: number,
  fmask: Uint8Array,
  opts: { defIdOf?: ((id: string) => string | undefined) | undefined; optimized?: boolean },
): HintItem[] {
  const hints: HintItem[] = [];
  const nodesOf = (ids: ExprId[]): string[] =>
    [...new Set(ids.map((i) => m.sourceMap[sourceKey(MAIN_BODY, i)]?.nodeId).filter((x): x is string => !!x))].sort();
  const ex = m.main.exprs;

  const powIds: ExprId[] = [];
  const divIds: ExprId[] = [];
  const derivIds: ExprId[] = [];
  const sampleIds: ExprId[] = [];
  ex.forEach((e, i) => {
    if (!fmask[i]) return;
    if (e.op === "intrinsic" && e.fn === "pow") {
      const k = ex[e.args[1]!];
      if (k?.op === "const" && k.value.every((v) => [2, 3, 4, 0.5, 1, 0].includes(v))) powIds.push(i);
    }
    if (e.op === "binary" && e.kind === "div" && ex[e.b]?.op === "const") divIds.push(i);
    if (e.op === "deriv") derivIds.push(i);
    if (e.op === "sample") sampleIds.push(i);
  });
  if (powIds.length)
    hints.push({
      id: "pow-const",
      severity: "info",
      message: `${powIds.length} pow() with a small constant exponent — x*x / sqrt(x) is cheaper (optimisation level 2 does this automatically).`,
      nodeIds: nodesOf(powIds),
    });
  if (divIds.length)
    hints.push({
      id: "div-const",
      severity: "info",
      message: `${divIds.length} division(s) by a constant — multiply by the reciprocal instead.`,
      nodeIds: nodesOf(divIds),
    });
  const done = new Set(m.hoist ?? []);
  const hoist = findHoistCandidates(m).filter((id) => !done.has(id));
  if (hoist.length)
    hints.push({
      id: "vertex-hoist",
      severity: "info",
      message: `${hoist.length} per-pixel expression(s) are affine in an interpolated input (e.g. UV × tiling + offset) — computing them in the vertex stage gives identical results with less fragment work (Preferences → Vertex hoisting). On very dense meshes per-vertex work can outweigh the saving.`,
      nodeIds: nodesOf(hoist),
    });
  const lutIds = sampleIds.filter((i) => {
    const e = ex[i]!;
    return e.op === "sample" && e.mode === "implicit" && isLutUv(e.uv, (id) => ex[id]!);
  });
  if (lutIds.length)
    hints.push({
      id: "lut-lod0",
      severity: "info",
      message: `${lutIds.length} implicit-LOD texture read(s) look like 1-D LUT / gradient lookups — reading mip 0 explicitly removes the derivative cost and mip artefacts (optimisation level 2 does this; make sure the LUT has no mips).`,
      nodeIds: nodesOf(lutIds),
    });
  const dep = sampleDependence(m.main);
  const depIds = sampleIds.filter((i) => {
    const e = ex[i]!;
    return e.op === "sample" && [e.uv, e.lod, e.ddx, e.ddy].some((o) => o !== undefined && dep[o]);
  });
  if (depIds.length)
    hints.push({
      id: "dependent-read",
      severity: "info",
      message: `${depIds.length} dependent texture read(s) (the coordinate comes from another texture sample) — they defeat prefetching on mobile GPUs; consider baking the warp or packing the channels into one texture.`,
      nodeIds: nodesOf(depIds),
    });
  const byUv = new Map<ExprId, Set<ExprId>>();
  for (const i of sampleIds) {
    const e = ex[i]!;
    if (e.op === "sample") byUv.set(e.uv, (byUv.get(e.uv) ?? new Set()).add(e.tex));
  }
  const packable = sampleIds.filter((i) => {
    const e = ex[i]!;
    return e.op === "sample" && (byUv.get(e.uv)?.size ?? 0) >= 2;
  });
  if (packable.length)
    hints.push({
      id: "channel-packing",
      severity: "info",
      message: `${packable.length} samples read different textures with the same UV — packing their channels (R / G / B / A) into one texture saves ${packable.length - new Set(packable.map((i) => (ex[i] as { uv: ExprId }).uv)).size} sample(s) per pixel.`,
      nodeIds: nodesOf(packable),
    });
  if (fragment.textureSamples > 8)
    hints.push({
      id: "many-samples",
      severity: "warning",
      message: `${fragment.textureSamples} texture samples in the fragment stage (mobile budgets are usually ≤ 8).`,
      nodeIds: nodesOf(sampleIds),
    });
  if (interpolators > 8)
    hints.push({
      id: "many-interpolators",
      severity: "warning",
      message: `${interpolators} interpolators — some mobile GPUs expose only 8 varying vec4.`,
      nodeIds: [],
    });
  if (fragment.instructions > 400)
    hints.push({
      id: "heavy-fragment",
      severity: "warning",
      message: `Fragment stage estimated at ~${Math.round(fragment.instructions)} ALU instructions.`,
      nodeIds: [],
    });

  // Heavy procedural nodes (noise family): reachable nodes by definition id.
  if (opts.defIdOf) {
    const heavy = new Set<string>();
    const seen = new Set<string>();
    ex.forEach((_, i) => {
      if (!fmask[i]) return;
      const id = m.sourceMap[sourceKey(MAIN_BODY, i)]?.nodeId;
      if (!id || seen.has(id)) return;
      seen.add(id);
      if (HEAVY_NODE.test(opts.defIdOf!(id) ?? "")) heavy.add(id);
    });
    if (heavy.size >= 3)
      hints.push({
        id: "heavy-noise",
        severity: "warning",
        message: `${heavy.size} noise / fractal nodes in one shader — consider baking to a texture.`,
        nodeIds: [...heavy].sort(),
      });
    // Derivatives fed by loop-based nodes (fractals, fbm): unstable at pixel quads.
    const loopy = derivIds.filter((d) => {
      const stack = [d];
      const visited = new Set<number>();
      while (stack.length) {
        const cur = stack.pop()!;
        if (visited.has(cur)) continue;
        visited.add(cur);
        const id = m.sourceMap[sourceKey(MAIN_BODY, cur)]?.nodeId;
        if (cur !== d && id && /fractal|fbm|mandelbrot|julia|voronoi/i.test(opts.defIdOf!(id) ?? "")) return true;
        stack.push(...operandsOf(ex[cur]!));
      }
      return false;
    });
    if (loopy.length)
      hints.push({
        id: "deriv-in-loop",
        severity: "warning",
        message:
          "Derivatives (ddx / ddy / fwidth) of a loop-based node (fractal / fbm / voronoi) can be unstable across a pixel quad.",
        nodeIds: nodesOf(loopy),
      });
  }
  if (opts.optimized === false) {
    const consts = ex.filter(
      (e, i) =>
        fmask[i] &&
        ["binary", "intrinsic", "construct"].includes(e.op) &&
        operandsOf(e).length > 0 &&
        operandsOf(e).every((o) => ex[o]!.op === "const"),
    ).length;
    if (consts)
      hints.push({
        id: "unoptimised-constants",
        severity: "info",
        message: `${consts} constant expression(s) are evaluated at runtime — enable optimisation (Preferences → Optimisation level 1+).`,
        nodeIds: [],
      });
  }
  return hints;
}
