import { type SceneTarget, sceneTargetOf } from "../engine/targets";
import { irPrinterBackend } from "../backends/irPrinter";
import { type Diagnostic, hasErrors, makeDiagnostic } from "../diagnostics";
import type { Graph, GraphBody } from "../graph/types";
import { DEF_SUBGRAPH } from "../graph/types";
import { SUBGRAPH_PARAM } from "../graph/subgraph";
import { checkStageLegality } from "../ir/stages";
import { type BackendId, type IRModule, sourceKey } from "../ir/types";
import { defaultNodeRegistry } from "../nodes";
import { defaultProfileRegistry } from "../profiles";
import { type ParameterManifestEntry, buildParameterManifest } from "../properties/manifest";
import type { NodeRegistry, ProfileRegistry } from "../registry/registry";
import type { ProfileDef } from "../registry/profile";
import type { LineEntry } from "../codegen/base/writer";
import type { Backend, EmitOptions, EmitResult, IRPass, OutputFile, UniformBinding } from "./backend";
import { buildModule } from "./build";
import type { KeywordValues } from "../properties/keywords";
import { lowerCustomBlocks } from "../custom/lower";
import {
  type HoistMode,
  type HoistPlan,
  type OptLevel,
  type OptReport,
  type PrecisionMode,
  type PrecisionReport,
  applyHoist,
  applyPrecision,
  precisionModeOf,
  getDefaultHoistMode,
  getDefaultOptLevel,
  optimizeModuleWithReport,
} from "../opt";
import { globalChecks } from "./globalChecks";
import { forcedInterpolateNodes, interpolatorWarnings } from "./interpolators";
import { readNodeOverrides } from "./nodeOverrides";
import { checkNodeStages } from "./nodeStages";
import { type BodyAnalysis, analyzeBody } from "./infer";

/** See `CompileOptions.purpose`. */
type CompilePurpose = "export" | "preview";

const purposeOf = (o: Pick<CompileOptions, "purpose" | "isPreview">): CompilePurpose =>
  o.purpose ?? (o.isPreview === true ? "preview" : "export");

/** Ids of the subgraph definitions instantiated (directly or through other subgraphs) by nodes the master / output depends on. */
function usedSubgraphIds(analysis: { main: BodyAnalysis; subgraphs: Record<string, BodyAnalysis> }): string[] {
  const used = new Set<string>();
  const visit = (a: BodyAnalysis): void => {
    for (const id of a.reachable) {
      const n = a.flat.nodes[id];
      const sid = n?.defId === DEF_SUBGRAPH ? n.params[SUBGRAPH_PARAM] : undefined;
      if (typeof sid !== "string" || used.has(sid)) continue;
      used.add(sid);
      const sub = analysis.subgraphs[sid];
      if (sub) visit(sub);
    }
  };
  visit(analysis.main);
  return [...used];
}

