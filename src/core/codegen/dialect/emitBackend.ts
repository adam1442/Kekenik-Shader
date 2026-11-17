import type { Backend, EmitOptions, EmitResult } from "../../compile/backend";
import type { ProfileDef } from "../../registry/profile";
import type { IRModule } from "../../ir/types";
import { type Generated, type LangPack, generate } from "./generate";
import type { AssembledText } from "./textParts";
import { DEFAULT_DIALECT_OPTIONS, type DialectOptions } from "./types";

/** Options understood by every single-file text backend (all optional). */
export interface TextEmitOptions extends Partial<DialectOptions> {
  /** graph node id → label, used to name temporaries after the node that produced them. */
  labels?: Record<string, string>;
  /** Graph node ids evaluated in the vertex stage and interpolated ("evaluate in vertex" hint). */
  interpolate?: string[];
}

/**
 * `Backend.emit` of a single-file backend (WGSL, HLSL; Unity / Godot reuse it): run the shared generator for `pack`, then
 * let `assemble` lay the pieces out as `file` (language `language`). Everything language-specific lives in `pack` + `assemble`.
 */
export function singleFileEmit(
  pack: LangPack,
  file: string,
  language: string,
  assemble: (g: Generated, profileName: string) => AssembledText,
): Backend["emit"] {
  return (module: IRModule, profile: ProfileDef, options: EmitOptions): EmitResult => {
    const o = options as TextEmitOptions;
    const g = generate(module, pack, {
      ...(o.labels ? { labels: o.labels } : {}),
      ...(o.interpolate ? { interpolate: o.interpolate } : {}),
      dialect: {
        nativeDerivatives: o.nativeDerivatives ?? DEFAULT_DIALECT_OPTIONS.nativeDerivatives,
        flipUvV: o.flipUvV ?? false,
        flipClipY: o.flipClipY ?? false,
      },
    });
    const t = assemble(g, profile.name);
    return {
      files: [{ path: file, content: t.text, language }],
      diagnostics: g.diagnostics,
      sourceLines: { [file]: t.table },
      sections: { [file]: t.sections },
      uniformBindings: g.uniforms.map((u) => ({ propId: u.prop, name: u.name, ty: u.ty })),
    };
  };
}
