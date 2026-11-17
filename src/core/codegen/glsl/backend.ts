import type { Backend, EmitOptions, EmitResult } from "../../compile/backend";
import { BACKEND_TRAITS } from "../../ir/traits";
import { type ExprId, type IRModule, MAIN_BODY, sourceKey } from "../../ir/types";
import type { ProfileDef } from "../../registry/profile";
import { type UniformEntry, layoutUniforms } from "../base/layout";
import { Namer, snakeCase } from "../base/names";
import { type StagePlan, planStages } from "../base/stageSplit";
import { CodeWriter } from "../base/writer";
import { ATTRIBUTE_ORDER, BUILTIN_UNIFORM_ORDER } from "./builtins";
import { backendDiagnostics } from "../dialect/diagnostics";
import { BodyEmitter } from "../dialect/emitter";
import { describeInputWith } from "../dialect/inputs";
import { makeGlslDialect } from "./dialect";
import { type GlslSlots, mapSlots } from "./profileMap";
import type { GlslEmulation } from "./emulation";
import { SURFACE_FIELD_TYPE, mapSurfaceSlots, surfaceDeclaration } from "./surface";
import { assembleShader } from "./shaderText";
import { type SharedGen, StageState } from "./stageGen";
import { glslSyntax } from "./syntax";
import { samplerStatesOf } from "./samplerStates";
import { withTilingUniforms } from "./tiling";

/** Options understood by `glslBackend.emit` (all optional). */
export interface GlslEmitOptions {
  /** graph node id → label, used to name temporaries after the node that produced them. */
  labels?: Record<string, string>;
  /** Graph node ids whose values are evaluated in the vertex stage and interpolated ("evaluate in vertex" hint). */
  interpolate?: string[];
  /** `"preview"`: also write all master blocks into `KsSurface ks_surf` (Kekenik Shader preview only; the Code panel never sets it). */
  surface?: "export" | "preview";
  /** Preview-only emulation of engine intrinsics (see `GlslEmulation`). Also turns unsupported intrinsics into warnings. */
  emulation?: GlslEmulation;
  /** Preview-only fp16 emulation : temporaries the precision pass marked `half` are rounded to binary16 so banding / precision artefacts are visible on desktop GPUs. */
  emulateHalf?: boolean;
}

const FRAG_OUT = "ks_FragColor";

function makeShared(
  module: IRModule,
  labels: Map<string, string>,
  emulation?: GlslEmulation,
  emulateHalf = false,
): { shared: SharedGen; uniforms: UniformEntry[] } {
  const namer = new Namer("glsl");
  for (const n of [...BUILTIN_UNIFORM_ORDER, ...ATTRIBUTE_ORDER, FRAG_OUT, "main"]) namer.reserve(n);
  const { uniforms, tiling } = withTilingUniforms(layoutUniforms(module, "glsl", namer), namer);
  const fnNames = new Map<string, string>();
  const fnReturns = new Map<string, import("../../types/shaderType").StorageType[]>();
  for (const f of module.functions) {
    fnNames.set(f.id, namer.fresh(`sg_${snakeCase(f.name) || "fn"}`, "fn"));
    fnReturns.set(
      f.id,
      f.returns.map((r) => r.ty),
    );
  }
  const dialect = makeGlslDialect({ tiling, previewSampler: emulation !== undefined });
  const shared: SharedGen = {
    module,
    traits: BACKEND_TRAITS.glsl,
    dialect,
    namer,
    uniforms: new Map(uniforms.map((u) => [u.prop, u])),
    fnNames,
    fnReturns,
    labels,
    warnings: new Set(),
    unsupported: [],
    emulation,
    emulateHalf,
  };
  return { shared, uniforms };
}

const refOf = (module: IRModule, id: ExprId) => module.sourceMap[sourceKey(MAIN_BODY, id)];

