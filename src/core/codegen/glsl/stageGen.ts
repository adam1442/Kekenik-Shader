import type { BackendTraits } from "../../ir/traits";
import type { ExprId, IRFunction, IRModule, Stage } from "../../ir/types";
import type { StorageType } from "../../types/shaderType";
import { HelperRegistry } from "../base/helpers";
import type { UniformEntry } from "../base/layout";
import type { CodeWriter } from "../base/writer";
import type { Namer } from "../base/names";
import { neededFunctions } from "../base/stageSplit";
import { type UnsupportedNote, noteUnsupported } from "../dialect/diagnostics";
import { engineExpr } from "../dialect/engine";
import { emitIrFunction } from "../dialect/emitFunction";
import { must } from "../dialect/ops";
import { StageInputs } from "../dialect/stageInputs";
import { DEFAULT_DIALECT_OPTIONS, type Dialect, type DialectServices, UnsupportedError } from "../dialect/types";
import { GLSL_HELPERS } from "./helpers";
import { glslSyntax } from "./syntax";

/** Data shared by both stages of one shader. */
export interface SharedGen {
  /** Preview fp16 emulation requested (see `GlslEmitOptions.emulateHalf`). */
  emulateHalf?: boolean;
  module: IRModule;
  traits: BackendTraits;
  /** The dialect of this shader (tiling / offset + preview sampler options are per shader). */
  dialect: Dialect;
  namer: Namer;
  uniforms: Map<string, UniformEntry>;
  fnNames: Map<string, string>;
  fnReturns: Map<string, StorageType[]>;
  labels?: ReadonlyMap<string, string> | undefined;
  warnings: Set<string>;
  unsupported: UnsupportedNote[];
  /** Preview emulation of engine intrinsics the portable GLSL host contract does not provide . */
  emulation?: import("./emulation").GlslEmulation | undefined;
}

/** Everything one stage (vertex or fragment) discovers while emitting its code (inputs: see `StageInputs`). */
export class StageState extends StageInputs {
  readonly helpers = new HelperRegistry(GLSL_HELPERS);
  readonly usedUniforms = new Set<string>();
  /** Extra declarations (emulation samplers / uniforms) this stage needs. */
  readonly decls = new Set<string>();

  constructor(
    readonly shared: SharedGen,
    stage: Stage,
  ) {
    super(stage, glslSyntax, shared.namer);
  }

  services(): DialectServices {
    const sh = this.shared;
    return {
      traits: sh.traits,
      stage: this.stage,
      helpers: this.helpers,
      sourceMap: sh.module.sourceMap,
      labels: sh.labels,
      options: DEFAULT_DIALECT_OPTIONS,
      inputText: (e) => this.inputText(e.input, e.space),
      uniformText: (prop) => {
        const u = must(sh.uniforms.get(prop), "uniform", prop);
        this.usedUniforms.add(prop);
        return u.name;
      },
      functionName: (id) => must(sh.fnNames.get(id), "function", id),
      functionReturns: (id) => must(sh.fnReturns.get(id), "function", id),
      engineText: (name, args) => {
        // Reading a host matrix registers its uniform: the GLSL host contract only declares what is used.
        const t = engineExpr(name, { ...glslSyntax, uni: (u) => (this.use.uniforms.add(u), glslSyntax.uni(u)) });
        if (t !== undefined) return t;
        const hit = sh.emulation?.resolve(name, args ?? []);
        if (hit) {
          for (const u of hit.uses ?? []) this.use.uniforms.add(u);
          for (const d of hit.decls ?? []) this.decls.add(d);
          return hit.expr;
        }
        throw new UnsupportedError(
          sh.emulation
            ? `Engine intrinsic "${name}" is not emulated by the preview`
            : `Engine intrinsic "${name}" is not available in the GLSL backend`,
        );
      },
      samplerStateText: () => "/* sampler state */",
      warn: (message) => void sh.warnings.add(message),
      unsupported: (message, bodyId, id) => noteUnsupported(sh.unsupported, sh.module, message, bodyId, id),
    };
  }

  /** Functions (callee-first module order) transitively called from the given main-body expressions. */
  neededFunctions(mainExprs: readonly ExprId[]): IRFunction[] {
    return neededFunctions(this.shared.module, mainExprs);
  }

  /** GLSL source of one IR function (single return value → returned; several → `out` parameters). */
  emitFunction(f: IRFunction): CodeWriter {
    const sh = this.shared;
    return emitIrFunction(sh.dialect, f, sh.fnNames.get(f.id)!, sh.namer.child(), this.services());
  }
}
