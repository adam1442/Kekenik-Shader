import type { BuiltinInput } from "../../ir/inputs";
import type { Stage } from "../../ir/types";
import type { Space } from "../../types/semantics";
import type { StorageType } from "../../types/shaderType";
import type { Namer } from "../base/names";
import { type InputSyntax, type UseSet, describeInputWith, inputSlug, newUseSet } from "./inputs";

/** A fragment-stage varying carrying a built-in input. */
export interface VaryingInfo {
  name: string;
  ty: StorageType;
  input: BuiltinInput;
  space?: Space;
}

/** A vertex-stage global holding a derived input (assigned at the start of `main`). */
export interface GlobalInfo {
  name: string;
  ty: StorageType;
  expr: string;
}

/**
 * What one stage discovers about built-in inputs while its code is emitted: attributes / host uniforms in use,
 * derived-input globals (vertex) and varyings (fragment). One implementation for GLSL, WGSL, HLSL (and later Unity / Godot):
 * the language only supplies its `InputSyntax` and the shared `Namer`.
 */
export class StageInputs {
  readonly use: UseSet = newUseSet();
  /** Vertex stage: derived-input globals, keyed by input slug. */
  readonly globals = new Map<string, GlobalInfo>();
  /** Fragment stage: varyings read by this stage, keyed by input slug. */
  readonly varyings = new Map<string, VaryingInfo>();

  constructor(
    readonly stage: Stage,
    protected readonly syntax: InputSyntax,
    protected readonly namer: Namer,
  ) {}

  /** Expression that reads built-in `input` in this stage (registers attributes, uniforms, globals, varyings as needed). */
  inputText(input: BuiltinInput, space: Space | undefined): string {
    const s = this.syntax;
    const d = describeInputWith(s, input, space);
    const slug = inputSlug(input, space);
    const attrName = (): string => s.attr("a_position");
    if (this.stage === "vertex") {
      if (d.usesPosition) this.use.attrs.add("a_position");
      if (d.cat !== "derived") return d.vertex(attrName(), this.use);
      let g = this.globals.get(slug);
      if (!g) {
        g = { name: this.namer.fresh(`in_${slug}`), ty: d.ty, expr: d.vertex(attrName(), this.use) };
        this.globals.set(slug, g);
      }
      return g.name;
    }
    if (d.cat === "uniform" || d.cat === "constant" || d.cat === "builtin") return d.vertex("", this.use);
    if (d.via) {
      // The varying carries another input (shared with explicit uses of it); the value is finished per fragment.
      const carried = describeInputWith(s, d.via.input, d.via.space);
      const cslug = inputSlug(d.via.input, d.via.space);
      let cv = this.varyings.get(cslug);
      if (!cv) {
        cv = {
          name: this.namer.fresh(`v_${cslug}`),
          ty: carried.ty,
          input: d.via.input,
          ...(d.via.space ? { space: d.via.space } : {}),
        };
        this.varyings.set(cslug, cv);
      }
      return d.finish!(cv.name, this.use);
    }
    let v = this.varyings.get(slug);
    if (!v) {
      v = { name: this.namer.fresh(`v_${slug}`), ty: d.ty, input, ...(space ? { space } : {}) };
      this.varyings.set(slug, v);
    }
    return d.normalizeInFragment ? s.normalize(v.name) : v.name;
  }
}