function genFragment(
  sh: SharedGen,
  plan: StagePlan,
  slots: GlslSlots,
  interpNames: Map<ExprId, string>,
  surface = false,
) {
  const module = sh.module;
  const st = new StageState(sh, "fragment");
  const set = plan.fragment;
  const body = new CodeWriter();
  const be = new BodyEmitter({
    dialect: sh.dialect,
    body: module.main,
    bodyId: MAIN_BODY,
    order: set.order,
    uses: set.uses,
    namer: sh.namer.child(),
    w: body,
    overrides: interpNames,
    svc: st.services(),
    ...(module.half ? { half: new Set(module.half) } : {}),
    ...(sh.emulateHalf ? { emulateHalf: true } : {}),
  });
  be.emitStatements();

  const out = (rhs: string, id?: ExprId) =>
    body.line(`${FRAG_OUT} = ${rhs};`, id === undefined ? undefined : refOf(module, id));
  if (slots.color !== undefined) {
    if (slots.alphaClip !== undefined) {
      const color = sh.namer.child().fresh("color");
      body.line(sh.dialect.declare("vec4", color, be.bare(slots.color)), refOf(module, slots.color));
      for (const l of sh.dialect.discardIf(`${color}.a < ${be.bare(slots.alphaClip)}`))
        body.line(l, refOf(module, slots.alphaClip));
      out(color);
    } else out(be.bare(slots.color), slots.color);
  } else if (slots.rgb !== undefined) {
    const rgba = `vec4(${be.bare(slots.rgb)}, ${slots.alpha !== undefined ? be.bare(slots.alpha) : "1.0"})`;
    if (slots.alphaClip !== undefined) {
      // Engine profiles (unity.*): Alpha Clip Threshold only exists while its option is on (MasterBlock.shownWhen).
      const color = sh.namer.child().fresh("color");
      body.line(sh.dialect.declare("vec4", color, rgba), refOf(module, slots.rgb));
      for (const l of sh.dialect.discardIf(`${color}.a < ${be.bare(slots.alphaClip)}`))
        body.line(l, refOf(module, slots.alphaClip));
      out(color);
    } else out(rgba, slots.rgb);
  } else out("vec4(1.0)");
  if (surface) {
    // Preview surface contract: colour / alpha come from the (already clipped) colour output, every other block from its own slot.
    body.line(`ks_surf.baseColor = ${FRAG_OUT}.rgb; ks_surf.alpha = ${FRAG_OUT}.a;`);
    for (const [field, id] of Object.entries(mapSurfaceSlots(module)) as Array<
      [keyof typeof SURFACE_FIELD_TYPE, ExprId]
    >) {
      body.line(`ks_surf.${field} = ${be.bare(id)};`, refOf(module, id));
      if (field === "normalTS") body.line("ks_surf.hasNormal = 1.0;");
    }
  }
  const functions = st.neededFunctions(set.order).map((f) => st.emitFunction(f));
  return { st, body, functions };
}

function genVertex(
  sh: SharedGen,
  plan: StagePlan,
  slots: GlslSlots,
  frag: ReturnType<typeof genFragment>,
  interpNames: Map<ExprId, string>,
) {
  const module = sh.module;
  const st = new StageState(sh, "vertex");
  const set = plan.vertex;
  const bodyW = new CodeWriter();
  const be = new BodyEmitter({
    dialect: sh.dialect,
    body: module.main,
    bodyId: MAIN_BODY,
    order: set.order,
    uses: set.uses,
    namer: sh.namer.child(),
    w: bodyW,
    svc: st.services(),
  });
  be.emitStatements();

  const tail = new CodeWriter();
  st.use.attrs.add("a_position");
  let pos = "a_position";
  if (slots.vertexOffset !== undefined || slots.vertexPosition !== undefined) {
    pos = sh.namer.child().fresh("displaced_position");
    const rhs =
      slots.vertexOffset !== undefined ? `a_position + ${be.bare(slots.vertexOffset)}` : be.bare(slots.vertexPosition!);
    tail.line(sh.dialect.declare("vec3", pos, rhs), refOf(module, (slots.vertexOffset ?? slots.vertexPosition)!));
  }
  for (const u of ["ks_Projection", "ks_View", "ks_Model"] as const) st.use.uniforms.add(u);
  tail.line(`gl_Position = ks_Projection * ks_View * ks_Model * vec4(${pos}, 1.0);`);
  const varyings: Array<{ name: string; ty: import("../../types/shaderType").StorageType }> = [];
  for (const v of [...frag.st.varyings.values()].sort((a, b) => a.name.localeCompare(b.name))) {
    const d = describeInputWith(glslSyntax, v.input, v.space);
    if (d.usesPosition) st.use.attrs.add("a_position");
    tail.line(`${v.name} = ${d.vertex(d.usesPosition ? pos : "a_position", st.use)};`);
    varyings.push({ name: v.name, ty: v.ty });
  }
  for (const [id, name] of interpNames) {
    tail.line(`${name} = ${be.bare(id)};`, refOf(module, id));
    varyings.push({ name, ty: module.main.exprs[id]!.ty });
  }

  // Derived-input globals are discovered while emitting (and while building the varying expressions): assign them first.
  const main = new CodeWriter();
  for (const g of st.globals.values()) main.line(`${g.name} = ${g.expr};`);
  main.append(bodyW).append(tail);
  const functions = st.neededFunctions(set.order).map((f) => st.emitFunction(f));
  return { st, main, functions, varyings };
}

