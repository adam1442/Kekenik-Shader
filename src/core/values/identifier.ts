/** Identifier (reference-name) validation shared by IdentifierField (no DOM). */
export interface IdentifierRules {
  /** Names already used (collision check, case-sensitive). */
  taken?: readonly string[];
  /** Reserved words (case-sensitive). */
  reserved?: readonly string[];
  maxLength?: number;
  /** Allow a leading underscore (Unity `_MainTex` style). Default true. */
  allowLeadingUnderscore?: boolean;
}

export const IDENTIFIER_HINT = "Letters, digits and underscores; must not start with a digit.";

/** Returns an error message, or null when valid. */
export function validateIdentifier(name: string, rules: IdentifierRules = {}): string | null {
  if (name.length === 0) return "Name cannot be empty";
  if (rules.maxLength && name.length > rules.maxLength) return `Name is longer than ${rules.maxLength} characters`;
  if (/^[0-9]/.test(name)) return "Name cannot start with a digit";
  if (!/^[A-Za-z0-9_]+$/.test(name)) return "Use letters, digits and underscores only";
  if (rules.allowLeadingUnderscore === false && name.startsWith("_")) return "Name cannot start with an underscore";
  if (rules.reserved?.includes(name)) return `"${name}" is a reserved word`;
  if (rules.taken?.includes(name)) return `"${name}" is already used`;
  return null;
}

/** Turn arbitrary text into a valid identifier (spaces → underscores, strips invalid characters, prefixes digits). */
export function sanitizeIdentifier(text: string): string {
  let s = text
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "");
  if (/^[0-9]/.test(s)) s = "_" + s;
  return s;
}

/** First free name of the form `base`, `base_1`, `base_2`… */
export function uniqueIdentifier(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 1; i < 10000; i++) if (!taken.includes(`${base}_${i}`)) return `${base}_${i}`;
  return base;
}
