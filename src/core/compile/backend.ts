import type { Diagnostic } from "../diagnostics";
import type { LineEntry } from "../codegen/base/writer";
import type { BackendTraits } from "../ir/traits";
import type { BackendId, IRModule } from "../ir/types";
import type { ProfileDef } from "../registry/profile";

export interface OutputFile {
  path: string;
  content: string;
  /** e.g. "glsl", "hlsl", "wgsl", "gdshader", "shaderlab", "ir", "json". */
  language: string;
}

/** How a property reaches the generated shader: lets hosts (the Preview) bind values by property id without parsing code. */
export interface UniformBinding {
  propId: string;
  /** Identifier of the uniform in the generated code (already target-mangled and unique). */
  name: string;
  /** Storage type, e.g. "float", "vec4", "texture2D". */
  ty: string;
  /** Texture uniforms only (GLSL backend): the Sampler State node wired to every sample of this texture. GLSL cannot express it, so the host applies it. */
  sampler?: { filter: "point" | "linear" | "trilinear"; wrap: "repeat" | "clamp" | "mirror" };
}

export interface EmitResult {
  files: OutputFile[];
  diagnostics: Diagnostic[];
  /** Optional source line tables: file path → generated line (1-based) → originating graph node. */
  sourceLines?: Record<string, LineEntry[]>;
  /** Optional named jump targets per file (e.g. the vertex / fragment entry point) for single-file backends. */
  sections?: Record<string, Array<{ label: string; line: number }>>;
  /** Property → uniform name table (backends that declare property uniforms). */
  uniformBindings?: UniformBinding[];
  /** Engine-profile problems (rule ids `unity.*`, `profile.*`) that are not graph diagnostics. */
  problems?: Array<{
    rule: string;
    severity: "error" | "warning" | "info";
    message: string;
    nodeId?: string;
    line?: number;
    manual?: string;
  }>;
}

export type EmitOptions = Record<string, unknown>;

/** A code generator. Backends only see the IR module + profile (never the graph). */
export interface Backend {
  id: BackendId;
  traits: BackendTraits;
  emit(module: IRModule, profile: ProfileDef, options: EmitOptions): EmitResult;
}

/** Optimisation / lowering hook on the IR (the pass list is empty in ). */
export interface IRPass {
  id: string;
  run(module: IRModule): IRModule;
}
