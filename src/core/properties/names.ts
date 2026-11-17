import { type CodegenLang, isReservedWord } from "../codegen/base/reserved";

/** Reference-name sanitisation per export target (same set as the codegen languages). */
export type RefTarget = CodegenLang;
export const REF_TARGETS: readonly RefTarget[] = ["glsl", "hlsl", "wgsl", "godot", "unity"];

/** Reserved words come from the single per-language table of the codegen toolkit (never duplicated here). */
export function isReservedName(name: string, target: RefTarget): boolean {
  return isReservedWord(target, name);
}

/** Split an arbitrary string into alphanumeric words (camelCase boundaries and separators). */
function words(input: string): string[] {
  return input
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

/**
 * Derive the target-specific spelling from the canonical (Unity-style) reference name.
 *  - unity: keeps the user's spelling, made identifier-safe, guaranteed to start with `_` (material property convention)
 *  - glsl / hlsl: `u_` + original identifier chars (avoids keywords & digits first)
 *  - wgsl: snake_case, never starts with `_`+`_`, no reserved words
 *  - godot: snake_case (Godot style), no leading underscore, no reserved words
 * The result is always a valid identifier and never a reserved word.
 */
export function targetReferenceName(canonical: string, target: RefTarget): string {
  const ws = words(canonical);
  const base = ws.length ? ws : ["param"];
  let out: string;
  switch (target) {
    case "unity": {
      const joined = canonical.replace(/[^A-Za-z0-9_]/g, "") || "Param";
      out = /^[A-Za-z_]/.test(joined) ? joined : `_${joined}`;
      if (!out.startsWith("_")) out = `_${out}`;
      break;
    }
    case "glsl":
    case "hlsl":
      out = `u_${base.join("_")}`;
      break;
    case "wgsl":
    case "godot":
      out = base.map((w) => w.toLowerCase()).join("_");
      if (/^[0-9]/.test(out)) out = `p_${out}`;
      break;
  }
  if (isReservedName(out, target)) out = `${out}_`;
  return out;
}

/** Turn a display name into a canonical Unity-style reference name (`Main Texture` → `_MainTexture`). */
export function canonicalFromDisplayName(displayName: string): string {
  const ws = words(displayName);
  const pascal = ws.map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
  return `_${pascal || "Param"}`;
}

/** Make `name` unique within `taken` by appending `_2`, `_3`, ... Does not mutate `taken`. */
export function uniquifyName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  let i = 2;
  while (taken.has(`${name}_${i}`)) i++;
  return `${name}_${i}`;
}