function emit(module: IRModule, profile: ProfileDef, options: EmitOptions): EmitResult {
  const opts = options as GlslEmitOptions;
  const labels = new Map(Object.entries(opts.labels ?? {}));
  const slots = mapSlots(module);
  const plan = planStages(module, { interpolateNodes: new Set(opts.interpolate ?? []) });
  const { shared, uniforms } = makeShared(module, labels, opts.emulation, opts.emulateHalf === true);
  const surface = opts.surface === "preview";
  const samplers = samplerStatesOf(module);

  const interpName = (id: ExprId): string => {
    const ref = refOf(module, id);
    const label = ref ? labels.get(ref.nodeId) : undefined;
    return shared.namer.fresh(`v_${label ? snakeCase(label) || `interp_${id}` : `interp_${id}`}`);
  };
  const interpNames = new Map<ExprId, string>(plan.interpolated.map((id) => [id, interpName(id)]));
  const frag = genFragment(shared, plan, slots, interpNames, surface);
  const vert = genVertex(shared, plan, slots, frag, interpNames);

  // Fragment varyings = input varyings + interpolated values (types known from the vertex side).
  const fragVaryings = [...frag.st.varyings.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((v) => ({ name: v.name, ty: v.ty }));
  for (const [id, name] of interpNames) fragVaryings.push({ name, ty: module.main.exprs[id]!.ty });

  const vs = assembleShader({
    stage: "vertex",
    profileName: profile.name,
    st: vert.st,
    uniforms,
    varyings: vert.varyings,
    functions: vert.functions,
    main: vert.main,
  });
  const fs = assembleShader({
    stage: "fragment",
    profileName: profile.name,
    st: frag.st,
    uniforms,
    varyings: fragVaryings,
    functions: frag.functions,
    main: frag.body,
    fragOutName: FRAG_OUT,
    ...(surface ? { extra: surfaceDeclaration(["unlit", "sprite", "vfx"].includes(profile.family)) } : {}),
  });
  return {
    files: [
      { path: "shader.vert", content: vs.text, language: "glsl" },
      { path: "shader.frag", content: fs.text, language: "glsl" },
    ],
    diagnostics: backendDiagnostics(
      shared.warnings,
      shared.unsupported,
      BACKEND_TRAITS.glsl.displayName,
      opts.emulation !== undefined,
    ),
    sourceLines: { "shader.vert": vs.table, "shader.frag": fs.table },
    uniformBindings: uniforms.map((u) => ({
      propId: u.prop,
      name: u.name,
      ty: u.ty,
      ...(samplers.has(u.prop) ? { sampler: samplers.get(u.prop)! } : {}),
    })),
  };
}

/** GLSL ES 3.00 (WebGL2) backend. Produces `shader.vert` + `shader.frag`. */
export const glslBackend: Backend = { id: "glsl", traits: BACKEND_TRAITS.glsl, emit };
