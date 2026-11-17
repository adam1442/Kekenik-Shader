import type { Diagnostic } from "../../diagnostics";
import type { BackendTraits } from "../../ir/traits";
import {
  type ExprId,
  type IRFunction,
  type IRModule,
  MAIN_BODY,
  type SourceRef,
  type Stage,
  sourceKey,
} from "../../ir/types";
import { isTextureType, type StorageType } from "../../types/shaderType";
import { type RefTarget, targetReferenceName } from "../../properties/names";
import { type HelperDef, HelperRegistry } from "../base/helpers";
import { Namer, snakeCase } from "../base/names";
import { type StagePlan, bodyOrderUses, neededFunctions, planStages } from "../base/stageSplit";
import { CodeWriter } from "../base/writer";
import { ATTRIBUTE_ORDER, BUILTIN_UNIFORM_ORDER } from "../glsl/builtins";
import { type GlslSlots as SlotMap, mapSlots } from "../glsl/profileMap";
import { type UnsupportedNote, backendDiagnostics, noteUnsupported } from "./diagnostics";
import { must } from "./ops";
import { emitIrFunction } from "./emitFunction";
import { BodyEmitter } from "./emitter";
import { type InputSyntax, describeInputWith } from "./inputs";
import { StageInputs } from "./stageInputs";
import { type Dialect, type DialectOptions, type DialectServices, UnsupportedError, samplerOf } from "./types";

/** A declared property uniform. `texture` and `sampler` are bindings; `value` lives in the material block. */
export interface ExplicitUniform {
  prop: string;
  ty: StorageType;
  name: string;
  property: import("../../properties/model").Property;
  kind: "value" | "texture" | "sampler";
}

/** Static sampler binding generated for an inline `samplerState` node. */
interface StaticSampler {
  name: string;
  filter: string;
  wrap: string;
}

/** Everything language-specific the generator needs besides the `Dialect`. */
export interface LangPack {
  dialect: Dialect;
  traits: BackendTraits;
  target: RefTarget;
  syntax: (opts: DialectOptions) => InputSyntax;
  helpers: readonly HelperDef[];
  /** Names that user-derived identifiers must never take. */
  reserved: readonly string[];
  /** Expression reading a property uniform. */
  uniformExpr(u: ExplicitUniform): string;
  /** Engine profiles may dictate the identifier of a property uniform (e.g. Unity `_Name`); it is reserved in the namer. */
  uniformName?(propId: string): string | undefined;
  /** Expression for an engine intrinsic (`ks.matrix.*`), or undefined when unknown. */
  engine(name: string, syntax: InputSyntax, args?: readonly string[], stage?: Stage): string | undefined;
}

class Shared {
  readonly namer: Namer;
  readonly uniforms: ExplicitUniform[];
  readonly byProp = new Map<string, ExplicitUniform>();
  /** One registry for the whole file: both stages live in one translation unit. */
  readonly helpers: HelperRegistry;
  /** Function names; functions that read stage inputs exist once per stage (`*_vs`, `*_ps`), the others once. */
  readonly fnNames = new Map<string, { common: string; vertex?: string; fragment?: string }>();
  readonly fnReturns = new Map<string, StorageType[]>();
  readonly samplers = new Map<string, StaticSampler>();
  readonly warnings = new Set<string>();
  readonly unsupported: UnsupportedNote[] = [];
  readonly syntax: InputSyntax;

  constructor(
    readonly module: IRModule,
    readonly pack: LangPack,
    readonly labels: ReadonlyMap<string, string>,
    readonly options: DialectOptions,
  ) {
    this.namer = new Namer(pack.dialect.lang);
    for (const n of [...BUILTIN_UNIFORM_ORDER, ...ATTRIBUTE_ORDER, ...pack.reserved]) this.namer.reserve(n);
    this.syntax = pack.syntax(options);
    this.helpers = new HelperRegistry(pack.helpers);
    this.uniforms = module.uniforms.map((u) => {
      const base = targetReferenceName(u.property.referenceName, pack.target);
      const given = pack.uniformName?.(u.prop);
      if (given !== undefined) this.namer.reserve(given);
      let name = given ?? this.namer.fresh(base, "u");
      const kind = isTextureType(u.ty) ? "texture" : u.ty === "sampler" ? "sampler" : "value";
      // A texture owns the identifier `<name>_sampler`: make sure nothing else can take it.
      while (given === undefined && kind === "texture" && this.namer.has(samplerOf(name)))
        name = this.namer.fresh(base, "u");
      if (kind === "texture") this.namer.reserve(samplerOf(name));
      return { prop: u.prop, ty: u.ty, name, property: u.property, kind } satisfies ExplicitUniform;
    });
    for (const u of this.uniforms) this.byProp.set(u.prop, u);
    const stageBound = new Set<string>();
    for (const f of module.functions) {
      const base = `sg_${snakeCase(f.name) || "fn"}`;
      const bound = f.body.exprs.some((e) => e.op === "input" || (e.op === "call" && stageBound.has(e.fn)));
      if (bound) stageBound.add(f.id);
      this.fnNames.set(
        f.id,
        bound
          ? {
              common: base,
              vertex: this.namer.fresh(`${base}_vs`, "fn"),
              fragment: this.namer.fresh(`${base}_ps`, "fn"),
            }
          : { common: this.namer.fresh(base, "fn") },
      );
      this.fnReturns.set(
        f.id,
        f.returns.map((r) => r.ty),
      );
    }
  }
}