export interface CompileOptions {
  registry?: NodeRegistry;
  profiles?: ProfileRegistry;
  /** Default: the text IR printer. */
  backend?: Backend;
  emitOptions?: EmitOptions;
  /** IR passes run (in order) between build and emit. Default: none. */
  passes?: IRPass[];
  /** Stop after IR construction. */
  skipEmit?: boolean;
  /** Keyword variant to build (keyword id → value). Missing keywords use their default. */
  keywordValues?: KeywordValues;
  /** Keep keywords as runtime selectors (real shader variants); the Unity backend sets this. Default: bake. */
  runtimeKeywords?: boolean;
  /** Simulated compile-time target for Target Switch / Is-Reversed-Z / … (default: the backend's own id; the IR printer behaves like glsl). . */
  sceneTarget?: SceneTarget;
  /** The shader is being compiled for the Kekenik Shader preview viewport (Is Preview). . */
  isPreview?: boolean;
  /**
   * Why the compile is run . `export` (default): node availability is checked against the export backend — what the
   * user will get on disk. `preview`: the shader only has to RUN in the Kekenik Shader preview, so availability is checked against the
   * ACTIVE TARGET FAMILY (`sceneTarget`) and engine intrinsics the preview cannot emulate become `W_PREVIEW_NOT_EMULATED` warnings.
   * Default: `preview` when `isPreview` is set, else `export`.
   */
  purpose?: CompilePurpose;
  /** IR optimisation level: 0 off, 1 safe (fold / identities / CSE / DCE), 2 fast-math. Default: `getDefaultOptLevel` . */
  optimize?: OptLevel;
  /**
   * Vertex hoisting aggressiveness : `off` | `conservative` | `aggressive`. Default: `getDefaultHoistMode` (core default `off`).
   * Affine per-pixel expressions move to the vertex stage and are interpolated — identical image, less fragment work. Thumbnails pass `off`.
   */
  hoist?: HoistMode;
  /** Graph node ids that must stay per-pixel even when hoisting is on (per-node override "Evaluate in Fragment"). */
  hoistExclude?: ReadonlySet<string>;
  /**
   * Precision control : `full` | `auto` | `half`. Default: the graph's `settings.precision` ("half" | "auto", else full).
   * Thumbnails pass `full`. The pass marks fragment-stage temporaries in `IRModule.half`; backends spell them `half` / `mediump` / `min16float`.
   */
  precision?: PrecisionMode;
  /** Per-node precision overrides (graph node ids): forced to half / forced to float. */
  halfNodes?: ReadonlySet<string>;
  floatNodes?: ReadonlySet<string>;
  /** Mobile-aggressive precision: UV cones feeding texture samples may be demoted. Default: the graph's `settings.precisionAggressive`. */
  precisionAggressive?: boolean;
  /** Ignore Custom Interpolator nodes (thumbnails show the per-pixel value of a node). */
  ignoreInterpolators?: boolean;
}

export interface GraphAnalysis {
  diagnostics: Diagnostic[];
  profile?: ProfileDef;
  main: BodyAnalysis;
  subgraphs: Record<string, BodyAnalysis>;
}

export interface CompileResult {
  /** No error-severity diagnostics. */
  ok: boolean;
  diagnostics: Diagnostic[];
  module?: IRModule;
  files: OutputFile[];
  /** Generated line → graph node tables from the backend (when it provides them). */
  sourceLines?: Record<string, LineEntry[]>;
  /** Named jump targets per file (vertex / fragment entry points of single-file backends). */
  sections?: Record<string, Array<{ label: string; line: number }>>;
  /** Property id → uniform name table of the emitted shader (when the backend provides it). */
  uniformBindings?: UniformBinding[];
  /** Engine-profile problems reported by the backend (Unity validators run on top of these). */
  problems?: NonNullable<EmitResult["problems"]>;
  parameterManifest: ParameterManifestEntry[];
  /** What the optimiser did (absent when it did not run). */
  optReport?: OptReport;
  /** Vertex-hoisting decisions when hoisting was enabled. */
  hoistPlan?: HoistPlan;
  /** Precision-inference result when precision was not `full`. */
  precisionReport?: PrecisionReport;
  /** Per-phase wall-clock milliseconds. */
  timings: { analyze: number; build: number; emit: number; total: number };
  analysis: GraphAnalysis;
}

const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Validate + infer without generating code (what the UI runs live). */
export function analyzeGraph(graph: Graph, options: CompileOptions = {}): GraphAnalysis {
  const registry = options.registry ?? defaultNodeRegistry;
  const profiles = options.profiles ?? defaultProfileRegistry;
  const diagnostics: Diagnostic[] = [...globalChecks(graph)];
  const profile = profiles.get(graph.profileId);
  if (!profile) diagnostics.push(makeDiagnostic("E_UNKNOWN_PROFILE", `Unknown profile "${graph.profileId}"`));

  const target = options.sceneTarget ?? sceneTargetOf(options.backend?.id);
  const main = analyzeBody(graph as GraphBody, { graph, registry, profile, target });
  diagnostics.push(...main.diagnostics);
  const subgraphs: Record<string, BodyAnalysis> = {};
  for (const def of Object.values(graph.subgraphDefs)) {
    const a = analyzeBody(def, { graph, scope: def.id, registry, profile, target });
    subgraphs[def.id] = a;
    diagnostics.push(...a.diagnostics);
  }
  return { diagnostics, profile, main, subgraphs };
}

