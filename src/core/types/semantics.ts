/** Semantic tags & coordinate spaces. Tags travel with ports (not with the type itself). */
type Semantic = "none" | "color" | "hdr-color" | "normal" | "uv" | "position" | "direction";
export type Space = "object" | "world" | "view" | "tangent" | "clip";

export const SPACES: readonly Space[] = ["object", "world", "view", "tangent", "clip"];
export const SEMANTICS: readonly Semantic[] = ["none", "color", "hdr-color", "normal", "uv", "position", "direction"];

export interface TypeTag {
  semantic?: Semantic;
  space?: Space;
}

export interface TagCompat {
  ok: boolean;
  warning?: string;
}

/**
 * Compare the tag of a wire's source with the tag a destination port expects.
 * A mismatch only exists when BOTH sides declare a space and the spaces differ.
 */
export function tagCompat(src: TypeTag | undefined, dst: TypeTag | undefined): TagCompat {
  if (src?.space && dst?.space && src.space !== dst.space) {
    return {
      ok: false,
      warning: `Space mismatch: value is in ${src.space} space but the port expects ${dst.space} space`,
    };
  }
  return { ok: true };
}
