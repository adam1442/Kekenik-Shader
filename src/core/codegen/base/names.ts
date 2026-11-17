import { type CodegenLang, isReservedWord } from "./reserved";

/**
 * Turn arbitrary text into a legal identifier for `lang`:
 *  - only [A-Za-z0-9_], never starts with a digit, no `__` (reserved in GLSL/HLSL), no `gl_` prefix,
 *  - never a reserved word (a trailing `_` is appended instead).
 */
function sanitizeIdentifier(raw: string, lang: CodegenLang, fallback = "v"): string {
  let s = raw
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!s) s = fallback;
  if (/^[0-9]/.test(s)) s = `${fallback}_${s}`;
  if (s.startsWith("gl_")) s = `${fallback}_${s}`;
  if (isReservedWord(lang, s)) s = `${s}_`;
  return s;
}

/** snake_case from labels such as "Add Two" / "UV Scroll" / "myNode". */
export function snakeCase(raw: string): string {
  return raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase())
    .join("_");
}

/**
 * Hands out unique identifiers deterministically (`name`, `name_2`, `name_3`, …).
 * One namespace per generated shader: function locals are unique program-wide, so a local can never shadow a global
 * (varying, uniform, derived-input global) that is discovered later in the emission.
 */
export class Namer {
  private taken = new Set<string>();

  constructor(readonly lang: CodegenLang) {}

  has(name: string): boolean {
    return this.taken.has(name);
  }

  /** Mark a name as used (e.g. built-in uniforms, attributes). */
  reserve(name: string): string {
    this.taken.add(name);
    return name;
  }

  /** A fresh, legal, unique identifier derived from `base`. */
  fresh(base: string, fallback = "v"): string {
    const clean = sanitizeIdentifier(base, this.lang, fallback);
    let name = clean;
    const sep = clean.endsWith("_") ? "" : "_"; // never create "__" (reserved in GLSL/HLSL)
    for (let i = 2; this.has(name); i++) name = `${clean}${sep}${i}`;
    this.taken.add(name);
    return name;
  }

  /** Kept for API symmetry; scopes share one namespace (see class doc). */
  child(): Namer {
    return this;
  }
}
