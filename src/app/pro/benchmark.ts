import { isTextureType } from "@/core/types/shaderType";
import {
  type CompileOptions,
  type CompileResult,
  type Graph,
  type OptLevel,
  type HoistMode,
  type PrecisionMode,
  compileToGlsl,
  getDefaultHoistMode,
  getDefaultOptLevel,
} from "@/core";
import { benchShader, type BenchResult } from "@/webgl/gpuBench";
import type { UniformSetter } from "@/webgl/gpuRunner";
import { createEmulation } from "@/preview/emulation";
import { effectiveTarget, getSim } from "@/preview/sceneSim";

/**
 * A/B compare variants of the GPU benchmark . Each variant is the SAME graph compiled with different optimisation
 * options; the first one ("current") is the baseline every other row is compared to.
 */
export interface BenchVariant {
  id: string;
  label: string;
  /** Compile-option overrides relative to the app's current settings. */
  options: { optimize?: OptLevel; hoist?: HoistMode; precision?: PrecisionMode };
  /** Variants that cannot differ from "current" on this graph are still run: the table then shows ×1.00 honestly. */
  hint: string;
}
export const BENCH_VARIANTS: readonly BenchVariant[] = [
  {
    id: "current",
    label: "Current settings",
    options: {},
    hint: "Optimisation level, hoisting and graph precision exactly as configured.",
  },
  {
    id: "opt0",
    label: "Optimisation L0 (off)",
    options: { optimize: 0 },
    hint: "No folding / CSE / DCE — what a naive exporter would emit.",
  },
  { id: "opt1", label: "Optimisation L1 (safe)", options: { optimize: 1 }, hint: "Exact optimisations only." },
  {
    id: "opt2",
    label: "Optimisation L2 (fast-math)",
    options: { optimize: 2 },
    hint: "Adds rewrites that may differ in the last bits.",
  },
  {
    id: "float",
    label: "Full precision (float)",
    options: { precision: "full" },
    hint: "Every value float. Desktop GPUs usually ignore mediump / half, so half vs float often shows ×1.00 here — the gain is on mobile GPUs.",
  },
  {
    id: "half",
    label: "Half precision (Half)",
    options: { precision: "half" },
    hint: "Eligible bounded temporaries declared mediump. See the same caveat as above.",
  },
  {
    id: "hoist-off",
    label: "Vertex hoisting off",
    options: { hoist: "off" },
    hint: "Per-pixel evaluation of affine expressions. Needs a mesh-dependent comparison: a full-screen triangle has only 3 vertices.",
  },
  {
    id: "hoist-on",
    label: "Vertex hoisting aggressive",
    options: { hoist: "aggressive" },
    hint: "Affine expressions evaluated per vertex (identical image).",
  },
];

export interface BenchRow {
  variant: BenchVariant;
  result: BenchResult;
  /** msPerPass / baseline msPerPass (1 = same). */ ratio: number | null;
}

/** Compile one variant to a runnable GLSL pair (preview semantics: purpose "preview", simulated target, no preview-surface block). */
function compileVariant(graph: Graph, v: BenchVariant): CompileResult & { vs: string; fs: string } {
  const sim = getSim();
  const target = effectiveTarget(sim);
  const opts: CompileOptions & { glsl: { emulation: ReturnType<typeof createEmulation> } } = {
    glsl: { emulation: createEmulation(target, { depthTexture: sim.depthTexture, opaqueTexture: sim.opaqueTexture }) },
    isPreview: true,
    purpose: "preview",
    sceneTarget: target,
    optimize: v.options.optimize ?? getDefaultOptLevel(),
    hoist: v.options.hoist ?? getDefaultHoistMode(),
    ...(v.options.precision ? { precision: v.options.precision } : {}),
  };
  const r = compileToGlsl(graph, opts);
  return {
    ...r,
    vs: r.files.find((f) => f.path === "shader.vert")?.content ?? "",
    fs: r.files.find((f) => f.path === "shader.frag")?.content ?? "",
  };
}

/** Uniform setter writing every exposed value property's DEFAULT (so alpha-clip / early-out paths behave like the material would). */
function propertyDefaults(graph: Graph, r: CompileResult): UniformSetter {
  return (gl, loc) => {
    for (const b of r.uniformBindings ?? []) {
      const p = graph.properties.find((x) => x.id === b.propId);
      const l = loc(b.name);
      if (!p || !l || isTextureType(b.ty) || b.ty === "sampler") continue;
      const d = p.default;
      const arr = Array.isArray(d) ? d : [typeof d === "boolean" ? (d ? 1 : 0) : (d ?? 0)];
      if (b.ty === "int" || b.ty === "bool") gl.uniform1i(l, Number(arr[0] ?? 0));
      else if (b.ty === "float") gl.uniform1f(l, Number(arr[0] ?? 0));
      else if (b.ty === "vec2") gl.uniform2f(l, arr[0] ?? 0, arr[1] ?? 0);
      else if (b.ty === "vec3") gl.uniform3f(l, arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0);
      else if (b.ty === "vec4") gl.uniform4f(l, arr[0] ?? 0, arr[1] ?? 0, arr[2] ?? 0, arr[3] ?? 1);
    }
  };
}

/** Relative cost of every row against the first (baseline) row; failed rows get `null`. */
function withRatios(rows: ReadonlyArray<{ variant: BenchVariant; result: BenchResult }>): BenchRow[] {
  const base = rows[0]?.result.ok ? rows[0].result.msPerPass : 0;
  return rows.map((r) => ({ ...r, ratio: base > 0 && r.result.ok ? r.result.msPerPass / base : null }));
}

export interface BenchRun {
  size: number;
  passes: number;
  samples: number;
  ids: readonly string[];
  onProgress?: (done: number, total: number) => void;
}

/** Run the selected variants one after another (always including the baseline). */
export async function runBenchmark(graph: Graph, run: BenchRun): Promise<BenchRow[]> {
  const chosen = BENCH_VARIANTS.filter((v) => v.id === "current" || run.ids.includes(v.id));
  const rows: Array<{ variant: BenchVariant; result: BenchResult }> = [];
  for (const [i, variant] of chosen.entries()) {
    run.onProgress?.(i, chosen.length);
    const c = compileVariant(graph, variant);
    const result: BenchResult =
      c.ok && c.vs && c.fs
        ? await benchShader({
            vertex: c.vs,
            fragment: c.fs,
            size: run.size,
            passes: run.passes,
            samples: run.samples,
            setUniforms: propertyDefaults(graph, c),
          })
        : {
            ok: false,
            log:
              c.diagnostics
                .filter((d) => d.severity === "error")
                .map((d) => d.message)
                .join("; ") || "compile failed",
            msPerPass: 0,
            method: "fenced",
            reliable: false,
            samples: [],
            size: run.size,
          };
    rows.push({ variant, result });
  }
  run.onProgress?.(chosen.length, chosen.length);
  return withRatios(rows);
}