/** Per-stage state: discovered inputs (see `StageInputs`), varyings, helpers; also emits subgraph functions. */
class StageState extends StageInputs {
  /** Set while the Godot `light()` body is emitted through the fragment state (the light stage reads the same varyings / helpers). */
  lightMode = false;
  constructor(
    readonly sh: Shared,
    stage: "vertex" | "fragment",
  ) {
    super(stage, sh.syntax, sh.namer);
  }

  fnName(id: string): string {
    const n = must(this.sh.fnNames.get(id), "function", id);
    return n[this.stage === "vertex" ? "vertex" : "fragment"] ?? n.common;
  }

  services(): DialectServices {
    const sh = this.sh;
    return {
      traits: sh.pack.traits,
      stage: this.stage,
      helpers: sh.helpers,
      sourceMap: sh.module.sourceMap,
      labels: sh.labels,
      options: sh.options,
      inputText: (e) => this.inputText(e.input, e.space),
      uniformText: (prop) => {
        const u = must(sh.byProp.get(prop), "uniform", prop);
        return sh.pack.uniformExpr(u);
      },
      functionName: (id) => this.fnName(id),
      functionReturns: (id) => must(sh.fnReturns.get(id), "function", id),
      engineText: (name, args) => {
        const t = sh.pack.engine(name, sh.syntax, args, this.lightMode ? "light" : this.stage);
        if (t === undefined)
          throw new UnsupportedError(
            `Engine intrinsic "${name}" is not available in the ${sh.pack.traits.displayName} backend`,
          );
        return t;
      },
      samplerStateText: (e) => {
        const key = `${e.filter}_${e.wrap}`;
        let s = sh.samplers.get(key);
        if (!s) {
          s = { name: sh.namer.fresh(`ks_sampler_${key}`, "s"), filter: e.filter, wrap: e.wrap };
          sh.samplers.set(key, s);
        }
        return s.name;
      },
      warn: (m) => void sh.warnings.add(m),
      unsupported: (message, bodyId, id) => noteUnsupported(sh.unsupported, sh.module, message, bodyId, id),
    };
  }

  neededFunctions(mainExprs: readonly ExprId[]): IRFunction[] {
    return neededFunctions(this.sh.module, mainExprs);
  }

  emitFunction(f: IRFunction): CodeWriter {
    return emitIrFunction(this.sh.pack.dialect, f, this.fnName(f.id), this.sh.namer.child(), this.services());
  }
}

interface VertexOut {
  st: StageState;
  body: CodeWriter;
  /** Name of the clip-space position temporary (declared in `body`). */
  clip: string;
  /** Final clip-position expression (applies the Y-flip option). */
  clipFinal: string;
  varyings: Array<{ name: string; ty: StorageType; expr: string; ref?: SourceRef | undefined }>;
  functions: Map<string, CodeWriter>;
  /** Object-space position expression after the vertex block (`a_position` when unmodified). */
  pos: string;
  /** Vertex statements WITHOUT the clip-space tail (derived-input globals + graph code + displaced position). */
  core: CodeWriter;
  /** Bare expression text of every vertex master output, by slot id. */
  slotExprs: Record<string, string>;
}
interface FragmentOut {
  st: StageState;
  body: CodeWriter;
  /** vec4 expression returned by the fragment entry point. */
  color: string;
  varyings: Array<{ name: string; ty: StorageType }>;
  functions: Map<string, CodeWriter>;
  /** Bare expression text of every fragment master output, by slot id (engine profiles assemble their own entry points from these). */
  slotExprs: Record<string, string>;
}
/** The per-light stage (Godot `light`, 2): present only when the module has `light`-stage outputs. */
interface LightOut {
  body: CodeWriter;
  /** Bare expression text of every light-stage master output, by slot id. */
  slotExprs: Record<string, string>;
}
export interface Generated {
  sh: Shared;
  vertex: VertexOut;
  fragment: FragmentOut;
  /** Light-stage body (see `LightOut`); `undefined` for every module without light-stage outputs. */
  light?: LightOut;
  uniforms: ExplicitUniform[];
  samplers: StaticSampler[];
  /** Helper source blocks (deduplicated, dependency order). */
  helpers: string[];
  /** Function definitions of both stages merged (callee-first, stage-independent ones once). */
  functions: CodeWriter[];
  diagnostics: Diagnostic[];
}
export interface GenerateOptions {
  labels?: Record<string, string>;
  interpolate?: string[];
  dialect: DialectOptions;
  /** Engine profiles that clip through a built-in (Godot `ALPHA_SCISSOR_THRESHOLD`) do not want the generated `discard`. */
  skipAlphaClip?: boolean;
}