/**
 * The full pipeline: Graph → flatten → infer → IR module → passes[] → Backend.emit → files + diagnostics + manifest.
 * Errors stop the pipeline before IR construction (warnings never do).
 */
export function compileGraph(graph: Graph, options: CompileOptions = {}): CompileResult {
  const t0 = now();
  const backend = options.backend ?? irPrinterBackend;
  const analysis = analyzeGraph(graph, options);
  const diagnostics = [...analysis.diagnostics];
  const manifest = buildParameterManifest(graph.properties, backend.traits.nameTarget);
  const t1 = now();
  const result = (module: IRModule | undefined, files: OutputFile[], tBuild: number, tEmit: number): CompileResult => ({
    ok: !hasErrors(diagnostics),
    diagnostics,
    module,
    files,
    parameterManifest: manifest,
    timings: { analyze: t1 - t0, build: tBuild, emit: tEmit, total: now() - t0 },
    analysis,
  });
  if (hasErrors(diagnostics) || !analysis.profile) return result(undefined, [], 0, 0);

  // Target availability of the nodes that matter.
  // export: the backend being emitted; preview: the active target family (the GLSL backend only RUNS the shader, see `purpose`).
  const availId: BackendId =
    purposeOf(options) === "preview" ? (options.sceneTarget ?? sceneTargetOf(backend.id)) : backend.id;
  const check = (a: BodyAnalysis, scope?: string) => {
    for (const id of a.reachable) {
      const t = a.info.get(id)?.def.targets;
      if (!t) continue;
      const bad =
        (t.backends && availId !== "ir" && !t.backends.includes(availId)) ||
        (t.profiles && !t.profiles.includes(analysis.profile!.id));
      if (bad)
        diagnostics.push(
          makeDiagnostic(
            "E_NODE_UNSUPPORTED_TARGET",
            `Node "${a.info.get(id)!.def.name}" is not available for ${backend.traits.displayName} / profile "${analysis.profile!.name}"`,
            { nodeId: id, ...(scope ? { scope } : {}) },
          ),
        );
    }
  };
  check(analysis.main);
  // Only subgraphs that a REACHABLE node instantiates (transitively) can influence the output — an unused definition that happens to contain a
  // target-specific node (e.g. Scene Depth) must not block the compile (same principle as `DOWNGRADABLE` in infer.ts: unreachable ⇒ no error).
  for (const id of usedSubgraphIds(analysis)) {
    const a = analysis.subgraphs[id];
    if (a) check(a, id);
  }
  diagnostics.push(...checkNodeStages(analysis.main, analysis.profile));
  if (hasErrors(diagnostics)) return result(undefined, [], 0, 0);

  const b0 = now();
  const built = buildModule({
    graph,
    profile: analysis.profile,
    main: analysis.main,
    subgraph: (id) => analysis.subgraphs[id]!,
    keywordValues: options.keywordValues,
    runtimeKeywords: options.runtimeKeywords === true,
    target: options.sceneTarget ?? sceneTargetOf(backend.id),
    isPreview: options.isPreview === true,
  });
  diagnostics.push(...built.diagnostics);
  let module = built.module;
  for (const v of checkStageLegality(module)) {
    const src = module.sourceMap[sourceKey(v.bodyId, v.exprId)];
    diagnostics.push(
      makeDiagnostic(
        "E_STAGE_VIOLATION",
        v.reason,
        src
          ? {
              nodeId: src.nodeId,
              ...(src.portId ? { portId: src.portId } : {}),
              ...(src.scope ? { scope: src.scope } : {}),
            }
          : {},
      ),
    );
  }
  if (hasErrors(diagnostics)) return result(module, [], now() - b0, 0);
  const lowered = lowerCustomBlocks(module, backend.id);
  diagnostics.push(...lowered.diagnostics);
  module = lowered.module;
  if (hasErrors(diagnostics)) return result(module, [], now() - b0, 0);
  let optReport: OptReport | undefined;
  const level = options.optimize ?? getDefaultOptLevel();
  if (level > 0) {
    const o = optimizeModuleWithReport(module, level);
    module = o.module;
    optReport = o.report;
  }
  for (const pass of options.passes ?? []) module = pass.run(module);
  // Per-node overrides stored in the graph settings (Inspector → Selection): Evaluate in Fragment / Vertex, precision Half / Float.
  // Thumbnails (`ignoreInterpolators`) pass `precision: "full"` + hoist off and never see them.
  const ov = options.ignoreInterpolators === true ? undefined : readNodeOverrides(graph);
  const hoistExclude =
    ov && ov.fragment.size > 0 ? new Set([...(options.hoistExclude ?? []), ...ov.fragment]) : options.hoistExclude;
  let hoistPlan: HoistPlan | undefined;
  const hoistMode = options.hoist ?? getDefaultHoistMode();
  if (hoistMode !== "off") {
    const h = applyHoist(module, { mode: hoistMode, ...(hoistExclude ? { exclude: hoistExclude } : {}) });
    module = h.module;
    hoistPlan = h.plan;
  }
  let precisionReport: PrecisionReport | undefined;
  const precisionMode = options.precision ?? precisionModeOf(graph.settings);
  const halfNodes = ov && ov.half.size > 0 ? new Set([...(options.halfNodes ?? []), ...ov.half]) : options.halfNodes;
  const floatNodes =
    ov && ov.float.size > 0 ? new Set([...(options.floatNodes ?? []), ...ov.float]) : options.floatNodes;
  if (precisionMode !== "full" || (halfNodes && halfNodes.size > 0 && options.precision === undefined)) {
    const p = applyPrecision(module, {
      mode: precisionMode,
      aggressive: options.precisionAggressive ?? graph.settings.precisionAggressive === true,
      ...(halfNodes ? { half: halfNodes } : {}),
      ...(floatNodes ? { float: floatNodes } : {}),
    });
    module = p.module;
    precisionReport = p.report;
  }
  const interpolate = options.ignoreInterpolators === true ? [] : forcedInterpolateNodes(graph);
  if (interpolate.length > 0) diagnostics.push(...interpolatorWarnings(graph, module));
  const t2 = now();
  if (options.skipEmit) {
    const r = result(module, [], t2 - b0, 0);
    if (optReport) r.optReport = optReport;
    if (hoistPlan) r.hoistPlan = hoistPlan;
    if (precisionReport) r.precisionReport = precisionReport;
    return r;
  }

  const e0 = now();
  try {
    const emitted = backend.emit(
      module,
      analysis.profile,
      interpolate.length > 0
        ? {
            ...options.emitOptions,
            interpolate: [
              ...new Set([
                ...((options.emitOptions as { interpolate?: string[] } | undefined)?.interpolate ?? []),
                ...interpolate,
              ]),
            ],
          }
        : (options.emitOptions ?? {}),
    );
    diagnostics.push(...emitted.diagnostics);
    const r = result(module, emitted.files, t2 - b0, now() - e0);
    if (optReport) r.optReport = optReport;
    if (hoistPlan) r.hoistPlan = hoistPlan;
    if (precisionReport) r.precisionReport = precisionReport;
    if (emitted.sourceLines) r.sourceLines = emitted.sourceLines;
    if (emitted.uniformBindings) r.uniformBindings = emitted.uniformBindings;
    if (emitted.sections) r.sections = emitted.sections;
    if (emitted.problems) r.problems = emitted.problems;
    return r;
  } catch (err) {
    if (process.env.KS_DEBUG) console.log((err as Error).stack);
    diagnostics.push(makeDiagnostic("E_BACKEND_FAILED", `Backend "${backend.id}" failed: ${(err as Error).message}`));
    return result(module, [], t2 - b0, now() - e0);
  }
}
