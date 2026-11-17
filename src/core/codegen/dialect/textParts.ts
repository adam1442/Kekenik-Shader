import type { StorageType } from "../../types/shaderType";
import type { Property } from "../../properties/model";
import { formatFloat } from "../base/literals";
import type { CodeWriter } from "../base/writer";

/** Result of assembling one text file (WGSL / HLSL translation unit): source, line → node table, entry-point jump targets. */
export interface AssembledText {
  text: string;
  table: CodeWriter["table"];
  sections: Array<{ label: string; line: number }>;
}

/** `default: …` annotation of a declared uniform (shown next to it in every generated file); empty when there is no default. */
export function defaultComment(u: { property: Property; kind: string; ty: StorageType }): string {
  const d = u.property.default;
  if (u.kind === "texture")
    return u.property.textureDefault ? `default: ${u.property.textureDefault}` : "default: none";
  if (d === null || d === undefined) return "";
  if (typeof d === "boolean") return `default: ${d}`;
  if (typeof d === "number") return `default: ${u.ty === "int" ? d : formatFloat(d)}`;
  return `default: ${d.map(formatFloat).join(", ")}`;
}

/** The "Helpers" block (deduplicated helper sources) followed by every generated function. */
export function writeHelpersAndFunctions(
  w: CodeWriter,
  helpers: readonly string[],
  functions: readonly CodeWriter[],
): void {
  if (helpers.length > 0) {
    w.blank().line("// ── Helpers ──");
    helpers.forEach((h, i) => {
      if (i > 0) w.blank();
      w.raw(h);
    });
  }
  for (const fn of functions) {
    w.blank();
    w.append(fn);
  }
}