const refOf = (module: IRModule, id: ExprId): SourceRef | undefined => module.sourceMap[sourceKey(MAIN_BODY, id)];

function genFragment(sh: Shared, plan: StagePlan, slots: SlotMap, interp: Map<ExprId, string>): FragmentOut {
  const module = sh.module;
  const dialect = sh.pack.dialect;
  const st = new StageState(sh, "fragment");
  const body = new CodeWriter();
  const set = plan.fragment;
  const be = new BodyEmitter({
    dialect,
    body: module.main,
    bodyId: MAIN_BODY,
    order: set.order,
    uses: set.uses,
    namer: sh.namer.child(),
    w: body,
    overrides: interp,
    svc: st.services(),
    ...(module.half ? { half: new Set(module.half) } : {}),
  });
  be.emitStatements();
  let color: string;
  if (slots.color !== undefined) {
    if (slots.alphaClip !== undefined) {
      const name = sh.namer.fresh("color");
      body.line(dialect.declare("vec4", name, be.bare(slots.color)), refOf(module, slots.color));
      for (const l of dialect.discardIf(`${name}.a < ${be.bare(slots.alphaClip)}`))
        body.line(l, refOf(module, slots.alphaClip));
      color = name;
    } else color = be.bare(slots.color);
  } else if (slots.rgb !== undefined) {
    color = dialect.vec4Of(be.bare(slots.rgb), slots.alpha !== undefined ? be.bare(slots.alpha) : "1.0");
    if (slots.alphaClip !== undefined) {
      const name = sh.namer.fresh("color");
      body.line(dialect.declare("vec4", name, color), refOf(module, slots.rgb));
      for (const l of dialect.discardIf(`${name}.a < ${be.bare(slots.alphaClip)}`))
        body.line(l, refOf(module, slots.alphaClip));
      color = name;
    }
  } else color = `${dialect.typeName("vec4")}(1.0, 1.0, 1.0, 1.0)`;
  const slotExprs: Record<string, string> = {};
  for (const o of module.outputs) if (o.stage === "fragment") slotExprs[o.slot] = be.bare(o.value);
  const functions = new Map(st.neededFunctions(set.order).map((f) => [f.id, st.emitFunction(f)] as const));
  const varyings = [...st.varyings.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((v) => ({ name: v.name, ty: v.ty }));
  for (const [id, name] of interp) varyings.push({ name, ty: module.main.exprs[id]!.ty });
  return { st, body, color, varyings, functions, slotExprs };
}

/**
 * Light stage: emitted through the FRAGMENT state (same varyings, helpers, namer) so shared inputs stay consistent; runs before `genVertex`
 * so the varyings it discovers are produced by the vertex stage too. Vertex hoisting is ignored (the cone is recomputed from inputs).
 */
function genLight(sh: Shared, frag: FragmentOut): LightOut | undefined {
  const module = sh.module;
  const outs = module.outputs.filter((o) => o.stage === "light");
  if (outs.length === 0) return undefined;
  const st = frag.st;
  st.lightMode = true;
  try {
    const { order, uses } = bodyOrderUses(
      module.main,
      outs.map((o) => o.value),
    );
    const body = new CodeWriter();
    const be = new BodyEmitter({
      dialect: sh.pack.dialect,
      body: module.main,
      bodyId: MAIN_BODY,
      order,
      uses,
      namer: sh.namer.child(),
      w: body,
      svc: st.services(),
    });
    be.emitStatements();
    const slotExprs: Record<string, string> = {};
    for (const o of outs) slotExprs[o.slot] = be.bare(o.value);
    for (const f of st.neededFunctions(order))
      if (!frag.functions.has(f.id)) frag.functions.set(f.id, st.emitFunction(f));
    return { body, slotExprs };
  } finally {
    st.lightMode = false;
  }
}

function genVertex(
  sh: Shared,
  plan: StagePlan,
  slots: SlotMap,
  frag: FragmentOut,
  interp: Map<ExprId, string>,
): VertexOut {
  const module = sh.module;
  const dialect = sh.pack.dialect;
  const s = sh.syntax;
  const st = new StageState(sh, "vertex");
  const set = plan.vertex;
  const bodyW = new CodeWriter();
  const be = new BodyEmitter({
    dialect,
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
  const posTail = new CodeWriter();
  st.use.attrs.add("a_position");
  let pos = s.attr("a_position");
  if (slots.vertexOffset !== undefined || slots.vertexPosition !== undefined) {
    pos = sh.namer.fresh("displaced_position");
    const rhs =
      slots.vertexOffset !== undefined
        ? `${s.attr("a_position")} + ${be.bare(slots.vertexOffset)}`
        : be.bare(slots.vertexPosition!);
    posTail.line(dialect.declare("vec3", pos, rhs), refOf(module, (slots.vertexOffset ?? slots.vertexPosition)!));
  }
  const core = new CodeWriter();
  for (const g of st.globals.values()) core.line(`${g.name} = ${g.expr};`);
  const slotExprs: Record<string, string> = {};
  for (const o of module.outputs) if (o.stage === "vertex") slotExprs[o.slot] = be.bare(o.value);
  const clip = sh.namer.fresh("clip_position");
  const mats = (["ks_Projection", "ks_View", "ks_Model"] as const).map((u) => s.uni(u));
  tail.append(posTail);
  tail.line(
    dialect.declare(
      "vec4",
      clip,
      mats.reduceRight((acc, m) => s.mulM4V4(m, acc), s.v4(pos, s.num(1))),
    ),
  );
  const clipFinal = sh.options.flipClipY ? `${s.vec(4)}(${clip}.x, -${clip}.y, ${clip}.z, ${clip}.w)` : clip;

  const varyings: VertexOut["varyings"] = [];
  for (const v of frag.st.varyings.values()) {
    const d = describeInputWith(s, v.input, v.space);
    if (d.usesPosition) st.use.attrs.add("a_position");
    varyings.push({ name: v.name, ty: v.ty, expr: d.vertex(d.usesPosition ? pos : s.attr("a_position"), st.use) });
  }
  varyings.sort((a, b) => a.name.localeCompare(b.name));
  for (const [id, name] of interp)
    varyings.push({ name, ty: module.main.exprs[id]!.ty, expr: be.bare(id), ref: refOf(module, id) });

  // Functions first: they may discover derived-input globals too. The globals are assigned at the start of main.
  const functions = new Map(st.neededFunctions(set.order).map((f) => [f.id, st.emitFunction(f)] as const));
  const body = new CodeWriter();
  for (const g of st.globals.values()) body.line(`${g.name} = ${g.expr};`);
  body.append(bodyW).append(tail);
  core.append(bodyW).append(posTail);
  return { st, body, clip, clipFinal, varyings, functions, pos, core, slotExprs };
}

/** Run the shared backend pipeline (stage planning, naming, both stages) for one language. */
export function generate(module: IRModule, pack: LangPack, opts: GenerateOptions): Generated {
  const labels = new Map(Object.entries(opts.labels ?? {}));
  const slots = mapSlots(module);
  if (opts.skipAlphaClip) delete slots.alphaClip;
  const plan = planStages(module, { interpolateNodes: new Set(opts.interpolate ?? []) });
  const sh = new Shared(module, pack, labels, opts.dialect);
  const interp = new Map<ExprId, string>(
    plan.interpolated.map((id) => {
      const ref = refOf(module, id);
      const label = ref ? labels.get(ref.nodeId) : undefined;
      return [id, sh.namer.fresh(`v_${label ? snakeCase(label) || `interp_${id}` : `interp_${id}`}`)];
    }),
  );
  const fragment = genFragment(sh, plan, slots, interp);
  const light = genLight(sh, fragment);
  const vertex = genVertex(sh, plan, slots, fragment, interp);
  const diagnostics: Diagnostic[] = backendDiagnostics(sh.warnings, sh.unsupported, pack.traits.displayName);
  const functions: CodeWriter[] = [];
  for (const f of module.functions) {
    const names = sh.fnNames.get(f.id)!;
    const v = vertex.functions.get(f.id);
    const p = fragment.functions.get(f.id);
    if (names.vertex !== undefined) functions.push(...[v, p].filter((x): x is CodeWriter => x !== undefined));
    else if (p ?? v) functions.push((p ?? v)!);
  }
  return {
    sh,
    vertex,
    fragment,
    ...(light ? { light } : {}),
    uniforms: sh.uniforms,
    samplers: [...sh.samplers.values()],
    helpers: sh.helpers.emit(),
    functions,
    diagnostics,
  };
}
